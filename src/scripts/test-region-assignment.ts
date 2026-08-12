/**
 * Deterministic tests for explicit region → product assignment.
 *
 * Run with:  npm run test:region-assignment
 *
 * Covers the sprint's required scenarios A–F. No network, no API key.
 */
import {
  ALWAYS_PROTECTED,
  allowedProductCategories,
  buildReplacementContract,
  canAssignProductCategory,
  contractProductIds,
  contractToReplacementPlan,
  summariseContract,
  type AssignmentInput,
} from "@/lib/intelligence/replacement-assignment";
import {
  selectionFromDetectedObject,
  createManualSelection,
  assignSelectionCategory,
  resetSelectionIds,
  toSelectableObjects,
  type RoomSelection,
} from "@/lib/intelligence/room-selection";
import { getProductProfiles } from "@/lib/intelligence/product-profile";
import { getAllProducts } from "@/lib/products";
import { buildGoldenLivingRoomSceneGraph } from "@/lib/intelligence/fixtures/golden-living-room";
import { buildIntelligentRoomPrompt } from "@/lib/intelligence/prompt-builder";
import { sceneGraphToRoomAnalysis } from "@/lib/intelligence/scene-graph";
import { formatPlanForReview } from "@/lib/intelligence/quality-reviewer";

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
function section(t: string) {
  console.log(`\n${t}`);
}

const SOFA_P = "bellagio-stone-cream-woven-fabric-3-pieces-modular-sofa-with-left-terminal-and-side-platform";
const TABLE_P = "san-pierre-walnut-veneer-low-round-coffee-table-with-travertine-finish-sintered-stone-top";
const TVUNIT_P = "jamil-ash-oak-veneer-entertainment-unit";
const RUG_P = "arges-stone-green-floor-rug-large-250cm-x-350cm";

const SOURCE = { width: 1400, height: 1050 };
const scene = buildGoldenLivingRoomSceneGraph();
const detected = toSelectableObjects(scene);
const allProducts = getAllProducts();
const allProfiles = getProductProfiles(allProducts);

const allDetected = detected.map((o) => ({
  sceneItemId: o.sceneItemId,
  canonicalCategory: o.canonicalCategory,
  displayName: o.displayName,
}));

function selectObject(index: number): RoomSelection {
  return selectionFromDetectedObject(detected[index], SOURCE);
}
function objectsOf(category: string) {
  return detected.filter((o) => o.canonicalCategory === category);
}
function contractFor(selections: RoomSelection[], assignments: AssignmentInput[]) {
  return buildReplacementContract({
    selections,
    assignments,
    profiles: allProfiles,
    allDetected,
    sourceImage: SOURCE,
  });
}

// --- F. Cross-category assignment is impossible ----------------------------
section("F. Cross-category assignment is impossible");
{
  check("a sofa region accepts sofas", canAssignProductCategory("sofa", "sofas"));
  check("a sofa region REJECTS coffee tables", !canAssignProductCategory("sofa", "coffee-tables"));
  check("a sofa region REJECTS tv units", !canAssignProductCategory("sofa", "tv-units"));
  check("a coffee-table region REJECTS sofas", !canAssignProductCategory("coffee-table", "sofas"));
  check("a tv-unit region accepts tv units", canAssignProductCategory("tv-unit", "tv-units"));
  check("a tv-unit region REJECTS sofas", !canAssignProductCategory("tv-unit", "sofas"));
  check("a rug region accepts rugs only",
    canAssignProductCategory("rug", "rugs") && !canAssignProductCategory("rug", "sofas"));
  check("a television has no assignable category at all",
    allowedProductCategories("tv").length === 0);

  // Enforced in the contract, not just the UI.
  resetSelectionIds();
  const sofaSel = selectObject(detected.findIndex((o) => o.canonicalCategory === "sofa"));
  const bad = contractFor([sofaSel], [
    { selectionId: sofaSel.selectionId, productId: TABLE_P, scope: "this-only" },
  ]);
  check("a cross-category assignment is dropped from the contract",
    bad.assignments.length === 0, `${bad.assignments.length} assignments`);
  check("the region then falls back to protected",
    bad.protectedItems.some((p) => p.sceneItemId === sofaSel.sceneItemId));
}

// --- A. Two sofas, select left, right untouched ----------------------------
section("A. Two sofas — replace one, the other is untouched");
{
  resetSelectionIds();
  const sofas = objectsOf("sofa");
  check("the fixture has two sofas", sofas.length === 2);

  const chosen = sofas[0];
  const other = sofas[1];
  const sel = selectionFromDetectedObject(chosen, SOURCE);
  const contract = contractFor([sel], [
    { selectionId: sel.selectionId, productId: SOFA_P, scope: "this-only" },
  ]);

  check("exactly one assignment", contract.assignments.length === 1);
  check("it targets the chosen sofa",
    contract.assignments[0].target.sceneItemId === chosen.sceneItemId);
  check("the product is the chosen sofa product",
    contract.assignments[0].productId === SOFA_P);
  check("the action is REPLACE", contract.assignments[0].action === "REPLACE");
  check("the target carries its region geometry",
    contract.assignments[0].target.boundingBox.width > 0);
  // Ids are sanitised to a safe token form, so "sofa-main" → "scene_sofa_main".
  check("the target id is readable and stable",
    contract.assignments[0].target.targetId ===
      `scene_${chosen.sceneItemId}`.replace(/[^a-zA-Z0-9_]+/g, "_"),
    contract.assignments[0].target.targetId);

  check("THE OTHER SOFA IS PROTECTED",
    contract.protectedItems.some((p) => p.sceneItemId === other.sceneItemId),
    "an unassigned same-category object must be protected");
  check("the other sofa is NOT assigned",
    !contract.assignments.some((a) => a.target.sceneItemId === other.sceneItemId));

  // The plan and prompt must name the instance and protect the sibling.
  const plan = contractToReplacementPlan(contract, allProfiles);
  check("the plan has one replacement", plan.replacements.length === 1);
  check("the plan flags the shared category",
    plan.replacements[0].existingSharesCategory === true,
    "must be true so the prompt disambiguates");

  const prompt = buildIntelligentRoomPrompt({
    roomAnalysis: sceneGraphToRoomAnalysis(scene),
    sceneGraph: scene,
    replacementPlan: plan,
    profiles: allProfiles,
    style: "modern luxury",
    roomType: "living room",
    aiConceptMode: false,
    referenceViewCount: 1,
  }).prompt;
  check("the prompt says ONLY that one may change",
    prompt.includes("and ONLY that one"));
  check("the prompt states the target region",
    /region ≈ x \d+–\d+%/.test(prompt), "region geometry must reach the model");
  check("the prompt protects the other sofa explicitly",
    prompt.includes("PRESERVE EXACTLY"));

  const reviewText = formatPlanForReview(plan, scene.architecture);
  check("the reviewer is told which instance", reviewText.includes("NOT any other"));
  check("the reviewer gets the target region",
    reviewText.includes("Target region"));
}

// --- B. Two sofas, all-similar, both replaced ------------------------------
section("B. Two sofas — replace all similar");
{
  resetSelectionIds();
  const sofas = objectsOf("sofa");
  const sel = selectionFromDetectedObject(sofas[0], SOURCE);
  const contract = contractFor([sel], [
    { selectionId: sel.selectionId, productId: SOFA_P, scope: "all-similar" },
  ]);

  check("BOTH sofas become explicit tasks", contract.assignments.length === 2,
    `${contract.assignments.length}`);
  const targetIds = contract.assignments.map((a) => a.target.sceneItemId);
  check("each sofa instance is targeted individually",
    sofas.every((s) => targetIds.includes(s.sceneItemId)),
    targetIds.join(", "));
  check("task ids are unique",
    new Set(contract.assignments.map((a) => a.taskId)).size === 2);
  check("both use the same chosen product",
    contract.assignments.every((a) => a.productId === SOFA_P));
  check("both are marked as an all-similar decision",
    contract.assignments.every((a) => a.scope === "all-similar"));
  check("no sofa remains protected",
    !contract.protectedItems.some((p) => p.canonicalCategory === "sofa"));
  check("non-sofas are still protected",
    contract.protectedItems.some((p) => p.canonicalCategory === "rug"));

  const plan = contractToReplacementPlan(contract, allProfiles);
  check("the plan has two replacements", plan.replacements.length === 2);
  check("only one product id is needed", contractProductIds(contract).length === 1);
}

// --- C. Sofa + coffee table each get the correct product -------------------
section("C. Sofa + coffee table — each receives its own product");
{
  resetSelectionIds();
  const sofa = objectsOf("sofa")[0];
  const table = objectsOf("coffee-table")[0];
  const sofaSel = selectionFromDetectedObject(sofa, SOURCE);
  const tableSel = selectionFromDetectedObject(table, SOURCE);

  const contract = contractFor([sofaSel, tableSel], [
    { selectionId: sofaSel.selectionId, productId: SOFA_P, scope: "this-only" },
    { selectionId: tableSel.selectionId, productId: TABLE_P, scope: "this-only" },
  ]);

  check("two assignments", contract.assignments.length === 2);
  const bySceneId = new Map(contract.assignments.map((a) => [a.target.sceneItemId, a]));
  check("the sofa region gets the sofa product",
    bySceneId.get(sofa.sceneItemId)?.productId === SOFA_P);
  check("the coffee-table region gets the coffee table",
    bySceneId.get(table.sceneItemId)?.productId === TABLE_P);
  check("categories are consistent per task",
    contract.assignments.every((a) =>
      canAssignProductCategory(a.canonicalCategory, a.productCategorySlug)));

  const summary = summariseContract(contract);
  check("the summary pairs each region with its product",
    summary.length === 2 && summary.every((line) => line.includes("→")),
    summary.join(" | "));

  const plan = contractToReplacementPlan(contract, allProfiles);
  check("each plan task carries its own product identity",
    new Set(plan.replacements.map((t) => t.productId)).size === 2);
  check("each plan task carries its own region",
    plan.replacements.every((t) => t.boundingBox !== null));
}

// --- D. TV unit selected, television protected -----------------------------
section("D. TV unit replaced, television protected");
{
  resetSelectionIds();
  const tvUnit = objectsOf("tv-unit")[0];
  check("the TV unit is selectable", Boolean(tvUnit));
  const sel = selectionFromDetectedObject(tvUnit, SOURCE);
  const contract = contractFor([sel], [
    { selectionId: sel.selectionId, productId: TVUNIT_P, scope: "this-only" },
  ]);

  check("the TV unit is assigned", contract.assignments.length === 1);
  check("it targets the TV unit",
    contract.assignments[0].target.sceneItemId === tvUnit.sceneItemId);

  // The television is not even a selectable object, so it can never be a target.
  check("the television is never a target",
    !contract.assignments.some((a) => a.target.sceneItemId === "tv-screen"));
  check("the television is not offered as selectable",
    !detected.some((o) => o.sceneItemId === "tv-screen"));

  const plan = contractToReplacementPlan(contract, allProfiles);
  check("the television is preserved by name",
    plan.preserved.some((p) => /television/i.test(p)),
    plan.preserved.join(", "));
  check("architecture is always preserved",
    ALWAYS_PROTECTED.every((item) => plan.preserved.includes(item.label)));

  const prompt = buildIntelligentRoomPrompt({
    roomAnalysis: sceneGraphToRoomAnalysis(scene),
    sceneGraph: scene,
    replacementPlan: plan,
    profiles: allProfiles,
    style: "modern luxury",
    roomType: "living room",
    aiConceptMode: false,
    referenceViewCount: 1,
  }).prompt;
  check("the prompt forbids moving the TV", /Never move or alter the TV/i.test(prompt));
  check("the prompt locks architecture", prompt.includes("ARCHITECTURE LOCK"));
}

// --- E. Manual region behaves like a smart-selected region -----------------
section("E. A manual region works like a smart region");
{
  resetSelectionIds();
  const manual = assignSelectionCategory(
    createManualSelection({
      boundingBox: { x: 0.1, y: 0.5, width: 0.3, height: 0.25 },
      sourceImage: SOURCE,
    }),
    "coffee-table"
  );

  const contract = contractFor([manual], [
    { selectionId: manual.selectionId, productId: TABLE_P, scope: "this-only" },
  ]);

  check("the manual region produces an assignment", contract.assignments.length === 1);
  check("it is a REPLACE action", contract.assignments[0].action === "REPLACE");
  check("it carries its drawn geometry",
    contract.assignments[0].target.boundingBox.width === 0.3);
  check("it records the manual method",
    contract.assignments[0].target.selectionMethod === "manual");
  check("it gets a readable manual target id",
    contract.assignments[0].target.targetId.startsWith("manual_region_"),
    contract.assignments[0].target.targetId);
  check("the category lock still applies to manual regions",
    contractFor([manual], [
      { selectionId: manual.selectionId, productId: SOFA_P, scope: "this-only" },
    ]).assignments.length === 0,
    "a sofa must not be assignable to a coffee-table region");

  const plan = contractToReplacementPlan(contract, allProfiles);
  check("the manual region reaches the plan", plan.replacements.length === 1);
  check("the plan task carries the drawn region",
    plan.replacements[0].boundingBox?.width === 0.3);

  const prompt = buildIntelligentRoomPrompt({
    roomAnalysis: sceneGraphToRoomAnalysis(scene),
    sceneGraph: scene,
    replacementPlan: plan,
    profiles: allProfiles,
    style: "modern luxury",
    roomType: "living room",
    aiConceptMode: false,
    referenceViewCount: 1,
  }).prompt;
  check("the manual region's geometry reaches the prompt",
    /region ≈ x 10–40%/.test(prompt), "drawn region must be stated");
}

// --- Contract integrity -----------------------------------------------------
section("Contract integrity");
{
  resetSelectionIds();
  const sofa = objectsOf("sofa")[0];
  const sel = selectionFromDetectedObject(sofa, SOURCE);

  check("an unassigned selection changes nothing",
    contractFor([sel], []).assignments.length === 0);
  check("an unassigned selection is protected",
    contractFor([sel], []).protectedItems.some((p) => p.sceneItemId === sofa.sceneItemId));
  check("an unknown product id is ignored",
    contractFor([sel], [
      { selectionId: sel.selectionId, productId: "no-such-product", scope: "this-only" },
    ]).assignments.length === 0);
  check("an unknown selection id is ignored",
    contractFor([sel], [
      { selectionId: "nope", productId: SOFA_P, scope: "this-only" },
    ]).assignments.length === 0);

  // Every detected object ends up either assigned or protected — never silent.
  const contract = contractFor([sel], [
    { selectionId: sel.selectionId, productId: SOFA_P, scope: "this-only" },
  ]);
  const accounted = new Set([
    ...contract.assignments.map((a) => a.target.sceneItemId),
    ...contract.protectedItems.map((p) => p.sceneItemId),
  ]);
  check("every detected object is accounted for",
    allDetected.every((o) => accounted.has(o.sceneItemId)),
    `${accounted.size} of ${allDetected.length}`);

  // A rug product must not be assignable to the sofa region.
  check("only the locked category can fill a region",
    contractFor([sel], [
      { selectionId: sel.selectionId, productId: RUG_P, scope: "this-only" },
    ]).assignments.length === 0);

  const plan = contractToReplacementPlan(contract, allProfiles);
  check("the plan adds nothing of its own", plan.additions.length === 0);
  check("dispositions cover assigned and protected objects",
    plan.dispositions.length === allDetected.length,
    `${plan.dispositions.length} vs ${allDetected.length}`);
  check("exactly one disposition is a replace",
    plan.dispositions.filter((d) => d.disposition === "replace").length === 1);
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All region-assignment tests passed.");
