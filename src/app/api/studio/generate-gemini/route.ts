import { NextResponse } from "next/server";
import {
  generateGeminiImage,
} from "@/features/room-stylist/services/image-providers/gemini";
import type { GeneratedImageResult } from "@/features/room-stylist/services/image-providers/types";
import { loadProductReferenceImageFiles } from "@/lib/product-image-references";
import {
  buildRoomPreservationInstructions,
  buildScaleInstructions,
  formatProductForPrompt,
  type RoomMeasurements,
} from "@/lib/prompts";
import {
  getProductsByIds,
  getProductsForStyle,
  type Product,
} from "@/lib/products";
import { getProductProfiles } from "@/lib/intelligence/product-profile";
import {
  analyzeSceneGraph,
  sceneGraphToRoomAnalysis,
} from "@/lib/intelligence/scene-graph";
import { buildIntelligentRoomPrompt } from "@/lib/intelligence/prompt-builder";
import { buildReplacementPlan } from "@/lib/intelligence/replacement-planner";
import type { QualityScore } from "@/lib/intelligence/quality-score";
import {
  reviewGeneratedRoom,
  reviewRecommendsRegeneration,
  reviewToQualityScore,
  type QualityReview,
} from "@/lib/intelligence/quality-reviewer";

// Up to 2 generation attempts; regenerate once if the first is below the
// quality threshold. Kept small to bound latency/cost.
const MAX_GENERATION_ATTEMPTS = 2;

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
  "Gemini is not configured. Add GEMINI_API_KEY.";

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

function getStudioGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || "";

  if (!apiKey) {
    throw new Error(GEMINI_CONFIGURATION_ERROR);
  }

  return apiKey;
}

async function handleGeneration(req: Request) {
  const formData = await req.formData();
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

  const selectedProducts = getProductsByIds(selectedProductIds);
  const styleProducts = getProductsForStyle(style);
  const products = aiConceptMode
    ? mergeProductsById(selectedProducts, styleProducts)
    : selectedProducts;
  const roomMeasurements = parseRoomMeasurements(formData);
  const apiKey = getStudioGeminiApiKey();

  // Phase 1 — product intelligence profiles.
  const profiles = getProductProfiles(products);

  // Phase 2 — multiple product reference views.
  const productImageFiles = await loadProductReferenceImageFiles(
    products,
    "[studio-gemini]"
  );

  // Phase 3 — structured room understanding via a scene graph (fallback-safe).
  const sceneGraph = await analyzeSceneGraph(image, {
    apiKey,
    roomTypeHint: roomType,
  });
  const roomAnalysis = sceneGraphToRoomAnalysis(sceneGraph);

  // Sprint 2 — deterministic replacement plan: exactly one destination for
  // every selected product (replace an existing item or place it in a zone),
  // never touching fixed objects. Built before the prompt so generation knows
  // precisely what changes. Fully deterministic and fallback-safe.
  const replacementPlan = buildReplacementPlan({
    sceneGraph,
    profiles,
    selectedProductIds,
    aiConceptMode,
  });

  // Phase 4 — dynamic prompt from scene graph + product intelligence + plan.
  const { prompt, negativePrompt } = buildIntelligentRoomPrompt({
    roomAnalysis,
    sceneGraph,
    replacementPlan,
    profiles,
    style,
    roomType,
    aiConceptMode,
    selectedProductIds,
    measurements: roomMeasurements,
    referenceViewCount: productImageFiles.length,
  });

  devLog("[studio-gemini] generation request", {
    imageName: image.name,
    imageType: image.type,
    imageSize: image.size,
    roomType,
    style,
    aiConceptMode,
    selectedProductIds,
    productReferenceCount: productImageFiles.length,
    sceneAnalysed: sceneGraph.analysed,
    sceneFurnitureCount: sceneGraph.furniture.length,
    sceneFixedObjectCount: sceneGraph.fixedObjects.length,
    planReplacements: replacementPlan.replacements.length,
    planAdditions: replacementPlan.additions.length,
  });

  // Phase 5 — generate, then run the second-pass Quality Reviewer V2 against the
  // original room + replacement plan. A critical failure (duplicated furniture,
  // wrong placement, missing product, changed architecture) or a below-threshold
  // overall triggers exactly one automatic regeneration.
  const attempts: {
    image: GeneratedImageResult;
    review: QualityReview | null;
  }[] = [];

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const generatedImage = await generateGeminiImage({
      prompt,
      roomImage: image,
      productImages: productImageFiles,
      apiKey,
    });
    const review = await reviewGeneratedRoom({
      generatedBase64: generatedImage.imageBase64,
      generatedMimeType: generatedImage.mimeType,
      roomImage: image,
      replacementPlan,
      apiKey,
    });

    attempts.push({ image: generatedImage, review });

    // Accept as soon as the reviewer is satisfied (or unavailable).
    if (!reviewRecommendsRegeneration(review)) break;
  }

  const best = attempts.reduce((bestSoFar, candidate) =>
    (candidate.review?.overall ?? -1) > (bestSoFar.review?.overall ?? -1)
      ? candidate
      : bestSoFar
  );
  const autoRegenerated = attempts.length > 1;
  // Legacy 5-axis score kept populated for the existing debug view.
  const qualityScore: QualityScore | null = best.review
    ? reviewToQualityScore(best.review)
    : null;

  devLog("[studio-gemini] generation result", {
    attempts: attempts.length,
    recommendation: best.review?.recommendation ?? "n/a",
    reviewOverall: best.review?.overall ?? null,
  });

  const responseBody: Record<string, unknown> = {
    images: [best.image],
    imageBase64: best.image.imageBase64,
    products,
  };

  // AI debug payload — only exposed when explicitly enabled, so production
  // responses stay lean and the client only logs when debugging.
  if (isAiDebugEnabled()) {
    responseBody.aiDebug = {
      provider: best.image.provider,
      sceneGraph,
      roomAnalysis,
      replacementPlan,
      qualityScore,
      qualityReview: best.review,
      generationAttempts: attempts.length,
      autoRegenerated,
      prompt,
      negativePrompt,
      referenceViewCount: productImageFiles.length,
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

  const refinedImage = await generateGeminiImage({
    prompt,
    roomImage: conceptImage,
    productImages: productImageFiles,
    apiKey: getStudioGeminiApiKey(),
  });

  return NextResponse.json({
    images: [refinedImage],
    imageBase64: refinedImage.imageBase64,
    products,
  });
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      return await handleRefinement(req);
    }

    if (contentType.includes("multipart/form-data")) {
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
          "Gemini image generation failed. Please try again.",
      },
      { status: 500 }
    );
  }
}
