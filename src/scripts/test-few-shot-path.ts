/**
 * The few-shot strategy: references, prompt, flag, retry policy, timings.
 *
 * Run with:  npm run test:few-shot
 *
 * Offline and free — no paid generation happens here. Everything asserted is
 * either pure data (which images a SKU resolves to, what the prompt contains)
 * or a structural property of the route, so the first paid run on a phone is
 * not also the first time any of this executes.
 */
import { readFileSync } from "node:fs";
import {
  FEW_SHOT_SKUS,
  fewShotCoverage,
  getFewShotSku,
  loadFewShotReferences,
  MAX_FEW_SHOT_REFERENCES,
} from "@/lib/intelligence/few-shot-references";
import {
  BASELINE_PRESERVED,
  buildFewShotPrompt,
  describeTarget,
  type FewShotReplacement,
} from "@/lib/intelligence/few-shot-prompt";
import {
  customerNoteSection,
  MAX_CUSTOMER_NOTE_LENGTH,
  normaliseCustomerNote,
} from "@/lib/intelligence/customer-note";
import {
  DEFAULT_ROOM_EDIT_STRATEGY,
  getRoomEditStrategy,
} from "@/lib/intelligence/room-edit-strategy";
import { createTimings, unattributedMs } from "@/lib/generation-timings";
import { checkFewShotEligibility } from "@/features/room-stylist/services/few-shot-room-edit";
import {
  FEW_SHOT_RENDERER_ID,
  generateFewShotRoomEdit,
  ROOM_MAX_HEIGHT,
  ROOM_MAX_WIDTH,
} from "@/features/room-stylist/services/image-providers/gemini-few-shot";
import { assertStudioGeminiProvider } from "@/components/studio/studio-gemini-api";
import sharp from "sharp";
import {
  buildReplacementContract,
  contractProductIds,
  type AssignmentInput,
  type ReplacementContract,
} from "@/lib/intelligence/replacement-assignment";
import type { RoomSelection } from "@/lib/intelligence/room-selection";
import { getProductProfiles } from "@/lib/intelligence/product-profile";
import { getProductsByIdsInSelectionOrder } from "@/lib/products";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const KELLY = "kelly-pearl-beige-fabric-3-seater-sofa-champagne-gold-legs";
const ELVA = "elva-green-pastel-nubuck-leather-3-seater-sofa";
const ASPEN = "aspen-white-sintered-stone-coffee-table-matte-black-legs";
const POC_IDS = [KELLY, ELVA, ASPEN];

async function main() {
console.log("\nValidated reference classifications");
{
  for (const id of POC_IDS) {
    const sku = getFewShotSku(id);
    check(`${id.split("-")[0]} has a classification`, Boolean(sku));
    check(
      `${id.split("-")[0]} sends exactly ${MAX_FEW_SHOT_REFERENCES} references`,
      sku?.references.length === MAX_FEW_SHOT_REFERENCES,
      `got ${sku?.references.length}`
    );
    check(
      `${id.split("-")[0]} has one hero and one depth view`,
      sku?.references.filter((r) => r.role === "hero").length === 1 &&
        sku?.references.filter((r) => r.role === "depth").length === 1
    );
  }

  // The specific correction this module exists to make.
  const kelly = getFewShotSku(KELLY);
  check(
    "Kelly's second reference is the rear 3/4, NOT the mislabelled arm crop",
    kelly?.references[1]?.file === "03-side.webp",
    `got ${kelly?.references[1]?.file}`
  );
  const files = Object.values(FEW_SHOT_SKUS).flatMap((sku) =>
    sku.references.map((reference) => reference.file)
  );
  check(
    "no detail macro is ever selected",
    !files.some((file) => /detail/i.test(file)),
    files.join(", ")
  );
  check(
    "no occluded lifestyle image is ever selected",
    !files.some((file) => /lifestyle/i.test(file)),
    files.join(", ")
  );
  check(
    "no cropped part-view is selected",
    !files.some((file) => /45-degree/i.test(file)),
    files.join(", ")
  );
}

console.log("\nReference loading from disk");
{
  const products = POC_IDS.map((id) => ({ id, name: id }));
  const { loaded, skipped } = await loadFewShotReferences(products);
  check(
    "all six reference files load",
    loaded.length === 6,
    `loaded ${loaded.length}, skipped ${skipped.length}`
  );
  /**
   * Every `main.jpg` in this catalogue is really a WebP. Sniffing is what makes
   * the declared MIME type match the bytes; trusting the extension would send
   * `image/jpeg` for WebP data, which the provider drops silently.
   */
  const mislabelled = loaded.filter((reference) => reference.file.name.endsWith(".jpg"));
  check(
    "MIME types are sniffed, not taken from the extension",
    mislabelled.length > 0 && mislabelled.every((reference) => reference.file.type === "image/webp"),
    loaded.map((r) => `${r.file.name}:${r.file.type}`).join(" ")
  );
  check(
    "every reference declares a type the provider accepts",
    loaded.every((reference) =>
      ["image/jpeg", "image/png", "image/webp"].includes(reference.file.type)
    ),
    loaded.map((r) => r.file.type).join(" ")
  );
  check(
    "every reference has real bytes",
    loaded.every((reference) => reference.bytes > 1024)
  );
  check(
    "Kelly + Elva + Aspen send 7 images in total (6 references + the room)",
    loaded.length + 1 === 7
  );
}

console.log("\nPrompt");
{
  const replacements: FewShotReplacement[] = [
    { targetDescription: "dark fabric sofa", location: "on the left", productTitle: "Kelly", category: "sofa", sku: getFewShotSku(KELLY)! },
    { targetDescription: "navy leather sofa", location: "on the right", productTitle: "Elva", category: "sofa", sku: getFewShotSku(ELVA)! },
    { targetDescription: "wooden coffee table", location: "in the centre", productTitle: "Aspen", category: "coffee-table", sku: getFewShotSku(ASPEN)! },
  ];
  const prompt = buildFewShotPrompt({
    replacements,
    references: [
      { productTitle: "Kelly", view: "front" },
      { productTitle: "Kelly", view: "rear-three-quarter" },
    ],
    preserved: [...BASELINE_PRESERVED, "the other sofa"],
  });
  const bytes = Buffer.byteLength(prompt, "utf8");

  check("the prompt describes every target visually",
    replacements.every((r) => prompt.includes(r.targetDescription)));
  check("the prompt carries each target's location",
    prompt.includes("on the left") && prompt.includes("in the centre"));
  check("targets read as descriptions, never as picker labels",
    !/\bSofa \d\b/.test(prompt), prompt);
  check("each SKU contributes exactly one signature sentence",
    replacements.every((r) => prompt.split(r.sku.signature).length === 2));
  check("the reference order is stated in prose, not as image labels",
    /in this order: 1\. the Kelly — front view; 2\. the Kelly — rear three quarter view/.test(prompt));
  check("objects on replaced furniture are explicitly preserved",
    /settle naturally onto or beside the replacement/.test(prompt));
  check("preservation is concrete, not generic",
    BASELINE_PRESERVED.every((entry) => prompt.includes(entry)));
  check("contract-protected items join the preservation list",
    prompt.includes("the other sofa"));
  check("the room must not be cleared or restyled",
    /Do not clear, tidy or restyle the room/.test(prompt));
  check("nothing may be added", /Add nothing to the room/.test(prompt));

  /**
   * The grounding path measured 19,142 bytes for this same three-product room;
   * anything approaching that means metadata has leaked back in.
   */
  check(`the 3-product prompt stays under 2.5KB (got ${bytes}B vs 19,142B grounding)`,
    bytes < 2560, `${bytes} bytes`);

  check("describeTarget adds an article when the description lacks one",
    describeTarget({ targetDescription: "dark fabric sofa", location: "on the left" }) ===
      "the dark fabric sofa on the left");
  check("describeTarget does not double the article",
    describeTarget({ targetDescription: "the left sofa", location: null }) === "the left sofa");
}

console.log("\nFeature flag");
{
  const original = process.env.ROOM_EDIT_STRATEGY;
  check("the default strategy is the existing grounding path", DEFAULT_ROOM_EDIT_STRATEGY === "grounding");

  delete process.env.ROOM_EDIT_STRATEGY;
  check("unset falls back to grounding", getRoomEditStrategy() === "grounding");

  process.env.ROOM_EDIT_STRATEGY = "few-shot";
  check("ROOM_EDIT_STRATEGY=few-shot selects the new path", getRoomEditStrategy() === "few-shot");

  process.env.ROOM_EDIT_STRATEGY = "nonsense";
  check("a typo falls back to grounding rather than failing", getRoomEditStrategy() === "grounding");

  if (original === undefined) delete process.env.ROOM_EDIT_STRATEGY;
  else process.env.ROOM_EDIT_STRATEGY = original;
}

console.log("\nEligibility — every ineligible case must fall back, never fail");
{
  const target = {
    targetId: "scene_sofa_left",
    sceneItemId: "sofa_left",
    canonicalCategory: "sofa" as const,
    instanceLabel: "left sofa",
    displayName: "dark sofa",
    boundingBox: { x: 0, y: 0, width: 1, height: 1 },
    selectionMethod: "scene" as const,
    location: "on the left",
  };
  const contract = {
    assignments: [
      {
        taskId: 1,
        action: "REPLACE" as const,
        target,
        productId: KELLY,
        productTitle: "Kelly",
        productCategorySlug: "sofas",
        canonicalCategory: "sofa" as const,
        scope: "single" as const,
      },
    ],
    protectedItems: [],
    sourceImage: { width: 100, height: 100 },
  } as unknown as ReplacementContract;

  check("a valid contract with covered products is eligible",
    checkFewShotEligibility({ contract, surpriseMe: false, productIds: [KELLY] }).eligible);
  check("surprise-me is not eligible",
    !checkFewShotEligibility({ contract, surpriseMe: true, productIds: [KELLY] }).eligible);
  check("a missing contract is not eligible",
    !checkFewShotEligibility({ contract: null, surpriseMe: false, productIds: [KELLY] }).eligible);
  check("an unclassified product is not eligible",
    !checkFewShotEligibility({ contract, surpriseMe: false, productIds: ["some-other-sofa"] }).eligible);
  check("all three POC products together are eligible",
    checkFewShotEligibility({ contract, surpriseMe: false, productIds: POC_IDS }).eligible);

  const coverage = fewShotCoverage([...POC_IDS, "unknown-product"]);
  check("coverage reports the uncovered product by id",
    coverage.covered.length === 3 && coverage.uncovered[0] === "unknown-product");
}

console.log("\nTimings");
{
  const timings = createTimings();
  await timings.measure("room-preprocess", async () => new Promise((r) => setTimeout(r, 12)));
  timings.add("provider-request", 500);
  timings.recordProviderAttempt();
  const snapshot = timings.snapshot();

  check("room preprocessing is measured separately", snapshot.phases["room-preprocess"] >= 10);
  check("provider request time is measured separately", snapshot.phases["provider-request"] === 500);
  check("reference preparation has its own phase", "reference-prepare" in snapshot.phases);
  check("provider wait/backoff has its own phase", "provider-wait" in snapshot.phases);
  check("total user-visible time is recorded", snapshot.totalMs >= 10);
  check("provider attempts are counted", snapshot.providerAttempts === 1);
  check("unmeasured time is surfaced rather than hidden", unattributedMs(snapshot) >= 0);
}

console.log("\nRetry policy — fail fast, never hold the customer");
{
  const SRC = readFileSync("src/features/room-stylist/services/image-providers/gemini-few-shot.ts", "utf8");
  check("every attempt has a hard request timeout", /signal: AbortSignal\.timeout\(/.test(SRC));
  check("a total wall-clock budget bounds the whole call", /const deadline = Date\.now\(\) \+ totalBudgetMs/.test(SRC));
  check("a timeout is NOT retried", /provider_timeout/.test(SRC) && /throw new ProviderBusyError\(\s*"provider_timeout"/.test(SRC));
  check("only 429 and 5xx are treated as retryable", /response\.status === 429 \|\| response\.status >= 500/.test(SRC));
  /**
   * Set from our own successful renders, not a round number: Kelly took 105s
   * and Elva 94s, so anything under ~120s kills real successes.
   */
  check("the render timeout clears the slowest measured success (Kelly, 105s)",
    /DEFAULT_REQUEST_TIMEOUT_MS = 120_000/.test(SRC));
  check("the total budget is 135-140s and still well under the 300s route budget",
    /DEFAULT_TOTAL_BUDGET_MS = 140_000/.test(SRC));
  check("at most one retry is allowed", /DEFAULT_MAX_ATTEMPTS = 2/.test(SRC));
  check("exhaustion returns the structured provider_busy reason",
    /new ProviderBusyError\(\s*"provider_busy"/.test(SRC) || /"provider_busy"/.test(SRC));
  check("capacity failures raise a retryable error type", /class ProviderBusyError/.test(SRC) && /readonly retryable = true/.test(SRC));
  check("the timeouts are env-tunable without a deploy",
    /FEW_SHOT_REQUEST_TIMEOUT_MS/.test(SRC) && /FEW_SHOT_TOTAL_BUDGET_MS/.test(SRC));
  check("the room's own aspect ratio is sent", /imageConfig: \{ aspectRatio \}/.test(SRC));
  check("EXIF orientation is applied before measuring the room", /\.rotate\(\)/.test(SRC));
}

console.log("\nRoute wiring");
{
  const ROUTE = readFileSync("src/app/api/studio/generate-gemini/route.ts", "utf8");
  check("the few-shot branch runs BEFORE the scene graph",
    ROUTE.indexOf('getRoomEditStrategy() === "few-shot"') < ROUTE.indexOf("await analyzeSceneGraph"));
  check("an ineligible request falls through to the grounding path",
    /few-shot strategy declined, using grounding path/.test(ROUTE));
  check("a crash in the new path falls back rather than failing the request",
    /few-shot path failed, falling back to grounding/.test(ROUTE));
  check("a busy provider returns a retryable 503, not a fallback render",
    /retryable: true, reason: error\.reason/.test(ROUTE) && /\{ status: 503 \}/.test(ROUTE));
  check("the few-shot path returns the same response shape",
    /images: \[\s*\{\s*provider: result\.provider/.test(ROUTE) && /imageBase64: result\.imageBase64/.test(ROUTE));
  check("timings are logged unconditionally, not behind the debug flag",
    /console\.log\("\[studio-gemini\] few-shot generation"/.test(ROUTE));
  check("the grounding path is still present and untouched",
    /buildIntelligentRoomPrompt\(\{/.test(ROUTE) && /reviewGeneratedRoom\(\{/.test(ROUTE));
  check("the few-shot path runs no quality reviewer",
    ROUTE.indexOf("return NextResponse.json(fewShotBody)") < ROUTE.indexOf("const outcome = await reviewGeneratedRoom"));
}

console.log("\nRegression — the real Kelly + Elva + Aspen object-selection flow");
{
  /**
   * The bug this covers: the few-shot branch only accepted a CLIENT-built
   * contract, which only exists after object detection. The mainline flow
   * (pick a category, pick a product, Generate) never runs detection, so every
   * such request declined with "no explicit replacement contract", fell through
   * to the grounding path, and surfaced the scene-readiness error instead.
   *
   * Built with the production contract builder rather than a hand-written stub,
   * so a change to the contract's real shape breaks this test rather than
   * sailing past it.
   */
  const sourceImage = { width: 4032, height: 3024 };
  const selection = (
    id: string,
    sceneItemId: string,
    canonicalCategory: "sofa" | "coffee-table",
    instanceLabel: string,
    displayName: string
  ): RoomSelection => ({
    selectionId: id,
    sceneItemId,
    canonicalCategory,
    instanceLabel,
    displayName,
    selectionMethod: "smart",
    boundingBox: { x: 0.05, y: 0.5, width: 0.4, height: 0.35 },
    sourceImage,
  });

  const selections: RoomSelection[] = [
    selection("sel-1", "sofa_left", "sofa", "the left sofa", "Sofa 1"),
    selection("sel-2", "sofa_right", "sofa", "the right sofa", "Sofa 2"),
    selection("sel-3", "table_centre", "coffee-table", "the coffee table", "Coffee table"),
  ];
  const assignments: AssignmentInput[] = [
    { selectionId: "sel-1", productId: KELLY, scope: "this-only" },
    { selectionId: "sel-2", productId: ELVA, scope: "this-only" },
    { selectionId: "sel-3", productId: ASPEN, scope: "this-only" },
  ];

  const contract = buildReplacementContract({
    selections,
    assignments,
    profiles: getProductProfiles(getProductsByIdsInSelectionOrder(POC_IDS)),
    allDetected: selections.map((entry) => ({
      sceneItemId: entry.sceneItemId!,
      canonicalCategory: entry.canonicalCategory,
      displayName: entry.displayName,
    })),
    sourceImage,
  });

  check("the object-selection flow produces one assignment per product",
    contract.assignments.length === 3, `got ${contract.assignments.length}`);
  check("the contract covers exactly Kelly, Elva and Aspen",
    POC_IDS.every((id) => contractProductIds(contract).includes(id)),
    contractProductIds(contract).join(", "));
  check("a real object-selection contract is few-shot eligible",
    checkFewShotEligibility({
      contract,
      surpriseMe: false,
      productIds: contractProductIds(contract),
    }).eligible);

  /**
   * The builder leaves `additions`/`removals` undefined and the server parser
   * drops them outright, so the eligibility guard must not reject on them.
   */
  check("a plain swap carries no additions or removals to trip eligibility",
    !contract.additions?.length && !contract.removals?.length);

  // Every replacement the prompt will describe must resolve to a real target.
  const replacements: FewShotReplacement[] = contract.assignments.map((assignment) => ({
    targetDescription:
      assignment.target.originalObjectDescription?.trim() ||
      assignment.target.instanceLabel?.trim() ||
      assignment.target.displayName,
    location: assignment.target.location || null,
    productTitle: assignment.productTitle,
    category: assignment.canonicalCategory,
    sku: getFewShotSku(assignment.productId)!,
  }));
  const prompt = buildFewShotPrompt({
    replacements,
    references: POC_IDS.flatMap((id) => [
      { productTitle: id, view: "front" },
      { productTitle: id, view: "side" },
    ]),
    preserved: [...BASELINE_PRESERVED],
  });
  check("the prompt built from a real contract describes all three targets",
    replacements.every((entry) => prompt.includes(entry.targetDescription)));
  check("a real contract never yields a picker label as the target",
    !/Replace the Sofa \d/.test(prompt), prompt);
  check("the prompt built from a real contract stays short",
    Buffer.byteLength(prompt, "utf8") < 3072);

  // The server-resolved contract (mainline flow) is the same type, so the
  // second attempt accepts it on exactly the same terms.
  check("a server-resolved contract is eligible on the same terms",
    checkFewShotEligibility({
      contract: contract as ReplacementContract,
      surpriseMe: false,
      productIds: POC_IDS,
    }).eligible);
}

console.log("\nRegression — both contract origins reach the few-shot branch");
{
  const ROUTE = readFileSync("src/app/api/studio/generate-gemini/route.ts", "utf8");

  /**
   * Anchor on the CALL SITES, not on the origin strings — those also appear in
   * the helper's own type signature, which sits above both calls and would make
   * these assertions pass for the wrong reason.
   */
  const earlyAt = ROUTE.indexOf("const earlyFewShot = await attemptFewShot(");
  const analysisAt = ROUTE.indexOf("await analyzeSceneGraph");
  const resolvedContractAt = ROUTE.indexOf("const effectiveContract =");
  const readinessAt = ROUTE.indexOf("assessSceneReadiness({");
  const lateAt = ROUTE.indexOf("const resolvedFewShot = await attemptFewShot(");
  const planAt = ROUTE.indexOf("const replacementPlan =");

  check("both few-shot call sites were found in the route",
    earlyAt > -1 && lateAt > -1 && analysisAt > -1 && readinessAt > -1 && planAt > -1,
    `early=${earlyAt} late=${lateAt} analysis=${analysisAt}`);

  check("there are two few-shot attempts, not one",
    earlyAt > -1 && lateAt > -1 && earlyAt !== lateAt);
  check("the client-contract attempt runs BEFORE any scene analysis",
    earlyAt > -1 && earlyAt < analysisAt);
  check("an eligible client contract returns before scene analysis is reached",
    ROUTE.indexOf("if (earlyFewShot) return earlyFewShot;") < analysisAt);
  check("the resolved-contract attempt runs after the contract is resolved",
    lateAt > resolvedContractAt);
  check("the resolved-contract attempt runs after the readiness gate",
    lateAt > readinessAt,
    "an unreadable room must not be handed a guessed contract");
  check("both attempts run before the grounding plan is built",
    lateAt < planAt);
  check("the mainline flow no longer dead-ends at the grounding path",
    /contractProductIds\(effectiveContract\)/.test(ROUTE));
  check("the contract origin is logged so the two paths are distinguishable",
    /origin,\s*\n\s*model: result\.debug\.model/.test(ROUTE));
  check("the first attempt does not warn when a contract simply is not there yet",
    /if \(origin === "resolved-contract" \|\| contract\)/.test(ROUTE));
}

console.log("\nProvider routing — few-shot is a STRATEGY, not a provider id");
{
  /**
   * The bug: the few-shot renderer reported `provider: "gemini-few-shot"`,
   * which is not in the studio client's allowlist, so
   * `assertStudioGeminiProvider` threw "Unknown studio image provider" — on the
   * CLIENT, after the server had already rendered and paid for the image.
   */
  check("the few-shot renderer reports the renderer id, not the strategy",
    FEW_SHOT_RENDERER_ID === "gemini", FEW_SHOT_RENDERER_ID);

  let threw: string | null = null;
  try {
    assertStudioGeminiProvider(FEW_SHOT_RENDERER_ID);
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  check("the studio client accepts what the few-shot renderer returns",
    threw === null, threw ?? "");

  check("the strategy name is never used as a provider id",
    !/provider: "(few-shot|gemini-few-shot)"/.test(
      readFileSync("src/features/room-stylist/services/image-providers/gemini-few-shot.ts", "utf8")
    ));

  /**
   * Asserted from source rather than imported: room-edit-provider pulls in the
   * OpenAI client, which throws at module load without OPENAI_API_KEY. Same
   * convention as test-gemini-primary.ts.
   */
  const PROVIDER_SRC = readFileSync(
    "src/features/room-stylist/services/image-providers/room-edit-provider.ts",
    "utf8"
  );
  check("ROOM_EDIT_PROVIDER=gemini resolves to the Gemini renderer",
    /if \(raw === "gemini"\) return "gemini";/.test(PROVIDER_SRC));
  check("the renderer ids the resolver can return are all accepted by the client",
    (() => {
      const ids = ["gemini", "gpt-image"];
      return ids.every((id) => {
        try {
          assertStudioGeminiProvider(id);
          return true;
        } catch {
          return false;
        }
      });
    })());
  check("the strategy flag and the provider flag are separate settings",
    /ROOM_EDIT_PROVIDER/.test(PROVIDER_SRC) &&
      !/ROOM_EDIT_STRATEGY/.test(PROVIDER_SRC));
}

console.log("\nEnd to end — benchmark-shaped request, Kelly only and all three");
{
  /**
   * Drives the real renderer with the transport stubbed. Nothing leaves the
   * machine and no generation is paid for, but every step between the contract
   * and the request body is the production code path — which is exactly where
   * the request SHAPE is decided.
   */
  const bigRoom = await sharp({
    create: { width: 4032, height: 3024, channels: 3, background: "#b0a89c" },
  })
    .jpeg()
    .toBuffer();
  const roomImage = new File([new Uint8Array(bigRoom)], "room.jpg", { type: "image/jpeg" });

  const capture = async (productIds: string[]) => {
    const { loaded } = await loadFewShotReferences(productIds.map((id) => ({ id, name: id })));
    const realFetch = globalThis.fetch;
    let sent: { contents: Array<{ parts: Array<Record<string, unknown>> }>; generationConfig: Record<string, unknown> } | null = null;
    let url = "";
    globalThis.fetch = (async (requestUrl: string, init: RequestInit) => {
      url = String(requestUrl);
      sent = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { data: "AA==", mimeType: "image/jpeg" } }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;
    try {
      const result = await generateFewShotRoomEdit({
        prompt: "PROMPT",
        roomImage,
        references: loaded.map((reference) => reference.file),
        apiKey: "stub-not-used",
        timings: createTimings(),
      });
      return { sent: sent!, url, result, loaded };
    } finally {
      globalThis.fetch = realFetch;
    }
  };

  const kelly = await capture([KELLY]);
  const parts = kelly.sent.contents[0].parts;
  const textParts = parts.filter((part) => "text" in part);
  const imageParts = parts.filter((part) => "inline_data" in part);

  check("no paid call was made — the transport was stubbed",
    kelly.url.includes("generativelanguage.googleapis.com"));
  check("Kelly-only sends EXACTLY 1 text part", textParts.length === 1, `got ${textParts.length}`);
  check("the single text part comes first", "text" in parts[0]);
  check("Kelly-only then sends EXACTLY 3 image parts", imageParts.length === 3, `got ${imageParts.length}`);
  check("nothing is interleaved between the images",
    parts.length === 4 && parts.slice(1).every((part) => "inline_data" in part),
    parts.map((part) => ("text" in part ? "TEXT" : "IMAGE")).join(","));

  const mimes = imageParts.map(
    (part) => (part.inline_data as { mime_type: string }).mime_type
  );
  check("the room is first, normalised to JPEG", mimes[0] === "image/jpeg");
  check("reference order is main.jpg then 03-side.webp",
    kelly.loaded.map((reference) => reference.url.split("/").pop()).join(",") ===
      "main.jpg,03-side.webp");
  check("MIME sniffing is intact — the WebP-in-.jpg is declared image/webp",
    mimes[1] === "image/webp" && mimes[2] === "image/webp",
    mimes.join(","));

  check(`the room is normalised to ${ROOM_MAX_WIDTH}x${ROOM_MAX_HEIGHT}`,
    kelly.result.roomWidth === 2048 && kelly.result.roomHeight === 1536,
    `${kelly.result.roomWidth}x${kelly.result.roomHeight}`);
  check("normalisation shrank a 4032x3024 phone photo",
    kelly.result.roomBytes < bigRoom.length, `${kelly.result.roomBytes} vs ${bigRoom.length}`);
  check("the room's aspect is measured from the normalised pixels",
    kelly.result.aspectRatio === "4:3", kelly.result.aspectRatio);
  check("4:3 is still sent in generationConfig",
    (kelly.sent.generationConfig.imageConfig as { aspectRatio: string }).aspectRatio === "4:3");
  check("the response provider passes the studio client guard",
    (() => {
      try {
        assertStudioGeminiProvider(kelly.result.provider);
        return true;
      } catch {
        return false;
      }
    })());

  // The shape must hold as products are added, not only at one SKU.
  const all = await capture(POC_IDS);
  const allParts = all.sent.contents[0].parts;
  check("three SKUs still send exactly 1 text part",
    allParts.filter((part) => "text" in part).length === 1);
  check("three SKUs send 7 images with no interleaved text",
    allParts.length === 8 && allParts.slice(1).every((part) => "inline_data" in part),
    `${allParts.length} parts`);
}

console.log("\nExact replacement targets — one sofa selected, two sofas in the room");
{
  /**
   * The reported failure: one sofa was selected and Gemini replaced both. The
   * contract already protects the second sofa; the prompt did not say so
   * loudly enough, and "replace the left sofa with a green one" invites the
   * model to harmonise the pair.
   */
  const sofaRoom = buildFewShotPrompt({
    replacements: [
      { targetDescription: "dark charcoal fabric sofa", location: "on the left", productTitle: "Elva", category: "sofa", sku: getFewShotSku(ELVA)! },
    ],
    references: [
      { productTitle: "Elva", view: "front" },
      { productTitle: "Elva", view: "side" },
    ],
    preserved: [...BASELINE_PRESERVED, "the other sofa"],
    sameCategoryProtected: [{ label: "the other sofa", category: "sofa" }],
  });

  check("the surviving sofa is named explicitly", sofaRoom.includes("the other sofa"));
  check("the room's sofa count is stated", /This room contains 2 sofas\./.test(sofaRoom), sofaRoom);
  check("exactly how many change is stated", /Exactly 1 of them is replaced/.test(sofaRoom));
  check("the survivor must not be replaced", /do not replace it/.test(sofaRoom));
  check("the survivor must not be removed", /do not remove it/.test(sofaRoom));
  check("the survivor must not be recoloured to match", /do not recolour it to match the new furniture/.test(sofaRoom));
  check("the survivor sentence reads as prose, not a fragment",
    /The other sofa must stay in the photograph exactly as it is/.test(sofaRoom), sofaRoom);
  check("no automatic replace-all instruction is introduced",
    !/replace (all|both|every)/i.test(sofaRoom), sofaRoom);

  // Two selected sofas must NOT produce a survivor clause.
  const bothSelected = buildFewShotPrompt({
    replacements: [
      { targetDescription: "dark charcoal fabric sofa", location: "on the left", productTitle: "Kelly", category: "sofa", sku: getFewShotSku(KELLY)! },
      { targetDescription: "navy leather sofa", location: "on the right", productTitle: "Elva", category: "sofa", sku: getFewShotSku(ELVA)! },
    ],
    references: [{ productTitle: "Kelly", view: "front" }],
    preserved: [...BASELINE_PRESERVED],
    sameCategoryProtected: [],
  });
  check("two selected sofas produce two replacement instructions",
    /1\. Replace the dark charcoal fabric sofa/.test(bothSelected) &&
      /2\. Replace the navy leather sofa/.test(bothSelected));
  check("with nothing surviving, no survivor clause is emitted",
    !/This room contains/.test(bothSelected));

  // A protected coffee table is not a same-category survivor for a sofa swap.
  const mixed = buildFewShotPrompt({
    replacements: [
      { targetDescription: "dark charcoal fabric sofa", location: "on the left", productTitle: "Elva", category: "sofa", sku: getFewShotSku(ELVA)! },
    ],
    references: [{ productTitle: "Elva", view: "front" }],
    preserved: [...BASELINE_PRESERVED],
    sameCategoryProtected: [
      { label: "the other sofa", category: "sofa" },
      { label: "the coffee table", category: "coffee-table" },
    ],
  });
  check("the replaced category gets a counted sentence",
    /This room contains 2 sofas\. Exactly 1 of them is replaced/.test(mixed), mixed);
  check("a category with NOTHING replaced gets no misleading count",
    !/contains 1 coffee-table/.test(mixed), mixed);
  check("a category with nothing replaced still protects its survivor",
    /The coffee table must stay in the photograph exactly as it is/.test(mixed), mixed);
  check("survivor sentences start with a capital letter",
    !/\. the other sofa must stay/.test(mixed), mixed);
  check("categories are pluralised correctly",
    /2 sofas/.test(mixed) && !/2 sofass/.test(mixed));
}

console.log("\nCustomer note — optional, and never overrides product identity");
{
  check("an empty note contributes nothing", normaliseCustomerNote("   ") === null);
  check("a missing note contributes nothing", normaliseCustomerNote(undefined) === null);
  check("a note is trimmed", normaliseCustomerNote("  put it on the right  ") === "put it on the right");
  check("control characters are stripped",
    !/[\u0000-\u0008]/.test(normaliseCustomerNote("keep\u0000 the rug") ?? ""));
  check("newlines survive — customers write lists",
    (normaliseCustomerNote("keep the rug\nclear the table") ?? "").includes("\n"));
  check("an over-long note is capped",
    (normaliseCustomerNote("x".repeat(2000)) ?? "").length <= MAX_CUSTOMER_NOTE_LENGTH + 1);
  check("an empty note renders no section", customerNoteSection(null, ["Elva"]) === "");

  const withNote = buildFewShotPrompt({
    replacements: [
      { targetDescription: "dark charcoal fabric sofa", location: "on the left", productTitle: "Elva Green Pastel Nubuck Leather 3 Seater Sofa", category: "sofa", sku: getFewShotSku(ELVA)! },
    ],
    references: [{ productTitle: "Elva", view: "front" }],
    preserved: [...BASELINE_PRESERVED],
    customerNote: "Make the sofa more luxurious",
  });

  check("the note appears in the prompt", withNote.includes("Make the sofa more luxurious"));
  check("the note is the LAST section",
    withNote.trimEnd().endsWith("the instructions above win."), withNote.slice(-80));
  check("the note is introduced as the customer's, not as an instruction",
    /The customer added a note about this room:/.test(withNote));
  check("the note explicitly cannot change which products are used",
    /It does NOT change which products are used or how they look/.test(withNote));
  check("the note re-asserts the selected product by name",
    /Elva Green Pastel Nubuck Leather 3 Seater Sofa — must still appear exactly as their reference images show them/.test(withNote));
  check("conflicts resolve in favour of the mandatory instructions",
    /the instructions above win/.test(withNote));
  check("the replacement instruction still precedes the note",
    withNote.indexOf("Replace the dark charcoal fabric sofa") < withNote.indexOf("The customer added a note"));

  const noNote = buildFewShotPrompt({
    replacements: [
      { targetDescription: "dark charcoal fabric sofa", location: "on the left", productTitle: "Elva", category: "sofa", sku: getFewShotSku(ELVA)! },
    ],
    references: [{ productTitle: "Elva", view: "front" }],
    preserved: [...BASELINE_PRESERVED],
  });
  check("no note means no note section at all", !/customer added a note/.test(noNote));
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failures.length}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All few-shot path tests passed.");
}

main();
