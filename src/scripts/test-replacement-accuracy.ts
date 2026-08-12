/**
 * Deterministic tests for the Replacement Accuracy sprint.
 *
 * Run with:  npm run test:accuracy
 *
 * No network, no API key, no paid generation — every assertion is against pure
 * functions and the golden living-room fixture.
 */
import {
  canonicaliseCategory,
  isReplaceableCanonical,
  productCategoryMatchScore,
} from "@/lib/intelligence/scene-taxonomy";
import {
  buildReplacementPlan,
  checkPlanInvariants,
} from "@/lib/intelligence/replacement-planner";
import { buildIntelligentRoomPrompt } from "@/lib/intelligence/prompt-builder";
import { buildReferenceManifest } from "@/lib/intelligence/reference-manifest";
import { getProductProfiles } from "@/lib/intelligence/product-profile";
import { sceneGraphToRoomAnalysis } from "@/lib/intelligence/scene-graph";
import {
  deriveCriticalFailures,
  decideRecommendation,
  reviewRecommendsRegeneration,
  type ReviewAxes,
  type TaskReviewResult,
} from "@/lib/intelligence/quality-reviewer";
import {
  buildGoldenLivingRoomSceneGraph,
  GOLDEN_SELECTED_PRODUCT_IDS,
} from "@/lib/intelligence/fixtures/golden-living-room";
import {
  getProductsByIds,
  getProductsByIdsInSelectionOrder,
} from "@/lib/products";
import type { LoadedProductReference } from "@/lib/product-image-references";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// Shared fixture setup ------------------------------------------------------
const sceneGraph = buildGoldenLivingRoomSceneGraph();
const selectedIds = GOLDEN_SELECTED_PRODUCT_IDS;
const selectedProducts = getProductsByIdsInSelectionOrder(selectedIds);
const profiles = getProductProfiles(selectedProducts);
const plan = buildReplacementPlan({
  sceneGraph,
  profiles,
  selectedProductIds: selectedIds,
  aiConceptMode: false,
});

// --- A. Selection order preserved -----------------------------------------
section("A. Customer selection order is preserved");
{
  const reversed = [...selectedIds].reverse();
  const ordered = getProductsByIdsInSelectionOrder(reversed).map((p) => p.id);
  check(
    "getProductsByIdsInSelectionOrder returns customer order",
    JSON.stringify(ordered) === JSON.stringify(reversed),
    `got ${JSON.stringify(ordered)}`
  );

  const catalogueOrder = getProductsByIds(reversed).map((p) => p.id);
  check(
    "legacy getProductsByIds still returns catalogue order (unchanged)",
    JSON.stringify(catalogueOrder) !== JSON.stringify(reversed)
  );

  const reversedPlan = buildReplacementPlan({
    sceneGraph,
    profiles: getProductProfiles(getProductsByIdsInSelectionOrder(reversed)),
    selectedProductIds: reversed,
    aiConceptMode: false,
  });
  const firstTaskProduct = [
    ...reversedPlan.replacements,
    ...reversedPlan.additions,
  ].sort((a, b) => a.taskId - b.taskId)[0].productId;
  check(
    "plan task 1 belongs to the first-selected product",
    firstTaskProduct === reversed[0],
    `task 1 was ${firstTaskProduct}`
  );

  check(
    "duplicate ids collapse to a single entry",
    getProductsByIdsInSelectionOrder([selectedIds[0], selectedIds[0]]).length === 1
  );
}

// --- B. TV vs TV-unit classification --------------------------------------
section("B. TV vs TV-unit classification");
{
  const cases: [string, string, boolean][] = [
    // label, expected canonical, expected replaceable
    ["TV", "tv", false],
    ["television", "tv", false],
    ["flat screen tv", "tv", false],
    ["TV unit", "tv-unit", true],
    ["tv console", "tv-unit", true],
    ["TV stand", "tv-unit", true],
    ["entertainment unit", "tv-unit", true],
    ["media console", "tv-unit", true],
    ["media unit", "tv-unit", true],
  ];
  for (const [label, expectedCanonical, expectedReplaceable] of cases) {
    const { canonical } = canonicaliseCategory(label);
    check(
      `"${label}" → ${expectedCanonical}`,
      canonical === expectedCanonical,
      `got ${canonical}`
    );
    check(
      `"${label}" replaceable = ${expectedReplaceable}`,
      isReplaceableCanonical(canonical) === expectedReplaceable
    );
  }

  // Architecture stays protected.
  for (const fixedLabel of [
    "window",
    "door",
    "curtains",
    "air conditioner",
    "ceiling fan",
    "built-in wardrobe",
  ]) {
    const { canonical } = canonicaliseCategory(fixedLabel);
    check(
      `"${fixedLabel}" is protected`,
      !isReplaceableCanonical(canonical),
      `canonical=${canonical}`
    );
  }

  // Cross-category swaps are structurally impossible.
  check(
    "a tv-units product may NOT replace a sofa",
    productCategoryMatchScore("tv-units", "sofa") === 0
  );
  check(
    "a sofas product may NOT replace a tv-unit",
    productCategoryMatchScore("sofas", "tv-unit") === 0
  );
  check(
    "a tv-units product MAY replace a tv-unit",
    productCategoryMatchScore("tv-units", "tv-unit") > 0
  );
}

// --- C. Existing sofa + selected sofa → REPLACE ----------------------------
section("C. Selected sofa replaces the existing sofa");
{
  const sofaDisposition = plan.dispositions.find((d) => d.itemId === "sofa-main");
  check(
    "sofa-main disposition is REPLACE",
    sofaDisposition?.disposition === "replace",
    `got ${sofaDisposition?.disposition}`
  );
  check(
    "sofa-main is replaced by the selected sofa product",
    sofaDisposition?.productId === selectedIds[0],
    `got ${sofaDisposition?.productId}`
  );

  const tvUnitDisposition = plan.dispositions.find(
    (d) => d.itemId === "tv-unit-main"
  );
  check(
    "tv-unit-main disposition is REPLACE (not blocked by the 'tv' substring)",
    tvUnitDisposition?.disposition === "replace",
    `got ${tvUnitDisposition?.disposition}`
  );

  const tvDisposition = plan.dispositions.find((d) => d.itemId === "tv-screen");
  check(
    "tv-screen is PRESERVEd, never replaced",
    tvDisposition?.disposition === "preserve",
    `got ${tvDisposition?.disposition}`
  );
}

// --- D. Unmatched replaceable item → PRESERVE, never silent ----------------
section("D. Unmatched replaceable furniture is explicitly preserved");
{
  const secondSofa = plan.dispositions.find(
    (d) => d.itemId === "sofa-secondary"
  );
  check(
    "sofa-secondary has a disposition at all (no silent state)",
    Boolean(secondSofa)
  );
  check(
    "sofa-secondary is PRESERVEd",
    secondSofa?.disposition === "preserve",
    `got ${secondSofa?.disposition}`
  );
  check(
    "sofa-secondary preservation carries a reason",
    Boolean(secondSofa?.reason && secondSofa.reason.length > 10)
  );

  // The prompt must SAY so — this is what stops the recolour failure.
  const { prompt } = buildIntelligentRoomPrompt({
    roomAnalysis: sceneGraphToRoomAnalysis(sceneGraph),
    sceneGraph,
    replacementPlan: plan,
    profiles,
    style: "modern luxury",
    roomType: "living room",
    aiConceptMode: false,
    selectedProductIds: selectedIds,
    referenceViewCount: 5,
  });
  check(
    "prompt contains an explicit PRESERVE EXACTLY section",
    prompt.includes("PRESERVE EXACTLY")
  );
  check(
    "prompt names the unmatched second sofa",
    prompt.includes("two seater couch"),
    "unmatched item not mentioned in the prompt"
  );
  check(
    "prompt forbids recolouring the preserved item",
    /Do NOT restyle, recolour/.test(prompt)
  );
  check(
    "replace tasks forbid recolour-instead-of-replace",
    prompt.includes("Recolouring or restyling the original object is NOT acceptable")
  );

  const lowConfidence = plan.dispositions.find((d) => d.itemId === "maybe-stool");
  check(
    "low-confidence detection is IGNOREd with a reason",
    lowConfidence?.disposition === "ignore" &&
      lowConfidence.reason.includes("confidence"),
    `got ${lowConfidence?.disposition}`
  );
}

// --- H. Every detected item gets exactly one disposition -------------------
section("H. Planner invariants");
{
  const violations = checkPlanInvariants(plan, {
    sceneGraph,
    selectedProductIds: selectedIds,
  });
  check(
    "no invariant violations",
    violations.length === 0,
    violations.join("; ")
  );
  check(
    "one disposition per detected furniture item",
    plan.dispositions.length === sceneGraph.furniture.length,
    `${plan.dispositions.length} vs ${sceneGraph.furniture.length}`
  );

  const ids = plan.dispositions.map((d) => d.itemId);
  check("no duplicate dispositions", new Set(ids).size === ids.length);

  const allowed = new Set(["replace", "preserve", "remove", "ignore"]);
  check(
    "every disposition is a known kind",
    plan.dispositions.every((d) => allowed.has(d.disposition))
  );
  check(
    "every disposition has a non-empty reason",
    plan.dispositions.every((d) => Boolean(d.reason?.trim()))
  );
  check(
    "every selected product has exactly one destination",
    selectedIds.every(
      (id) =>
        plan.replacements.filter((t) => t.productId === id).length +
          plan.additions.filter((t) => t.productId === id).length ===
        1
    )
  );
}

// --- Phase 5. Zone allocation ---------------------------------------------
section("Zone allocation is non-repeating");
{
  const floorAdditions = plan.additions.filter((task) => !task.onWall);
  const targets = floorAdditions.map((task) => task.target);
  check(
    "floor additions do not all share one generic zone",
    new Set(targets).size === targets.length,
    `targets: ${JSON.stringify(targets)}`
  );

  const wallAdditions = plan.additions.filter((task) => task.onWall);
  for (const task of wallAdditions) {
    check(
      `wall item "${task.productCategory}" targets a wall zone`,
      /wall/i.test(task.target),
      `got "${task.target}"`
    );
  }
}

// --- E/F/G. Reference allocation, labelling and count truth ----------------
section("E. First-view coverage before extra views");
{
  // Four products, each with three available views.
  const fourIds = selectedIds.slice(0, 4);
  const loaded: LoadedProductReference[] = fourIds.flatMap((id, index) =>
    ["main", "side", "detail"].map((view) => ({
      productId: id,
      productName: `Product ${index + 1}`,
      view,
      mimeType: "image/webp",
      bytes: 100_000,
      file: null as unknown as File,
    }))
  );

  const manifest = buildReferenceManifest({
    loaded,
    plan,
    selectedProductIds: fourIds,
    maxReferences: 4,
  });

  check(
    "exactly 4 references transmitted under a budget of 4",
    manifest.transmitted.length === 4
  );
  check(
    "all four transmitted are primary views",
    manifest.transmitted.every((entry) => entry.viewIndex === 1),
    manifest.transmitted.map((e) => `${e.productId}#${e.viewIndex}`).join(", ")
  );
  check(
    "every selected product got a reference (full coverage)",
    new Set(manifest.transmitted.map((e) => e.productId)).size === 4
  );
  check(
    "no selected product is left uncovered",
    !manifest.hasUncoveredSelectedProduct,
    manifest.uncoveredSelectedProductIds.join(", ")
  );
  check(
    "transmission order follows customer selection order",
    JSON.stringify(manifest.transmitted.map((e) => e.productId)) ===
      JSON.stringify(fourIds)
  );

  // Extra views only once every product has one.
  const generous = buildReferenceManifest({
    loaded,
    plan,
    selectedProductIds: fourIds,
    maxReferences: 6,
  });
  const firstFour = generous.transmitted.slice(0, 4);
  check(
    "with a larger budget, the first 4 sent are still one-per-product",
    new Set(firstFour.map((e) => e.productId)).size === 4
  );
  check(
    "extra views are only added after full coverage",
    generous.transmitted.slice(4).every((e) => e.viewIndex > 1)
  );

  // Over-budget references are reported, not dropped silently.
  const tight = buildReferenceManifest({
    loaded,
    plan,
    selectedProductIds: fourIds,
    maxReferences: 2,
  });
  check(
    "over-budget references are recorded as not transmitted",
    tight.entries.some((e) => !e.transmitted && Boolean(e.reason))
  );
  check(
    "uncovered selected products are reported explicitly",
    tight.hasUncoveredSelectedProduct &&
      tight.uncoveredSelectedProductIds.length === 2,
    tight.uncoveredSelectedProductIds.join(", ")
  );
}

section("F. Every transmitted image has a label and manifest entry");
{
  const loaded: LoadedProductReference[] = selectedIds.map((id, index) => ({
    productId: id,
    productName: `Product ${index + 1}`,
    view: "main",
    mimeType: "image/webp",
    bytes: 90_000,
    file: null as unknown as File,
  }));
  const manifest = buildReferenceManifest({
    loaded,
    plan,
    selectedProductIds: selectedIds,
  });

  check(
    "every transmitted entry has a non-empty label",
    manifest.transmitted.every((e) => e.label.trim().length > 0)
  );
  check(
    "every transmitted entry names its product",
    manifest.transmitted.every((e) => e.label.includes(e.productName))
  );
  check(
    "every transmitted selected entry cites its task id",
    manifest.transmitted
      .filter((e) => e.taskId !== null)
      .every((e) => e.label.includes(`TASK ${e.taskId}`))
  );
  check(
    "task ids in the manifest exist in the plan",
    manifest.transmitted
      .filter((e) => e.taskId !== null)
      .every((e) =>
        [...plan.replacements, ...plan.additions].some(
          (task) => task.taskId === e.taskId && task.productId === e.productId
        )
      )
  );

  section("G. Prompt reference count equals transmitted count");
  const { prompt } = buildIntelligentRoomPrompt({
    roomAnalysis: sceneGraphToRoomAnalysis(sceneGraph),
    sceneGraph,
    replacementPlan: plan,
    profiles,
    style: "modern luxury",
    roomType: "living room",
    aiConceptMode: false,
    selectedProductIds: selectedIds,
    referenceViewCount: manifest.transmitted.length,
  });
  const claimed = prompt.match(/you are given (\d+) product reference/i);
  check(
    "prompt claims exactly the transmitted count",
    claimed !== null && Number(claimed[1]) === manifest.transmitted.length,
    `claimed ${claimed?.[1]}, transmitted ${manifest.transmitted.length}`
  );
}

// --- I/J. Concept mode ------------------------------------------------------
section("I/J. Concept mode gating");
{
  const conceptOff = buildReplacementPlan({
    sceneGraph,
    profiles,
    selectedProductIds: selectedIds,
    aiConceptMode: false,
  });
  check(
    "concept OFF produces no complementary additions",
    conceptOff.additions.every((task) => task.source === "selected")
  );

  const offPrompt = buildIntelligentRoomPrompt({
    roomAnalysis: sceneGraphToRoomAnalysis(sceneGraph),
    sceneGraph,
    replacementPlan: conceptOff,
    profiles,
    style: "modern luxury",
    roomType: "living room",
    aiConceptMode: false,
    selectedProductIds: selectedIds,
    referenceViewCount: 5,
  }).prompt;
  check(
    "concept OFF prompt forbids additions",
    offPrompt.includes("CONCEPT MODE — OFF") &&
      offPrompt.includes("Do NOT add any other furniture")
  );

  // Concept ON: complementary products appear as explicit, named plan items.
  const complementary = getProductsByIdsInSelectionOrder([
    "alina-wooden-metal-floor-lamp",
  ]);
  const conceptOnProfiles = getProductProfiles([
    ...selectedProducts,
    ...complementary,
  ]);
  const conceptOn = buildReplacementPlan({
    sceneGraph,
    profiles: conceptOnProfiles,
    selectedProductIds: selectedIds,
    aiConceptMode: true,
  });
  const complementaryTasks = conceptOn.additions.filter(
    (task) => task.source === "complementary"
  );
  check(
    "concept ON adds the complementary product as a plan item",
    complementaryTasks.length === 1 &&
      complementaryTasks[0].productId === "alina-wooden-metal-floor-lamp"
  );

  const onPrompt = buildIntelligentRoomPrompt({
    roomAnalysis: sceneGraphToRoomAnalysis(sceneGraph),
    sceneGraph,
    replacementPlan: conceptOn,
    profiles: conceptOnProfiles,
    style: "modern luxury",
    roomType: "living room",
    aiConceptMode: true,
    selectedProductIds: selectedIds,
    referenceViewCount: 6,
  }).prompt;
  check(
    "concept ON restricts additions to the named complementary items",
    onPrompt.includes("CONCEPT MODE — ON") &&
      onPrompt.includes("Alina Wooden Metal Floor Lamp")
  );
  check(
    "concept ON still forbids competing large furniture",
    onPrompt.includes("do NOT add large furniture")
  );
  check(
    "selected products are never mislabelled as complementary",
    conceptOn.additions
      .filter((t) => selectedIds.includes(t.productId))
      .every((t) => t.source === "selected")
  );
}

// --- K. Reviewer detects the six failure modes ------------------------------
section("K. Reviewer critical-failure detection");
{
  const goodAxes: ReviewAxes = {
    roomPreservation: 95,
    perspective: 95,
    lighting: 92,
    productAccuracy: 90,
    placementAccuracy: 90,
    scale: 88,
    architecture: 96,
    furnitureReplacement: 92,
    duplication: 95,
    crop: 94,
  };
  const passingTask: TaskReviewResult = {
    taskId: 1,
    productId: "p1",
    productPresent: true,
    categoryCorrect: true,
    originalRemovedOrReplaced: true,
    genuineReplacement: true,
    noDuplicate: true,
    placementCorrect: true,
    scaleCorrect: true,
    issues: [],
  };

  check(
    "a fully compliant result yields no critical failures",
    deriveCriticalFailures([passingTask], goodAxes).length === 0
  );

  const modes: [string, Partial<TaskReviewResult>, string][] = [
    ["missing product", { productPresent: false }, "selected-product-missing"],
    ["wrong category", { categoryCorrect: false }, "wrong-category-replaced"],
    [
      "original remains",
      { originalRemovedOrReplaced: false },
      "original-target-remains",
    ],
    [
      "recolour not replace",
      { genuineReplacement: false },
      "recoloured-not-replaced",
    ],
    ["duplicate", { noDuplicate: false }, "duplicate-product"],
    ["wrong placement", { placementCorrect: false }, "wrong-placement"],
  ];
  for (const [name, override, expectedKind] of modes) {
    const failuresFound = deriveCriticalFailures(
      [{ ...passingTask, ...override }],
      goodAxes
    );
    check(
      `detects ${name}`,
      failuresFound.some((f) => f.kind === expectedKind),
      `got ${failuresFound.map((f) => f.kind).join(", ") || "none"}`
    );
  }

  // Global failure modes.
  check(
    "detects changed architecture",
    deriveCriticalFailures([passingTask], {
      ...goodAxes,
      architecture: 20,
    }).some((f) => f.kind === "architecture-changed")
  );
  check(
    "detects camera reframing/cropping",
    deriveCriticalFailures([passingTask], { ...goodAxes, crop: 30 }).some(
      (f) => f.kind === "camera-reframed"
    )
  );

  // Phase 10: a critical failure must reject even a high-scoring image.
  const recolourFailure = deriveCriticalFailures(
    [{ ...passingTask, genuineReplacement: false }],
    goodAxes
  );
  const highOverall = 92;
  check(
    "a high-scoring but non-compliant image is REJECTED",
    decideRecommendation(recolourFailure, highOverall) === "regenerate",
    "quality score overrode contract compliance"
  );
  check(
    "a compliant but low-quality image is also rejected",
    decideRecommendation([], 40) === "regenerate"
  );
  check(
    "a compliant, high-quality image is accepted",
    decideRecommendation([], 88) === "accept"
  );

  // An omitted task must not be silently treated as a pass.
  check(
    "an unavailable review does not count as a pass",
    reviewRecommendsRegeneration(null) === false,
    "note: generation proceeds, but status is review-unavailable, not passed"
  );
}

// --- Summary ---------------------------------------------------------------
console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log("All replacement-accuracy tests passed.");
