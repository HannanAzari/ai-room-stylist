/**
 * Deterministic tests for the Product Grounding + Architecture Lock sprint.
 *
 * Run with:  npm run test:grounding
 *
 * Covers the sprint's acceptance criteria A–D against the golden living-room
 * fixture. No network, no API key, no paid generation.
 */
import {
  buildReplacementPlan,
  checkPlanInvariants,
  shouldUseTwoStageGeneration,
  splitPlanByStage,
} from "@/lib/intelligence/replacement-planner";
import { buildIntelligentRoomPrompt } from "@/lib/intelligence/prompt-builder";
import {
  getProductProfiles,
  formatIdentity,
} from "@/lib/intelligence/product-profile";
import {
  assignInstanceLabels,
  sceneGraphToRoomAnalysis,
  type SceneFurniture,
} from "@/lib/intelligence/scene-graph";
import {
  deriveCriticalFailures,
  decideRecommendation,
  formatPlanForReview,
  type GlobalReviewChecks,
  type ReviewAxes,
  type TaskReviewResult,
} from "@/lib/intelligence/quality-reviewer";
import { isAnchorProductCategory } from "@/lib/intelligence/scene-taxonomy";
import { buildGoldenLivingRoomSceneGraph } from "@/lib/intelligence/fixtures/golden-living-room";
import { getProductsByIdsInSelectionOrder } from "@/lib/products";

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

const SOFA = "bellagio-stone-cream-woven-fabric-3-pieces-modular-sofa-with-left-terminal-and-side-platform";
const COFFEE_TABLE = "san-pierre-walnut-veneer-low-round-coffee-table-with-travertine-finish-sintered-stone-top";
const RUG = "arges-stone-green-floor-rug-large-250cm-x-350cm";
const TV_UNIT = "jamil-ash-oak-veneer-entertainment-unit";

const scene = buildGoldenLivingRoomSceneGraph();

function planFor(ids: string[], aiConceptMode = false) {
  const products = getProductsByIdsInSelectionOrder(ids);
  const profiles = getProductProfiles(products);
  return {
    profiles,
    plan: buildReplacementPlan({
      sceneGraph: scene,
      profiles,
      selectedProductIds: ids,
      aiConceptMode,
    }),
  };
}

function promptFor(ids: string[], aiConceptMode = false) {
  const { profiles, plan } = planFor(ids, aiConceptMode);
  return buildIntelligentRoomPrompt({
    roomAnalysis: sceneGraphToRoomAnalysis(scene),
    sceneGraph: scene,
    replacementPlan: plan,
    profiles,
    style: "modern luxury",
    roomType: "living room",
    aiConceptMode,
    selectedProductIds: ids,
    referenceViewCount: ids.length,
  }).prompt;
}

// --- Instance targeting -----------------------------------------------------
section("Instance targeting — same-category disambiguation");
{
  const sofas = scene.furniture.filter((f) => f.canonicalCategory === "sofa");
  check("fixture has two sofas", sofas.length === 2);
  check(
    "both sofas are flagged as sharing a category",
    sofas.every((s) => s.sharesCategoryWithOthers)
  );
  const labels = sofas.map((s) => s.instanceLabel);
  check(
    "sofas get distinct spatial labels",
    new Set(labels).size === 2,
    labels.join(" / ")
  );
  check(
    "labels are left/right ordered by position",
    labels.some((l) => l.includes("left")) && labels.some((l) => l.includes("right")),
    labels.join(" / ")
  );

  // A category with one instance keeps its plain name.
  const rug = scene.furniture.find((f) => f.canonicalCategory === "rug");
  check(
    "a lone object keeps an unqualified label",
    rug?.instanceLabel === "the rug" && !rug.sharesCategoryWithOthers,
    rug?.instanceLabel
  );

  // Regression: each object must keep its OWN noun. Naming the whole group
  // after the first member mislabelled a two-seater couch as "3 seater sofa".
  const threeSeater = scene.furniture.find((f) => f.id === "sofa-main");
  const twoSeater = scene.furniture.find((f) => f.id === "sofa-secondary");
  check(
    "the 3-seater keeps its own noun",
    threeSeater?.instanceLabel.includes("3 seater sofa") === true,
    threeSeater?.instanceLabel
  );
  check(
    "the two-seater is NOT mislabelled as a 3 seater sofa",
    twoSeater?.instanceLabel.includes("two seater couch") === true &&
      !twoSeater.instanceLabel.includes("3 seater"),
    twoSeater?.instanceLabel
  );

  // Three of a kind → left/centre/right.
  const three: SceneFurniture[] = [0.1, 0.5, 0.85].map((x, i) => ({
    ...sofas[0],
    id: `c${i}`,
    boundingBox: { x, y: 0.5, width: 0.1, height: 0.1 },
  }));
  const threeLabels = assignInstanceLabels(three).map((f) => f.instanceLabel);
  check(
    "three same-category objects get left/centre/right",
    threeLabels.some((l) => l.includes("left")) &&
      threeLabels.some((l) => l.includes("centre")) &&
      threeLabels.some((l) => l.includes("right")),
    threeLabels.join(" / ")
  );
}

section("Instance targeting — planner and prompt");
{
  const { plan } = planFor([SOFA]);
  const sofaTask = plan.replacements.find((t) => t.productId === SOFA);
  check("the sofa task targets a specific instance", Boolean(sofaTask?.existingInstanceLabel));
  check(
    "the sofa task knows the category is shared",
    sofaTask?.existingSharesCategory === true
  );

  const untouched = plan.dispositions.find(
    (d) => d.canonicalCategory === "sofa" && d.disposition === "preserve"
  );
  check("the other sofa is preserved", Boolean(untouched));
  check(
    "its reason warns about the same-category risk",
    Boolean(untouched?.reason.includes("same category")),
    untouched?.reason
  );

  const prompt = promptFor([SOFA]);
  check(
    "prompt names the specific sofa instance",
    /the (left|right) (3 seater sofa|two seater couch)/.test(prompt),
    "no spatial instance in prompt"
  );
  check(
    "prompt says ONLY that one may change",
    prompt.includes("and ONLY that one")
  );
  check(
    "prompt explicitly protects the other sofa",
    prompt.includes("must remain exactly as photographed")
  );
}

// --- Architecture lock ------------------------------------------------------
section("Architecture lock");
{
  const prompt = promptFor([SOFA]);
  check("prompt has an ARCHITECTURE LOCK section", prompt.includes("ARCHITECTURE LOCK"));
  check(
    "forbids adding doors/windows/arches",
    prompt.includes("Do NOT add any door, doorway, window, arch, opening")
  );
  check(
    "forbids removing existing architecture",
    prompt.includes("Do NOT remove, resize, reposition or reshape")
  );
  check(
    "forbids inventing a view or adjoining room",
    prompt.includes("Do NOT invent a view, corridor or adjoining room")
  );
  check(
    "states the exact counted inventory",
    prompt.includes("EXACTLY 1 window(s), 1 door(s)/doorway(s) and 0 open arch"),
    "counts not stated"
  );

  const reviewText = formatPlanForReview(planFor([SOFA]).plan, scene.architecture);
  check(
    "reviewer receives the architecture baseline",
    reviewText.includes("ARCHITECTURE BASELINE") &&
      reviewText.includes("exactly 1 window(s)")
  );
  check(
    "reviewer is told to fail on a count mismatch in either direction",
    reviewText.includes("differ in EITHER direction")
  );
}

// --- Product identity grounding --------------------------------------------
section("Product identity grounding");
{
  const [sofaProfile] = getProductProfiles(getProductsByIdsInSelectionOrder([SOFA]));
  const identity = sofaProfile.identity;

  check("identity has a category", identity.category === "sofa");
  check(
    "configuration is derived from the product name",
    identity.configuration.includes("3-piece") &&
      identity.configuration.includes("modular") &&
      identity.configuration.includes("left terminal"),
    identity.configuration
  );
  // These now come from the enrichment vision pass rather than being inferred
  // from the product NAME, so they are more specific than the old derived
  // strings: "warm off-white ..." for the cream family, "looped bouclé weave"
  // for fabric. The concept is asserted, not the old wording.
  check(
    "colour family names a warm neutral",
    /cream|off-white|pearl|beige|ivory|neutral/i.test(identity.colourFamily),
    identity.colourFamily
  );
  check(
    "material describes the upholstery",
    /fabric|weave|woven|bouclé|boucle|textile/i.test(identity.material),
    identity.material
  );
  check("base/legs is populated", identity.legsBase.length > 0, identity.legsBase);
  check("shape is populated", identity.shape.length > 0, identity.shape);
  check(
    "notable traits are populated",
    identity.notableTraits.length > 0,
    identity.notableTraits.join("; ")
  );

  const [tableProfile] = getProductProfiles(
    getProductsByIdsInSelectionOrder([COFFEE_TABLE])
  );
  check(
    "a stone-top table records that trait",
    tableProfile.identity.notableTraits.some((t) =>
      /stone|travertine|marble|sintered/i.test(t)
    ),
    tableProfile.identity.notableTraits.join("; ")
  );
  check(
    "round tables record a rounded form",
    tableProfile.identity.notableTraits.some((t) => t.includes("rounded")) ||
      tableProfile.identity.shape.includes("round"),
    tableProfile.identity.shape
  );

  const line = formatIdentity(identity);
  for (const field of ["category:", "configuration:", "material:", "colour family:", "base:"]) {
    check(`identity line includes ${field}`, line.includes(field));
  }

  const prompt = promptFor([SOFA]);
  check("prompt carries an IDENTITY line per task", prompt.includes("IDENTITY (must match the reference image"));
  // "labelled for task N" rather than "for task N": one reference image can
  // legitimately be labelled for several tasks when the same product fills
  // more than one, so the wording points at the LABEL, which names them all.
  check("identity is tied to the reference image", prompt.includes("must match the reference image labelled for task 1"));

  const reviewText = formatPlanForReview(planFor([SOFA]).plan, scene.architecture);
  check("reviewer receives the identity too", reviewText.includes("IDENTITY —"));
}

// --- Two-stage generation ---------------------------------------------------
section("Two-stage generation");
{
  check("sofa is an anchor category", isAnchorProductCategory("sofas"));
  check("tv unit is an anchor category", isAnchorProductCategory("tv-units"));
  check("coffee table is NOT an anchor", !isAnchorProductCategory("coffee-tables"));
  check("rug is NOT an anchor", !isAnchorProductCategory("rugs"));
  check("decor is NOT an anchor", !isAnchorProductCategory("decor"));

  const single = planFor([SOFA]).plan;
  check(
    "a single-product plan stays one pass",
    !shouldUseTwoStageGeneration(single)
  );

  const two = planFor([SOFA, COFFEE_TABLE]).plan;
  check(
    "a two-product plan stays one pass (below threshold)",
    !shouldUseTwoStageGeneration(two)
  );

  const four = planFor([SOFA, COFFEE_TABLE, RUG, TV_UNIT]).plan;
  check("a four-product mixed plan uses two passes", shouldUseTwoStageGeneration(four));

  const stages = splitPlanByStage(four);
  check("splits into exactly two stages", stages.length === 2, `${stages.length}`);
  check("first stage is the anchors", stages[0].stage === "anchor");
  check("second stage is the secondary items", stages[1].stage === "secondary");

  const anchorProducts = [
    ...stages[0].plan.replacements.map((t) => t.productId),
    ...stages[0].plan.additions.map((t) => t.productId),
  ];
  const secondaryProducts = [
    ...stages[1].plan.replacements.map((t) => t.productId),
    ...stages[1].plan.additions.map((t) => t.productId),
  ];
  check("sofa is in the anchor pass", anchorProducts.includes(SOFA));
  check("tv unit is in the anchor pass", anchorProducts.includes(TV_UNIT));
  check("coffee table is in the secondary pass", secondaryProducts.includes(COFFEE_TABLE));
  check("rug is in the secondary pass", secondaryProducts.includes(RUG));
  check(
    "no product appears in both passes",
    anchorProducts.every((id) => !secondaryProducts.includes(id))
  );
  check(
    "every product is covered across the two passes",
    [SOFA, COFFEE_TABLE, RUG, TV_UNIT].every(
      (id) => anchorProducts.includes(id) || secondaryProducts.includes(id)
    )
  );

  // Pass 2 must protect what pass 1 placed.
  const anchorTitles = stages[0].plan.replacements.map((t) => t.productTitle);
  check(
    "pass 2 preserves the products placed in pass 1",
    anchorTitles.every((title) => stages[1].plan.preserved.includes(title)),
    stages[1].plan.preserved.join(" | ")
  );

  const secondPassPrompt = buildIntelligentRoomPrompt({
    roomAnalysis: sceneGraphToRoomAnalysis(scene),
    sceneGraph: scene,
    replacementPlan: stages[1].plan,
    profiles: planFor([SOFA, COFFEE_TABLE, RUG, TV_UNIT]).profiles,
    style: "modern luxury",
    roomType: "living room",
    aiConceptMode: false,
    selectedProductIds: [SOFA, COFFEE_TABLE, RUG, TV_UNIT],
    referenceViewCount: 2,
    stage: "secondary",
    isSecondPass: true,
  }).prompt;
  check(
    "second-pass prompt announces it is a second pass",
    secondPassPrompt.includes("THIS IS A SECOND EDITING PASS")
  );
  check(
    "second-pass prompt protects existing furniture",
    secondPassPrompt.includes("Keep ALL furniture already present exactly as it is")
  );
  check(
    "second-pass prompt still locks architecture",
    secondPassPrompt.includes("ARCHITECTURE LOCK")
  );
  check(
    "second-pass prompt treats the supplied image as ground truth",
    secondPassPrompt.includes("result of the previous pass")
  );
}

// --- Reviewer: new critical failures ---------------------------------------
section("Reviewer — architecture and instance failures");
{
  const goodAxes: ReviewAxes = {
    roomPreservation: 95, perspective: 95, lighting: 92, productAccuracy: 90,
    placementAccuracy: 90, scale: 88, architecture: 96, furnitureReplacement: 92,
    duplication: 95, crop: 94,
  };
  const goodGlobal: GlobalReviewChecks = {
    noNewArchitecture: true,
    allOriginalArchitecturePresent: true,
    wallStructurePreserved: true,
    unselectedSameCategoryUnchanged: true,
    unrelatedFurniturePreserved: true,
    noUnrequestedAdditions: true,
    reasoning: "Everything checks out.",
  };
  const goodTask: TaskReviewResult = {
    taskId: 1, productId: SOFA, productPresent: true, categoryCorrect: true,
    originalRemovedOrReplaced: true, genuineReplacement: true, noDuplicate: true,
    placementCorrect: true, scaleCorrect: true, identityMatches: true,
    signatureTraitsPresent: true, missingSignatureTraits: [], allMaterialsPresent: true,
    reasoning: "Correct sofa, correct place.", issues: [],
  };

  check(
    "a fully compliant result has no critical failures",
    deriveCriticalFailures([goodTask], goodAxes, goodGlobal).length === 0
  );

  const cases: [string, Partial<GlobalReviewChecks>, string][] = [
    ["a hallucinated door/window", { noNewArchitecture: false }, "architecture-hallucinated"],
    ["a missing original element", { allOriginalArchitecturePresent: false }, "architecture-element-missing"],
    ["changed wall structure", { wallStructurePreserved: false }, "architecture-changed"],
    ["an unselected same-category change", { unselectedSameCategoryUnchanged: false }, "unselected-same-category-changed"],
  ];
  for (const [name, override, kind] of cases) {
    const found = deriveCriticalFailures([goodTask], goodAxes, {
      ...goodGlobal,
      ...override,
    });
    check(`detects ${name}`, found.some((f) => f.kind === kind), found.map((f) => f.kind).join(", ") || "none");
    check(
      `${name} rejects a high-scoring image`,
      decideRecommendation(found, 95) === "regenerate"
    );
  }

  check(
    "detects an identity mismatch (right category, wrong product)",
    deriveCriticalFailures([{ ...goodTask, identityMatches: false }], goodAxes, goodGlobal)
      .some((f) => f.kind === "product-identity-mismatch")
  );
  check(
    "an identity mismatch rejects a high-scoring image",
    decideRecommendation(
      deriveCriticalFailures([{ ...goodTask, identityMatches: false }], goodAxes, goodGlobal),
      93
    ) === "regenerate"
  );

  // Missing globalChecks must fail safe, not pass silently.
  const missingGlobal: GlobalReviewChecks = {
    noNewArchitecture: false, allOriginalArchitecturePresent: false,
    wallStructurePreserved: false, unselectedSameCategoryUnchanged: false,
    unrelatedFurniturePreserved: false, noUnrequestedAdditions: false, reasoning: "",
  };
  check(
    "absent whole-room checks fail safe",
    deriveCriticalFailures([goodTask], goodAxes, missingGlobal).length >= 4
  );

  check(
    "duplicate failure kinds are collapsed",
    deriveCriticalFailures([goodTask], { ...goodAxes, architecture: 10 }, {
      ...goodGlobal,
      wallStructurePreserved: false,
    }).filter((f) => f.kind === "architecture-changed").length === 1
  );
}

// --- Acceptance criteria ----------------------------------------------------
section("Acceptance A — 1-product sofa test");
{
  const ids = [SOFA];
  const { plan } = planFor(ids);
  const prompt = promptFor(ids);

  check("exactly one replacement task", plan.replacements.length === 1);
  check(
    "it replaces a sofa with the selected sofa",
    plan.replacements[0].existingCanonicalCategory === "sofa" &&
      plan.replacements[0].productId === SOFA
  );
  check("no invariant violations", checkPlanInvariants(plan, { sceneGraph: scene, selectedProductIds: ids }).length === 0);
  check("single pass (no unnecessary cost)", !shouldUseTwoStageGeneration(plan));
  check("architecture is locked", prompt.includes("ARCHITECTURE LOCK"));
  check(
    "the TV stays fixed",
    plan.dispositions.find((d) => d.itemId === "tv-screen")?.disposition === "preserve"
  );
  check(
    "unselected furniture is explicitly preserved",
    plan.dispositions.filter((d) => d.disposition === "preserve").length >= 4
  );
  check(
    "only one object is replaced in total",
    plan.dispositions.filter((d) => d.disposition === "replace").length === 1
  );
}

section("Acceptance B — 2-product test (sofa + coffee table)");
{
  const ids = [SOFA, COFFEE_TABLE];
  const { plan } = planFor(ids);
  const prompt = promptFor(ids);

  check("both products have a destination", ids.every((id) =>
    plan.replacements.some((t) => t.productId === id) ||
    plan.additions.some((t) => t.productId === id)
  ));
  check(
    "categories are correct",
    plan.replacements.every((t) => {
      if (t.productId === SOFA) return t.existingCanonicalCategory === "sofa";
      if (t.productId === COFFEE_TABLE) return t.existingCanonicalCategory === "coffee-table";
      return true;
    })
  );
  check("no invariant violations", checkPlanInvariants(plan, { sceneGraph: scene, selectedProductIds: ids }).length === 0);
  check("both products appear in the prompt", prompt.includes("Bellagio") && prompt.includes("San Pierre"));
  check("both have identity lines", (prompt.match(/IDENTITY \(must match/g) || []).length === 2);
  check("architecture is locked", prompt.includes("ARCHITECTURE LOCK") && prompt.includes("EXACTLY 1 window(s)"));
  check("the second sofa is still protected", prompt.includes("must remain exactly as photographed"));
}

section("Acceptance C — 4-product test");
{
  const ids = [SOFA, COFFEE_TABLE, RUG, TV_UNIT];
  const { plan } = planFor(ids);

  check("all four products have a destination", ids.every((id) =>
    plan.replacements.some((t) => t.productId === id) ||
    plan.additions.some((t) => t.productId === id)
  ));
  check(
    "each replaces the correct canonical category",
    plan.replacements.every((t) => {
      const expected: Record<string, string> = {
        [SOFA]: "sofa", [COFFEE_TABLE]: "coffee-table",
        [RUG]: "rug", [TV_UNIT]: "tv-unit",
      };
      return t.existingCanonicalCategory === expected[t.productId];
    }),
    plan.replacements.map((t) => `${t.productCategorySlug}->${t.existingCanonicalCategory}`).join(", ")
  );
  check("no invariant violations", checkPlanInvariants(plan, { sceneGraph: scene, selectedProductIds: ids }).length === 0);
  check("two-stage generation is used", shouldUseTwoStageGeneration(plan));

  const stages = splitPlanByStage(plan);
  const perStagePrompts = stages.map((entry, index) =>
    buildIntelligentRoomPrompt({
      roomAnalysis: sceneGraphToRoomAnalysis(scene),
      sceneGraph: scene,
      replacementPlan: entry.plan,
      profiles: planFor(ids).profiles,
      style: "modern luxury",
      roomType: "living room",
      aiConceptMode: false,
      selectedProductIds: ids,
      referenceViewCount: 2,
      stage: entry.stage,
      isSecondPass: index > 0,
    }).prompt
  );
  check("every pass locks architecture", perStagePrompts.every((p) => p.includes("ARCHITECTURE LOCK")));
  check(
    "every pass states the architecture counts",
    perStagePrompts.every((p) => p.includes("EXACTLY 1 window(s)"))
  );
  check(
    "no unrelated furniture is replaced",
    plan.dispositions.filter((d) => d.disposition === "replace").length === 4
  );
  check(
    "the second sofa is never replaced",
    plan.dispositions.find((d) => d.itemId === "sofa-secondary")?.disposition === "preserve"
  );
  check(
    "the TV is never replaced",
    plan.dispositions.find((d) => d.itemId === "tv-screen")?.disposition === "preserve"
  );
}

section("Acceptance D — debug visibility");
{
  const goodAxes: ReviewAxes = {
    roomPreservation: 95, perspective: 95, lighting: 92, productAccuracy: 90,
    placementAccuracy: 90, scale: 88, architecture: 96, furnitureReplacement: 92,
    duplication: 95, crop: 94,
  };
  const failures2 = deriveCriticalFailures(
    [{
      taskId: 1, productId: SOFA, productPresent: true, categoryCorrect: true,
      originalRemovedOrReplaced: true, genuineReplacement: false, noDuplicate: true,
      placementCorrect: true, scaleCorrect: true, identityMatches: true,
      signatureTraitsPresent: true, missingSignatureTraits: [], allMaterialsPresent: true,
      reasoning: "The original sofa was recoloured, not replaced.", issues: ["same silhouette"],
    }],
    goodAxes,
    {
      noNewArchitecture: false, allOriginalArchitecturePresent: true,
      wallStructurePreserved: true, unselectedSameCategoryUnchanged: true,
      unrelatedFurniturePreserved: true, noUnrequestedAdditions: true, reasoning: "A new doorway appeared on the left wall.",
    }
  );

  check("rejection reasons are machine-readable", failures2.length >= 2);
  check(
    "every failure names its kind and a human-readable detail",
    failures2.every((f) => f.kind.length > 0 && f.detail.length > 10)
  );
  check(
    "task-level failures carry their task id",
    failures2.filter((f) => f.taskId !== null).every((f) => typeof f.taskId === "number")
  );
  check(
    "the architecture failure is reported",
    failures2.some((f) => f.kind === "architecture-hallucinated")
  );
  check(
    "the recolour failure is reported",
    failures2.some((f) => f.kind === "recoloured-not-replaced")
  );
  check("the result is rejected", decideRecommendation(failures2, 91) === "regenerate");
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log("All grounding + architecture tests passed.");
