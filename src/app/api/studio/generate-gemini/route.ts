import { NextResponse, after } from "next/server";
import {
  createJobId,
  generationJobCapability,
  getJobStore,
  newJob,
  supportsDurableGenerationJobs,
} from "@/features/room-stylist/services/generation-jobs/job-store";
import { getRoomEditProvider } from "@/features/room-stylist/services/image-providers/room-edit-provider";
import type { GeneratedImageResult } from "@/features/room-stylist/services/image-providers/types";
import {
  loadProductReferenceImageFiles,
  loadProductReferenceImages,
} from "@/lib/product-image-references";
import {
  buildRoomPreservationInstructions,
  buildScaleInstructions,
  formatProductForPrompt,
  type RoomMeasurements,
} from "@/lib/prompts";
import {
  getAllProducts,
  getProductsByIds,
  getProductsByIdsInSelectionOrder,
  getProductsForStyle,
  type Product,
} from "@/lib/products";
import {
  packageProductIds,
  selectRoomPackage,
} from "@/lib/intelligence/room-package";
import { getProductProfiles } from "@/lib/intelligence/product-profile";
import {
  analyzeSceneGraph,
  sceneGraphToRoomAnalysis,
} from "@/lib/intelligence/scene-graph";
import { buildIntelligentRoomPrompt } from "@/lib/intelligence/prompt-builder";
import {
  getCachedSceneGraph,
  roomImageKey,
  setCachedSceneGraph,
} from "@/lib/intelligence/scene-cache";
import {
  buildReplacementPlan,
  shouldUseTwoStageGeneration,
  splitPlanByStage,
  type ReplacementPlan,
} from "@/lib/intelligence/replacement-planner";
import { assessSceneReadiness } from "@/lib/intelligence/scene-readiness";
import {
  buildGroundingDebugPacket,
  logGroundingDebugPacket,
} from "@/lib/intelligence/grounding-debug";
import {
  buildRenderDiagnostics,
  logRenderDiagnostics,
} from "@/lib/intelligence/render-diagnostics";
import {
  buildReferenceManifest,
  MAX_TRANSMITTED_REFERENCES,
  MAX_TRANSMITTED_REFERENCES_GPT_IMAGE,
} from "@/lib/intelligence/reference-manifest";
import {
  contractToReplacementPlan,
  contractProductIds,
  type ReplacementContract,
} from "@/lib/intelligence/replacement-assignment";
import {
  intentProductIds,
  parseCategoryIntents,
  resolveCategoryIntents,
} from "@/lib/intelligence/category-intent";
import {
  isSeatingCategory,
  surpriseStylePrompt,
} from "@/lib/intelligence/room-categories";
import { getRoomEditStrategy } from "@/lib/intelligence/room-edit-strategy";
import { normaliseCustomerNote } from "@/lib/intelligence/customer-note";
import {
  checkFewShotEligibility,
  ProviderBusyError,
  runFewShotRoomEdit,
} from "@/features/room-stylist/services/few-shot-room-edit";
import {
  checkLocalizedEligibility,
  runLocalizedRoomEdit,
} from "@/features/room-stylist/services/localized-room-edit";
import type { QualityScore } from "@/lib/intelligence/quality-score";
import {
  reviewGeneratedRoom,
  reviewRecommendsRegeneration,
  reviewToQualityScore,
  type QualityReview,
  type ReviewStatus,
} from "@/lib/intelligence/quality-reviewer";

/**
 * Generation attempts per stage.
 *
 * Was a hard 2 — one render plus one retry if the first failed the contract.
 * With two stages that is a worst case of FOUR sequential GPT Image renders,
 * each with a Gemini review after it, and that is most of the 2-3 minute wait
 * customers were reporting. The retry only pays for itself when the reviewer
 * actually catches something, so the default is a single attempt and the retry
 * is opt-in per environment.
 *
 * The fidelity-retry CAPABILITY is fully in place: the loop below re-renders
 * whenever the reviewer recommends it, including for the signature-trait
 * failures this sprint added. Setting GENERATION_ATTEMPTS_PER_STAGE=2 enables
 * exactly one such retry — and still costs one render when the first passes,
 * because the loop breaks as soon as the reviewer is satisfied. Only the
 * DEFAULT is 1, so latency and spend stay opt-in rather than automatic.
 *
 * Values below 1 are ignored — zero attempts would render nothing at all — and
 * the ceiling of 3 stops a stray value uncapping cost.
 */
function getMaxGenerationAttempts(): number {
  const configured = Number.parseInt(
    process.env.GENERATION_ATTEMPTS_PER_STAGE?.trim() || "",
    10
  );
  if (!Number.isFinite(configured) || configured < 1) return 1;
  // Bounded so a stray env value cannot uncap latency or spend.
  return Math.min(configured, 3);
}
/**
 * Hard ceiling on image generations for one request, across all stages and
 * retries. Two stages x two attempts is the worst case, so this caps a
 * multi-product request at twice the cost of a single-product one rather than
 * letting it compound.
 */
const MAX_TOTAL_IMAGE_GENERATIONS = 4;

const SUPPORTED_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const SUPPORTED_REFINEMENT_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const SUPPORTED_DATA_URL_PREFIX =
  /^data:image\/(?:png|jpeg|webp);base64,/i;
const HEIC_EXTENSIONS = [".heic", ".heif"];
const MISSING_ROOM_IMAGE_ERROR =
  "Missing room image. Please upload a JPG, PNG, or WebP image.";
const HEIC_UPLOAD_ERROR =
  "This iPhone photo format is not supported yet. Please convert to JPG or select a JPG/PNG image.";
const UNSUPPORTED_UPLOAD_ERROR =
  "Unsupported room image type. Please upload JPG, PNG, or WebP.";
const GEMINI_CONFIGURATION_ERROR =
  "Room analysis is not configured. Add GEMINI_API_KEY.";

function devLog(message: string, details?: unknown) {
  if (process.env.NODE_ENV !== "development") return;

  console.log(message, details);
}

function isAiDebugEnabled() {
  return process.env.ENABLE_AI_DEBUG?.toLowerCase() === "true";
}

function getFileExtension(fileName: string) {
  const cleanFileName = fileName.split(/[?#]/)[0];
  const extensionIndex = cleanFileName.lastIndexOf(".");

  return extensionIndex === -1
    ? ""
    : cleanFileName.slice(extensionIndex).toLowerCase();
}

function parseSelectedProductIds(rawProductIds: FormDataEntryValue | null) {
  if (typeof rawProductIds !== "string" || !rawProductIds) return [];

  const parsed = JSON.parse(rawProductIds);

  return Array.isArray(parsed)
    ? parsed.filter(
        (productId): productId is string => typeof productId === "string"
      )
    : [];
}

/**
 * Parse the explicit replacement contract, if the client sent one.
 *
 * Malformed or empty contracts return null rather than throwing: the request
 * then falls back to the inferring planner instead of failing outright. A
 * contract with no assignments is treated as absent — there is nothing explicit
 * to honour.
 */
/**
 * The photo's true pixel size, so region geometry stays resolution
 * independent. Zeroes when the browser did not report it — the contract still
 * works, the coordinates are simply normalised against nothing.
 */
function parseSourceImageSize(raw: FormDataEntryValue | null): {
  width: number;
  height: number;
} {
  if (typeof raw !== "string" || !raw.trim()) return { width: 0, height: 0 };
  try {
    const parsed = JSON.parse(raw) as { width?: unknown; height?: unknown };
    const width = Number(parsed?.width);
    const height = Number(parsed?.height);
    return {
      width: Number.isFinite(width) && width > 0 ? width : 0,
      height: Number.isFinite(height) && height > 0 ? height : 0,
    };
  } catch {
    return { width: 0, height: 0 };
  }
}

function parseReplacementContract(
  raw: FormDataEntryValue | null
): ReplacementContract | null {
  if (typeof raw !== "string" || !raw.trim()) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ReplacementContract>;
    if (!parsed || !Array.isArray(parsed.assignments)) return null;
    if (parsed.assignments.length === 0) return null;

    return {
      assignments: parsed.assignments,
      protectedItems: Array.isArray(parsed.protectedItems)
        ? parsed.protectedItems
        : [],
      sourceImage: parsed.sourceImage ?? { width: 0, height: 0 },
    };
  } catch {
    return null;
  }
}

function parseOptionalPositiveNumber(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim() === "") return null;

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseRoomMeasurements(formData: FormData): RoomMeasurements {
  return {
    widthM: parseOptionalPositiveNumber(formData.get("roomWidthM")),
    lengthM: parseOptionalPositiveNumber(formData.get("roomLengthM")),
    ceilingHeightM: parseOptionalPositiveNumber(
      formData.get("ceilingHeightM")
    ),
  };
}

function mergeProductsById(
  selectedProducts: Product[],
  styleProducts: Product[],
  limit = 6
) {
  const seenProductIds = new Set<string>();

  return [...selectedProducts, ...styleProducts]
    .filter((product) => {
      if (seenProductIds.has(product.id)) return false;

      seenProductIds.add(product.id);
      return true;
    })
    .slice(0, limit);
}

function stripImageDataUrlPrefix(imageBase64: string) {
  return imageBase64.trim().replace(SUPPORTED_DATA_URL_PREFIX, "");
}

function base64ToImageBuffer(imageBase64: unknown) {
  if (typeof imageBase64 !== "string" || !imageBase64.trim()) return null;

  const cleanBase64 = stripImageDataUrlPrefix(imageBase64).replace(/\s/g, "");

  if (
    !cleanBase64 ||
    cleanBase64.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64)
  ) {
    return null;
  }

  const buffer = Buffer.from(cleanBase64, "base64");

  return buffer.length > 0 ? buffer : null;
}

function getErrorText(error: unknown) {
  if (error instanceof Error) return error.message;

  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message || "");
  }

  return String(error);
}

type GenerationAttempt = {
  image: GeneratedImageResult;
  review: QualityReview | null;
  reviewStatus: ReviewStatus;
  reviewUnavailableReason: string | null;
};

/**
 * Rank attempts by CONTRACT COMPLIANCE first, then quality score. A
 * compliant-but-lower-scoring render is preferable to a prettier one that
 * ignored the customer's product selection or invented a doorway.
 */
function pickBestAttempt(attempts: GenerationAttempt[]): GenerationAttempt {
  return attempts.reduce((bestSoFar, candidate) => {
    const rank = (entry: GenerationAttempt) => [
      entry.review?.contractCompliant ? 1 : 0,
      entry.review?.overall ?? -1,
    ];
    const [candidateCompliant, candidateOverall] = rank(candidate);
    const [bestCompliant, bestOverall] = rank(bestSoFar);
    if (candidateCompliant !== bestCompliant) {
      return candidateCompliant > bestCompliant ? candidate : bestSoFar;
    }
    return candidateOverall > bestOverall ? candidate : bestSoFar;
  });
}

/**
 * The key for the ANALYSIS models — the scene graph and the quality reviewer.
 *
 * Deliberately separate from the renderer's credentials. Those two read images
 * to build the plan and to judge the result, and they still run on Gemini
 * whichever renderer produces the pixels; conflating the two keys would mean
 * swapping the renderer silently swapped the thing grading it.
 */
function getStudioAnalysisApiKey() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || "";

  if (!apiKey) {
    throw new Error(GEMINI_CONFIGURATION_ERROR);
  }

  return apiKey;
}

async function handleGeneration(
  req: Request,
  /**
   * The async path must read the body BEFORE the response is sent — a request
   * body cannot be read from inside `after` — so it hands the parsed form in
   * rather than re-reading a consumed stream.
   */
  options: { preloadedFormData?: FormData } = {}
) {
  const formData = options.preloadedFormData ?? (await req.formData());
  const image = formData.get("image");
  const style = formData.get("style");
  const roomType = formData.get("roomType");
  const aiConceptMode = formData.get("aiConceptMode") === "true";

  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json(
      { error: MISSING_ROOM_IMAGE_ERROR },
      { status: 400 }
    );
  }

  if (typeof style !== "string" || typeof roomType !== "string") {
    return NextResponse.json(
      { error: "Missing style or room type." },
      { status: 400 }
    );
  }

  const imageType = image.type.toLowerCase();
  const imageExtension = getFileExtension(image.name);

  if (
    imageType === "image/heic" ||
    imageType === "image/heif" ||
    HEIC_EXTENSIONS.includes(imageExtension)
  ) {
    return NextResponse.json({ error: HEIC_UPLOAD_ERROR }, { status: 415 });
  }

  if (!SUPPORTED_UPLOAD_TYPES.has(imageType)) {
    return NextResponse.json(
      { error: UNSUPPORTED_UPLOAD_ERROR },
      { status: 415 }
    );
  }

  let selectedProductIds: string[];

  try {
    selectedProductIds = parseSelectedProductIds(
      formData.get("selectedProductIds")
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid selected product IDs." },
      { status: 400 }
    );
  }

  const roomMeasurements = parseRoomMeasurements(formData);
  const apiKey = getStudioAnalysisApiKey();

  // The renderer that will actually perform the edit. Checked up front so a
  // misconfigured provider fails before the customer has waited through a
  // scene analysis for a request that could never have produced an image.
  const renderer = getRoomEditProvider();
  if (!renderer.available) {
    throw new Error(
      renderer.unavailableReason ??
        `The ${renderer.label} renderer is not configured.`
    );
  }

  // An explicit replacement contract, when the customer built one, states
  // exactly which region becomes which product.
  const replacementContract = parseReplacementContract(
    formData.get("replacementContract")
  );

  /**
   * FEW-SHOT STRATEGY — the POC path.
   *
   * ---------------------------------------------------------------------------
   * WHY THIS IS TRIED TWICE
   * ---------------------------------------------------------------------------
   * A contract can arrive two ways, and only one of them exists this early:
   *
   *  1. The client built one, because the customer went through object
   *     selection. Everything the prompt needs is already in it, so the scene
   *     graph is pure latency and this attempt runs BEFORE it.
   *
   *  2. The customer picked a category and a product — the mainline flow, which
   *     never triggers detection (`detectRoomObjects` is only wired to Refine
   *     and "Mark an area yourself"). No contract is sent, so `resolvedIntent`
   *     builds an equivalent one FROM the scene graph further down.
   *
   * The first version of this branch only handled case 1, which meant the flag
   * silently never applied to the flow customers actually use: every mainline
   * request declined with "no explicit replacement contract" and fell through
   * to the grounding path. So the same attempt is made again once
   * `effectiveContract` exists — same prompt, same references, same single
   * render, just after paying for the scene graph that case 2 genuinely needs.
   */
  /**
   * LOCALIZED STRATEGY — one edit per target, in parallel, composited back.
   *
   * Shares the two-attempt shape with the few-shot path below: a client-built
   * contract can run before the scene graph, and the mainline flow retries once
   * `effectiveContract` exists. Anything it cannot model falls through to the
   * configured strategy rather than failing.
   */
  const attemptLocalized = async (
    contract: ReplacementContract | null,
    productIds: string[],
    origin: "client-contract" | "resolved-contract"
  ): Promise<NextResponse | null> => {
    if (getRoomEditStrategy() !== "localized") return null;

    const products = getProductsByIdsInSelectionOrder(productIds);
    /**
     * The contract's boxes are normalised 0–1, so eligibility only needs the
     * room's SHAPE, not its bytes. `sourceImage` is what the boxes were drawn
     * against; falling back to a 4:3 stand-in keeps a missing value from
     * blocking a request that the geometry checks would pass anyway.
     */
    const sourceImage = contract?.sourceImage;
    const eligibility = checkLocalizedEligibility({
      contract,
      surpriseMe: formData.get("surpriseMe") === "true",
      productIds: products.map((product) => product.id),
      roomWidth: sourceImage?.width || 2048,
      roomHeight: sourceImage?.height || 1536,
    });

    if (!eligibility.eligible) {
      if (origin === "resolved-contract" || contract) {
        console.warn("[studio-gemini] localized strategy declined", {
          origin,
          reason: eligibility.reason,
        });
      }
      return null;
    }

    if (renderer.id !== "gemini") {
      console.warn("[studio-gemini] localized strategy needs the Gemini renderer", {
        renderer: renderer.id,
      });
      return null;
    }

    try {
      const result = await runLocalizedRoomEdit({
        roomImage: image,
        contract: contract!,
        products,
        apiKey: renderer.apiKey ?? "",
      });

      console.log("[studio-gemini] localized generation", {
        origin,
        targetCount: result.debug.targetCount,
        parallelWallMs: result.debug.parallelWallMs,
        sumOfEditLatencyMs: result.debug.sumOfEditLatencyMs,
        compositeMs: result.debug.compositeMs,
        changedFraction: result.debug.changedFraction,
      });

      const body: Record<string, unknown> = {
        images: [
          {
            provider: result.provider,
            label: result.label,
            imageBase64: result.imageBase64,
            mimeType: result.mimeType,
            b64_json: result.imageBase64,
          },
        ],
        imageBase64: result.imageBase64,
        products: result.products,
      };
      if (isAiDebugEnabled()) body.aiDebug = { ...result.debug, contractOrigin: origin };
      return NextResponse.json(body);
    } catch (error) {
      /**
       * A capacity failure is the customer's to retry. Falling through here
       * would spend a full grounding render on a provider that just said it was
       * full, on top of the localized edits already paid for.
       */
      if (error instanceof ProviderBusyError) {
        return NextResponse.json(
          { error: error.message, retryable: true, reason: error.reason },
          { status: 503 }
        );
      }
      console.error("[studio-gemini] localized path failed, falling back", error);
      return null;
    }
  };

  const attemptFewShot = async (
    contract: ReplacementContract | null,
    productIds: string[],
    origin: "client-contract" | "resolved-contract"
  ): Promise<NextResponse | null> => {
    if (getRoomEditStrategy() !== "few-shot") return null;

    const fewShotProducts = getProductsByIdsInSelectionOrder(productIds);
    const eligibility = checkFewShotEligibility({
      contract,
      surpriseMe: formData.get("surpriseMe") === "true",
      productIds: fewShotProducts.map((product) => product.id),
    });

    if (!eligibility.eligible) {
      // Case 2 has no contract yet at the first attempt; that is expected, not
      // a problem, so it is not warned about until the second attempt has also
      // declined.
      if (origin === "resolved-contract" || contract) {
        console.warn("[studio-gemini] few-shot strategy declined, using grounding path", {
          origin,
          reason: eligibility.reason,
        });
      }
      return null;
    }

    if (renderer.id !== "gemini") {
      console.warn("[studio-gemini] few-shot strategy needs the Gemini renderer", {
        renderer: renderer.id,
      });
      return null;
    }

    try {
      const result = await runFewShotRoomEdit({
        roomImage: image,
        // Eligibility guarantees a contract; the type does not know that.
        contract: contract!,
        products: fewShotProducts,
        apiKey: renderer.apiKey ?? "",
      });

      console.log("[studio-gemini] few-shot generation", {
        origin,
        model: result.debug.model,
        aspectRatio: result.debug.aspectRatio,
        promptBytes: result.debug.promptBytes,
        imagesSent: result.debug.imagesSent,
        timings: result.debug.timings,
      });

      const fewShotBody: Record<string, unknown> = {
        images: [
          {
            provider: result.provider,
            label: result.label,
            imageBase64: result.imageBase64,
            mimeType: result.mimeType,
            b64_json: result.imageBase64,
          },
        ],
        imageBase64: result.imageBase64,
        products: result.products,
      };
      if (isAiDebugEnabled()) {
        fewShotBody.aiDebug = { ...result.debug, contractOrigin: origin };
      }
      return NextResponse.json(fewShotBody);
    } catch (error) {
      /**
       * Capacity failures are the customer's to retry, not ours to absorb:
       * silently re-running the grounding path here would spend a second
       * render on a provider that just said it was full. Everything else
       * falls through, so a bug in this new path cannot take generation down.
       */
      if (error instanceof ProviderBusyError) {
        return NextResponse.json(
          { error: error.message, retryable: true, reason: error.reason },
          { status: 503 }
        );
      }
      console.error("[studio-gemini] few-shot path failed, falling back to grounding", error);
      return null;
    }
  };

  // Attempt 1 — a client-built contract needs no room understanding at all.
  const earlyLocalized = await attemptLocalized(
    replacementContract,
    selectedProductIds,
    "client-contract"
  );
  if (earlyLocalized) return earlyLocalized;

  const earlyFewShot = await attemptFewShot(
    replacementContract,
    selectedProductIds,
    "client-contract"
  );
  if (earlyFewShot) return earlyFewShot;

  // Room understanding runs FIRST, because "Surprise me" needs to know what
  // kind of room this is before it can choose a package for it. Fallback-safe.
  // The same photo may already have been analysed moments ago by the advanced
  // picker. Identical bytes mean an identical room, so reuse the answer rather
  // than paying thirty seconds for it twice.
  const sceneCacheKey = roomImageKey(await image.arrayBuffer());
  const cachedScene = getCachedSceneGraph(sceneCacheKey);
  const sceneGraph =
    cachedScene ??
    (await analyzeSceneGraph(image, {
      apiKey,
      roomTypeHint: roomType,
    }));
  if (!cachedScene) setCachedSceneGraph(sceneCacheKey, sceneGraph);

  /**
   * "Surprise me" — the customer asked for a designed room, not a form. The
   * package is chosen HERE, from the room the scene graph just described, so
   * the request needs no round trip and no confirmation screen. It is still
   * structured data, and it is still the complete and only product set:
   * generation may not reach past it into the wider catalogue.
   */
  const surpriseMe = formData.get("surpriseMe") === "true";
  /**
   * The customer's chosen look, when they picked one. "No preference" falls
   * back to the style the request already carries rather than imposing a look.
   */
  const surpriseStyle =
    typeof formData.get("surpriseStyle") === "string"
      ? (formData.get("surpriseStyle") as string)
      : null;
  const effectiveStyle = surpriseMe
    ? surpriseStylePrompt(surpriseStyle, style)
    : style;
  const autoPackage = surpriseMe
    ? selectRoomPackage({
        roomType: sceneGraph.roomType || roomType,
        style: effectiveStyle,
        catalogue: getAllProducts(),
        // Anything the customer had already shown interest in anchors the room.
        preferProductIds: selectedProductIds,
      })
    : null;

  /**
   * Category intent → contract, resolved here because the instances only exist
   * in the scene graph this request already paid for. The customer chose
   * "Sofas"; the room decides which sofas that means.
   */
  const categoryIntents = parseCategoryIntents(formData.get("replaceCategories"));
  const resolvedIntent =
    !surpriseMe && categoryIntents.length > 0 && !replacementContract
      ? resolveCategoryIntents({
          intents: categoryIntents,
          sceneGraph,
          catalogue: getAllProducts(),
          profiles: getProductProfiles(
            getProductsByIdsInSelectionOrder(
              categoryIntents.flatMap((intent) => intentProductIds(intent))
            )
          ),
          sourceImage: parseSourceImageSize(formData.get("sourceImageSize")),
        })
      : null;
  const effectiveContract = replacementContract ?? resolvedIntent?.contract ?? null;

  /**
   * Refuse to render a room we could not read.
   *
   * Scene analysis fails silently — an empty graph is not an error downstream,
   * it just looks like an empty room, and the plan then places the new sofas
   * BESIDE the old ones while dropping the coffee table entirely. Three of four
   * paid renders during the renderer benchmark were lost this way with nothing
   * noticing. Better to fail before the spend, with a reason the customer can
   * act on, than to charge for a result that cannot satisfy the contract.
   *
   * Surprise Me is exempt: it has no requested categories to verify and the
   * server chooses the package from whatever the room turned out to be.
   */
  if (!surpriseMe && categoryIntents.length > 0) {
    const requestedCategories = categoryIntents
      .map((intent) => intent.canonicalCategory)
      // Seating states a DESIRED final count, so its own resolver reconciles
      // against whatever exists; what matters there is that the room was read
      // at all, which the analysed check below covers.
      .filter((category) => !isSeatingCategory(roomType, category));

    const readiness = assessSceneReadiness({
      sceneGraph,
      requestedCategories,
    });

    devLog("[studio-gemini] scene readiness", {
      analysed: sceneGraph.analysed,
      detected: readiness.detectedByCategory,
      requested: requestedCategories,
      ready: readiness.ready,
    });

    if (!readiness.ready) {
      console.warn("[studio-gemini] refusing to render an unread room", {
        missing: readiness.missingCategories,
        detected: readiness.detectedByCategory,
      });
      return NextResponse.json(
        {
          error: readiness.reason,
          sceneUnreadable: true,
          detected: readiness.detectedByCategory,
        },
        { status: 422 }
      );
    }
  }

  /**
   * Attempt 2 — the mainline flow.
   *
   * `effectiveContract` now exists for category-intent requests, resolved from
   * the scene graph above, and it is the same shape the client builds during
   * object selection. Placed after the readiness gate deliberately: if the room
   * could not be read, the resolved contract would be guesswork, and few-shot
   * has no more ability to place an unseen object than the grounding path does.
   */
  const resolvedLocalized = await attemptLocalized(
    effectiveContract,
    effectiveContract ? contractProductIds(effectiveContract) : selectedProductIds,
    "resolved-contract"
  );
  if (resolvedLocalized) return resolvedLocalized;

  const resolvedFewShot = await attemptFewShot(
    effectiveContract,
    effectiveContract
      ? contractProductIds(effectiveContract)
      : selectedProductIds,
    "resolved-contract"
  );
  if (resolvedFewShot) return resolvedFewShot;

  // Customer selection order is preserved end-to-end: profiles, the replacement
  // plan and reference-image priority all follow the order the customer picked,
  // so if a budget forces prioritisation the earliest choices keep their
  // reference image.
  const selectedProducts = autoPackage
    ? getProductsByIdsInSelectionOrder(packageProductIds(autoPackage))
    : resolvedIntent?.contract
      ? // Server-resolved intent is authoritative about which products are
        // actually used: a category the room turned out not to contain
        // contributes no product, so it cannot appear in the shopping list.
        getProductsByIdsInSelectionOrder(
          contractProductIds(resolvedIntent.contract)
        )
      : getProductsByIdsInSelectionOrder(selectedProductIds);
  const orderedSelectedIds = selectedProducts.map((product) => product.id);

  // A curated package — chosen here for Surprise me, or sent by the client — is
  // the complete product set, so the render and the shopping list are
  // guaranteed to describe the same products.
  const curatedPackage =
    Boolean(autoPackage) || formData.get("curatedPackage") === "true";
  const styleProducts = getProductsForStyle(style);
  const products = curatedPackage
    ? selectedProducts
    : aiConceptMode
      ? mergeProductsById(selectedProducts, styleProducts)
      : selectedProducts;
  // With a curated package, concept mode is OFF: the package IS the design, so
  // nothing beyond it may be invented. Leaving it on would let the prompt's
  // "add a few tasteful accessories" fallback introduce furniture that is not
  // in the catalogue and cannot be shopped.
  const effectiveConceptMode = curatedPackage ? false : aiConceptMode;

  // Phase 1 — product intelligence profiles.
  const profiles = getProductProfiles(products);

  // Phase 2 — product reference views, grouped per product and reporting what
  // could not be loaded (and why) instead of dropping it silently.
  const referenceLoad = await loadProductReferenceImages(
    products,
    "[studio-gemini]"
  );
  const roomAnalysis = sceneGraphToRoomAnalysis(sceneGraph);

  // Sprint 2 — deterministic replacement plan: exactly one destination for
  // every selected product (replace an existing item or place it in a zone),
  // never touching fixed objects. Built before the prompt so generation knows
  // precisely what changes. Fully deterministic and fallback-safe.
  // With an explicit contract the plan is a direct TRANSLATION of what the
  // customer authorised — no category matching, no inference about which object
  // a product belongs to. Without one (Surprise me), the planner infers as
  // before.
  const replacementPlan = effectiveContract
    ? contractToReplacementPlan(effectiveContract, profiles)
    : buildReplacementPlan({
        sceneGraph,
        profiles,
        selectedProductIds: orderedSelectedIds,
        aiConceptMode: effectiveConceptMode,
      });

  // Reference manifest — decides which references are actually transmitted,
  // with a label binding each image to its plan task. The prompt and the
  // payload are both derived from this one structure so they cannot disagree
  // about how many references exist or which product each depicts.
  /**
   * The reference budget depends on which renderer will consume it: the GPT
   * Image edit endpoint takes 16 images, where the Gemini inline path is far
   * more constrained. Passing the renderer's own budget here is what stops a
   * six-product room from silently losing a product's only reference.
   */
  const referenceManifest = buildReferenceManifest({
    loaded: referenceLoad.loaded,
    plan: replacementPlan,
    selectedProductIds: orderedSelectedIds,
    maxReferences:
      renderer.id === "gpt-image"
        ? MAX_TRANSMITTED_REFERENCES_GPT_IMAGE
        : MAX_TRANSMITTED_REFERENCES,
  });
  /**
   * What the renderer is actually being told, per product: which metadata
   * fields carried a value, which reference images went with them, and how
   * those map to tasks. Logged once per generation, before any paid call.
   */
  const groundingDebug = buildGroundingDebugPacket({
    plan: replacementPlan,
    manifest: referenceManifest,
  });
  logGroundingDebugPacket(groundingDebug);

  // The room as the analysis actually saw it, beside the tasks it produced —
  // the two things needed to explain any render after the fact.
  devLog("[studio-gemini] scene + plan", {
    renderer: renderer.id,
    analysed: sceneGraph.analysed,
    detectedItems: (sceneGraph.furniture ?? []).map(
      (item) => `${item.canonicalCategory}: ${item.instanceLabel}`
    ),
    replaceTasks: replacementPlan.replacements.map(
      (task) => `#${task.taskId} ${task.existingInstanceLabel} -> ${task.productTitle}`
    ),
    removeTasks: replacementPlan.removals.map((task) => `#${task.taskId} ${task.existingInstanceLabel}`),
    addTasks: replacementPlan.additions.map((task) => `#${task.taskId} ${task.productTitle}`),
    preserved: replacementPlan.preserved,
  });

  // A selected product with no transmitted reference is a real degradation:
  // surface it rather than letting it pass unnoticed.
  const uncoveredSelected = referenceManifest.uncoveredSelectedProductIds;
  if (uncoveredSelected.length > 0) {
    console.warn("[studio-gemini] selected products without a reference image", {
      productIds: uncoveredSelected,
      skipped: referenceLoad.skipped.filter((entry) =>
        uncoveredSelected.includes(entry.productId)
      ),
    });
  }

  /**
   * Two-stage generation: large anchor furniture first (against the customer's
   * real photo), then smaller secondary pieces layered onto that result. A
   * single pass degrades as the task count rises, so this is used only when the
   * plan is genuinely mixed and large enough to benefit.
   *
   * ---------------------------------------------------------------------------
   * WHY GEMINI REPLACE-ITEMS IS SINGLE-STAGE
   * ---------------------------------------------------------------------------
   * The strong renderer benchmark was a SINGLE render carrying every task
   * against the untouched room photo. The app was doing something materially
   * different for the same three products: Kelly and Elva are `sofa` (anchor)
   * and Aspen is `coffee-table` (secondary), which is exactly three tasks with
   * both stages present — so `shouldUseTwoStageGeneration` fired and split it.
   *
   * That costs twice and, more importantly, changes the inputs. Stage 2 edits
   * STAGE 1'S OUTPUT rather than the customer's photo, so the coffee table is
   * placed into an already-generated image: a second round of lossy re-drawing
   * over furniture that was itself just drawn. Every reported symptom of the
   * phone test — roughly double the latency, and the coffee table faring worse
   * than the sofas — follows from that difference, and the benchmark never had
   * it.
   *
   * So the replace-items path on Gemini now matches the architecture that
   * actually produced the good result. Surprise Me is deliberately untouched:
   * it composes a whole room rather than swapping named items, and nothing has
   * been measured about it here.
   */
  const singleStageForGemini = renderer.id === "gemini" && !surpriseMe;
  const useTwoStage =
    !singleStageForGemini && shouldUseTwoStageGeneration(replacementPlan);
  const stagePlans = useTwoStage
    ? splitPlanByStage(replacementPlan)
    : [{ stage: "anchor" as const, plan: replacementPlan }];
  const generationMode: "single-stage" | "two-stage" = useTwoStage
    ? "two-stage"
    : "single-stage";

  // Only send the references a stage actually needs, so each pass sees a small,
  // unambiguous set of products.
  const referencesForPlan = (stagePlan: ReplacementPlan) => {
    const wanted = new Set([
      ...stagePlan.replacements.map((task) => task.productId),
      ...stagePlan.additions.map((task) => task.productId),
    ]);
    return referenceManifest.transmitted
      .filter((entry) => wanted.has(entry.productId))
      .map((entry) => {
        const loaded = referenceLoad.loaded.find(
          (candidate) =>
            candidate.productId === entry.productId &&
            candidate.view === entry.viewType
        );
        return loaded ? { label: entry.label, file: loaded.file } : null;
      })
      .filter((entry): entry is { label: string; file: File } => entry !== null);
  };

  /**
   * Always logged, not behind devLog: `devLog` is gated on NODE_ENV and
   * therefore silent on Vercel, which is precisely why the last investigation
   * could not tell which renderer had run. Gated on the debug flag instead, so
   * it works in preview where it is needed.
   */
  if (isAiDebugEnabled()) {
    console.log("[studio-gemini] generation mode", {
      generationMode,
      renderer: renderer.id,
      plannedRenderCalls: stagePlans.length,
      stages: stagePlans.map((entry) => entry.stage),
      baseImage:
        stagePlans.length === 1
          ? "the customer's original room photo"
          : "photo for stage 1, previous stage output thereafter",
      tasksInRender: stagePlans.map((entry) => ({
        stage: entry.stage,
        replace: entry.plan.replacements.map(
          (task) => `#${task.taskId} ${task.existingInstanceLabel} -> ${task.productTitle}`
        ),
        remove: entry.plan.removals.map((task) => `#${task.taskId} ${task.existingInstanceLabel}`),
        add: entry.plan.additions.map((task) => `#${task.taskId} ${task.productTitle}`),
      })),
    });
  }

  devLog("[studio-gemini] generation request", {
    renderer: renderer.id,
    imageName: image.name,
    imageType: image.type,
    imageSize: image.size,
    roomType,
    style,
    aiConceptMode,
    selectedProductIds: orderedSelectedIds,
    referencesTransmitted: referenceManifest.transmitted.length,
    referencesSkipped: referenceLoad.skipped.length,
    uncoveredSelectedProducts: uncoveredSelected,
    sceneAnalysed: sceneGraph.analysed,
    sceneFurnitureCount: sceneGraph.furniture.length,
    architecture: sceneGraph.architecture,
    planReplacements: replacementPlan.replacements.length,
    planAdditions: replacementPlan.additions.length,
    planDispositions: replacementPlan.dispositions.length,
    twoStage: useTwoStage,
    stages: stagePlans.map((entry) => entry.stage),
    surpriseMe,
    autoPackageItems: autoPackage?.items.length ?? 0,
  });

  // Generate → review → regenerate once on a contract failure, per stage, with
  // a hard ceiling on total image generations so a two-stage plan cannot
  // quadruple cost.
  const attempts: {
    image: GeneratedImageResult;
    review: QualityReview | null;
    reviewStatus: ReviewStatus;
    reviewUnavailableReason: string | null;
  }[] = [];
  const prompts: { stage: string; prompt: string }[] = [];
  let negativePrompt: string[] = [];
  let generationsUsed = 0;
  // The image each stage edits: the customer's photo first, then the previous
  // stage's output.
  let stageInputImage: File = image;
  let finalAttempt: (typeof attempts)[number] | null = null;

  for (const [stageIndex, { stage, plan: stagePlan }] of stagePlans.entries()) {
    const isLastStage = stageIndex === stagePlans.length - 1;
    const isSecondPass = stageIndex > 0;
    const stageReferences = referencesForPlan(stagePlan);

    const built = buildIntelligentRoomPrompt({
      roomAnalysis,
      sceneGraph,
      replacementPlan: stagePlan,
      profiles,
      style: effectiveStyle,
      roomType,
      aiConceptMode: effectiveConceptMode,
      selectedProductIds: orderedSelectedIds,
      measurements: roomMeasurements,
      // Transmitted count for THIS pass, never the loaded count.
      referenceViewCount: stageReferences.length,
      stage,
      isSecondPass,
    });
    prompts.push({ stage, prompt: built.prompt });
    negativePrompt = built.negativePrompt;

    const stageAttempts: typeof attempts = [];

    const maxGenerationAttempts = getMaxGenerationAttempts();
    for (let attempt = 0; attempt < maxGenerationAttempts; attempt += 1) {
      if (generationsUsed >= MAX_TOTAL_IMAGE_GENERATIONS) {
        console.warn("[studio-gemini] generation budget exhausted", {
          stage,
          generationsUsed,
        });
        break;
      }

      const renderStartedAt = Date.now();
      const generatedImage = await renderer.generate({
        prompt: built.prompt,
        roomImage: stageInputImage,
        productImages: [],
        labelledProductImages: stageReferences,
        // The renderer's own credentials, NOT the analysis key.
        apiKey: renderer.apiKey,
      });
      generationsUsed += 1;
      if (isAiDebugEnabled()) {
        console.log("[studio-gemini] render call", {
          renderCall: generationsUsed,
          generationMode,
          stage,
          attempt: attempt + 1,
          renderMs: Date.now() - renderStartedAt,
          taskCount:
            stagePlan.replacements.length +
            stagePlan.removals.length +
            stagePlan.additions.length,
          referencesSent: stageReferences.length,
          editedImage: isSecondPass
            ? "previous stage output"
            : "original room photo",
        });
      }

      // The final stage is judged against the FULL plan — the finished image
      // must satisfy every task, not just this pass's subset. Earlier stages
      // are judged against their own subset so retries stay targeted. The
      // original room photo is always the comparison baseline, so architectural
      // drift introduced by any pass is still caught.
      const outcome = await reviewGeneratedRoom({
        generatedBase64: generatedImage.imageBase64,
        generatedMimeType: generatedImage.mimeType,
        roomImage: image,
        replacementPlan: isLastStage ? replacementPlan : stagePlan,
        architecture: sceneGraph.architecture,
        apiKey,
      });

      // The reviewer is fail-open by design (it must never block generation),
      // but an unavailable review is NOT a pass and must never be silent.
      if (outcome.status === "review-unavailable") {
        console.warn("[studio-gemini] quality review unavailable", {
          stage,
          attempt: attempt + 1,
          reason: outcome.reason,
        });
      }

      /**
       * One flat required-vs-observed record per attempt.
       *
       * The retry decision still belongs to `reviewRecommendsRegeneration`
       * below — this only reports, so the auto-retry that comes next can
       * branch on `contractSatisfied` instead of re-deriving it.
       */
      const diagnostics = buildRenderDiagnostics({
        attempt: attempt + 1,
        provider: renderer.id,
        plan: isLastStage ? replacementPlan : stagePlan,
        manifest: referenceManifest,
        review: outcome.review,
        recommendation: outcome.review
          ? reviewRecommendsRegeneration(outcome.review)
            ? "regenerate"
            : "accept"
          : undefined,
      });
      logRenderDiagnostics(diagnostics);

      const record = {
        image: generatedImage,
        review: outcome.review,
        reviewStatus: outcome.status,
        reviewUnavailableReason:
          outcome.status === "review-unavailable" ? outcome.reason : null,
        diagnostics,
      };
      stageAttempts.push(record);
      attempts.push(record);

      // Accept as soon as the reviewer is satisfied (or could not run).
      if (!reviewRecommendsRegeneration(outcome.review)) break;
    }

    if (stageAttempts.length === 0) break;

    // Carry the best attempt of this stage into the next one.
    const stageBest = pickBestAttempt(stageAttempts);
    finalAttempt = stageBest;

    if (!isLastStage) {
      const buffer = base64ToImageBuffer(stageBest.image.imageBase64);
      if (!buffer) {
        console.warn(
          "[studio-gemini] could not carry stage output forward; stopping after this stage"
        );
        break;
      }
      stageInputImage = new File([new Uint8Array(buffer)], "stage-output.png", {
        type: stageBest.image.mimeType || "image/png",
      });
    }
  }

  if (!finalAttempt) {
    throw new Error(`${renderer.label} image generation produced no result.`);
  }

  // The result is the best attempt of the FINAL stage. It must never be an
  // earlier stage's image: a stage-1 render is deliberately incomplete (it has
  // the anchor furniture but none of the secondary pieces), so ranking across
  // all stages by score could return a room missing half the customer's
  // products.
  const best = finalAttempt;
  const autoRegenerated = attempts.length > stagePlans.length;
  // Legacy 5-axis score kept populated for the existing debug view.
  const qualityScore: QualityScore | null = best.review
    ? reviewToQualityScore(best.review)
    : null;

  // Products used: only what the plan actually placed, minus anything the
  // reviewer positively reported as missing. A product the customer never had
  // rendered should not appear in "products used in this room".
  const plannedProductIds = new Set([
    ...replacementPlan.replacements.map((task) => task.productId),
    ...replacementPlan.additions.map((task) => task.productId),
  ]);
  // A product only counts as "used in this room" if the reviewer's evidence
  // says it is actually there AS THAT PRODUCT. Being present is not enough:
  // the wrong category, a different-looking item, or the original merely
  // recoloured all mean the customer would be shown something they cannot see.
  const failedComplianceProductIds = new Set(
    (best.review?.taskResults ?? [])
      .filter(
        (task) =>
          !task.productPresent ||
          !task.categoryCorrect ||
          !task.identityMatches ||
          !task.genuineReplacement
      )
      .map((task) => task.productId)
  );
  const verifiedProducts = products.filter((product) => {
    if (!plannedProductIds.has(product.id)) return false;
    // Only drop on POSITIVE negative evidence; an unavailable review must not
    // silently shrink the room package.
    if (best.reviewStatus === "review-unavailable") return true;
    return !failedComplianceProductIds.has(product.id);
  });
  const droppedProducts = products
    .filter((product) => !verifiedProducts.some((kept) => kept.id === product.id))
    .map((product) => product.id);

  if (droppedProducts.length > 0) {
    console.warn("[studio-gemini] products excluded from the room package", {
      productIds: droppedProducts,
      reviewStatus: best.reviewStatus,
    });
  }

  devLog("[studio-gemini] generation result", {
    stages: stagePlans.length,
    generationsUsed,
    attempts: attempts.length,
    reviewStatus: best.reviewStatus,
    recommendation: best.review?.recommendation ?? "n/a",
    contractCompliant: best.review?.contractCompliant ?? null,
    criticalFailures: best.review?.criticalFailures.map((f) => f.kind) ?? [],
    reviewOverall: best.review?.overall ?? null,
    productsReturned: verifiedProducts.length,
    productsDropped: droppedProducts,
  });

  const responseBody: Record<string, unknown> = {
    images: [best.image],
    imageBase64: best.image.imageBase64,
    products: verifiedProducts,
    // Units per product. The browser cannot know these — it never saw how many
    // sofas the room has — so the basket takes them from here.
    ...(resolvedIntent
      ? {
          productQuantities: resolvedIntent.quantities,
          unmatchedCategories: resolvedIntent.unmatchedCategories,
        }
      : {}),
  };

  // AI debug payload — only exposed when explicitly enabled, so production
  // responses stay lean and the client only logs when debugging.
  if (isAiDebugEnabled()) {
    responseBody.aiDebug = {
      provider: best.image.provider,
      // Proof, not a claim: whether THIS request paid for a fresh vision call
      // or reused an analysis from moments ago. Internal only — a customer
      // has no reason to see a cache key.
      sceneAnalysis: {
        imageHash: sceneCacheKey,
        source: cachedScene ? "cache" : "fresh",
        analysisCallMade: !cachedScene,
      },
      sceneGraph,
      roomAnalysis,
      replacementPlan,
      qualityScore,
      qualityReview: best.review,
      reviewStatus: best.reviewStatus,
      reviewUnavailableReason: best.reviewUnavailableReason,
      contractCompliant: best.review?.contractCompliant ?? null,
      criticalFailures: best.review?.criticalFailures ?? [],
      // Why the result was accepted or rejected, in the reviewer's own words.
      reviewReasoning: {
        global: best.review?.globalChecks.reasoning ?? null,
        globalChecks: best.review?.globalChecks ?? null,
        perTask: (best.review?.taskResults ?? []).map((task) => ({
          taskId: task.taskId,
          productId: task.productId,
          reasoning: task.reasoning,
          issues: task.issues,
        })),
      },
      generationAttempts: attempts.length,
      generationsUsed,
      twoStage: useTwoStage,
      stages: stagePlans.map((entry) => entry.stage),
      autoRegenerated,
      // Kept as `prompt` for the existing debug view; `prompts` has every pass.
      prompt: prompts.map((entry) => `--- ${entry.stage} ---\n${entry.prompt}`).join("\n\n"),
      prompts,
      negativePrompt,
      referenceManifest,
      referenceSkipped: referenceLoad.skipped,
      // The package Surprise me chose behind the scenes, so a failed room can
      // still be diagnosed against what was actually intended.
      autoPackage,
      productsDropped: droppedProducts,
      // Number of images ACTUALLY transmitted with the request.
      referenceViewCount: referenceManifest.transmitted.length,
    };
  }

  return NextResponse.json(responseBody);
}

async function handleRefinement(req: Request) {
  const body = await req.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Invalid refinement request." },
      { status: 400 }
    );
  }

  const request = body as {
    imageBase64?: unknown;
    imageMimeType?: unknown;
    changeRequest?: unknown;
    refinementProductIds?: unknown;
  };
  const imageMimeType =
    typeof request.imageMimeType === "string" &&
    SUPPORTED_REFINEMENT_IMAGE_TYPES.has(request.imageMimeType)
      ? request.imageMimeType
      : "image/png";
  const changeRequest =
    typeof request.changeRequest === "string"
      ? request.changeRequest.trim()
      : "";
  const refinementProductIds = Array.isArray(request.refinementProductIds)
    ? request.refinementProductIds.filter(
        (productId): productId is string => typeof productId === "string"
      )
    : [];

  if (!request.imageBase64) {
    return NextResponse.json(
      { error: "Missing selected concept image." },
      { status: 400 }
    );
  }

  if (!changeRequest && refinementProductIds.length === 0) {
    return NextResponse.json(
      { error: "Add a refinement instruction or select products to swap/add." },
      { status: 400 }
    );
  }

  const imageBuffer = base64ToImageBuffer(request.imageBase64);

  if (!imageBuffer) {
    return NextResponse.json(
      { error: "Invalid selected concept image." },
      { status: 400 }
    );
  }

  const imageExtension =
    imageMimeType === "image/jpeg"
      ? "jpg"
      : imageMimeType === "image/webp"
        ? "webp"
        : "png";
  const conceptImage = new File(
    [imageBuffer],
    `studio-concept.${imageExtension}`,
    { type: imageMimeType }
  );
  const products = getProductsByIds(refinementProductIds);
  const productList = products
    .map((product, index) => `${index + 1}. ${formatProductForPrompt(product)}`)
    .join("\n\n");
  const productImageFiles = await loadProductReferenceImageFiles(
    products,
    "[studio-gemini-refine]"
  );
  const prompt = `
Refine this full-room Koala Living interior concept.

Requested change:
"${changeRequest || "Add or swap the supplied product references naturally."}"

Selected product references:
${productList || "None"}

${buildRoomPreservationInstructions()}
- Preserve the current full-room framing, camera angle, architecture, and room proportions.
- Change only what the user requested.
- If product references are supplied, match their visible silhouette, colour, material, category, and realistic scale.
- Keep selected products visually clear but naturally placed.
${buildScaleInstructions()}
- Prioritise photorealistic interior photography.
- Do not add people, text, or logos.
`;

  devLog("[studio-gemini] refinement request", {
    imageMimeType,
    imageBase64Length:
      typeof request.imageBase64 === "string"
        ? request.imageBase64.length
        : 0,
    changeRequestExists: Boolean(changeRequest),
    refinementProductIds,
    productReferenceCount: productImageFiles.length,
  });

  // Refinement edits a room image exactly as generation does, so it uses the
  // same renderer. Splitting them would mean a customer's refine silently
  // switched providers mid-session and the result stopped matching the room
  // they were just looking at.
  const refineRenderer = getRoomEditProvider();
  if (!refineRenderer.available) {
    throw new Error(
      refineRenderer.unavailableReason ??
        `The ${refineRenderer.label} renderer is not configured.`
    );
  }

  const refinedImage = await refineRenderer.generate({
    prompt,
    roomImage: conceptImage,
    productImages: productImageFiles,
    apiKey: refineRenderer.apiKey,
  });

  return NextResponse.json({
    images: [refinedImage],
    imageBase64: refinedImage.imageBase64,
    products,
  });
}

/**
 * Maximum wall-clock for this route.
 *
 * A render is 2-3 minutes and `after` runs inside the SAME function invocation,
 * so the background work is bounded by this too. Without it the platform
 * default would kill the job partway through and the customer would poll a
 * record that never leaves "running".
 */
export const maxDuration = 300;

/**
 * Start a generation as a background job and return its id immediately.
 *
 * `after` runs the callback once the response has been sent, within this
 * invocation's maxDuration — so the customer gets a job id in milliseconds
 * while the render continues server-side. The job record is what makes the
 * result survive a refresh: without it, the in-flight request dies with the
 * page and a paid-for render is lost.
 */
async function startGenerationJob(req: Request) {
  // The FormData is read up front: it is needed either way, and a request body
  // cannot be read from inside `after`.
  const formData = await req.formData();

  /**
   * Refuse to go async without durable storage.
   *
   * This is the "we lost track of this generation" bug. With the in-memory
   * store the POST creates the job on one serverless instance and the status
   * GET lands on another, which finds nothing — while `after` on the original
   * instance runs the render to completion and it is BILLED. The customer pays
   * for an image they never receive, and the error invites them to try again
   * and pay twice.
   *
   * So a job id is only ever handed out when it can genuinely be recovered.
   * Otherwise this request does the work synchronously and returns the ordinary
   * generation body — the path that worked before async existed. One request
   * either way: no wasted render, and no possibility of double-charging.
   */
  if (!supportsDurableGenerationJobs()) {
    console.warn(
      "[studio-gemini] async generation unavailable; using the synchronous path",
      generationJobCapability()
    );
    return handleGeneration(req, { preloadedFormData: formData });
  }

  const store = getJobStore();
  const jobId = createJobId();
  await store.create(newJob(jobId));

  after(async () => {
    try {
      await store.update(jobId, { status: "running", stage: "analysing" });
      const response = await handleGeneration(req, { preloadedFormData: formData });
      const body = await response.json();

      if (!response.ok) {
        await store.update(jobId, {
          status: "failed",
          error:
            typeof body?.error === "string"
              ? body.error
              : "Room image generation failed. Please try again.",
        });
        return;
      }
      await store.update(jobId, { status: "succeeded", result: body });
    } catch (error) {
      console.error("[studio-gemini] background job failed", { jobId, error });
      await store.update(jobId, {
        status: "failed",
        error:
          getErrorText(error) ||
          "Room image generation failed. Please try again.",
      });
    }
  });

  return NextResponse.json({
    jobId,
    status: "queued",
    // The client uses this to decide whether to promise restore-on-refresh.
    durable: store.isDurable,
  });
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      return await handleRefinement(req);
    }

    if (contentType.includes("multipart/form-data")) {
      // Opt-in async path. The synchronous path is kept intact so the existing
      // client, and the Surprise Me flow, are unaffected until they opt in.
      const url = new URL(req.url);
      if (url.searchParams.get("async") === "1") {
        return await startGenerationJob(req);
      }
      return await handleGeneration(req);
    }

    return NextResponse.json(
      { error: "Unsupported Studio request format." },
      { status: 415 }
    );
  } catch (error) {
    console.error("[studio-gemini] request failed", error);

    return NextResponse.json(
      {
        error:
          getErrorText(error) ||
          "Room image generation failed. Please try again.",
      },
      { status: 500 }
    );
  }
}
