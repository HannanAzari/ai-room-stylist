/**
 * Deterministic tests for the category-first Replace flow.
 *
 * Run with:  npm run test:category-flow
 *
 * Covers the final UX sprint's contract: customers choose furniture TYPES, the
 * room analysis stays invisible, choosing a type means every piece of it, and
 * Replace mode may never add anything nobody asked for.
 */
import {
  groupDetectedByCategory,
  objectsForSelectedCategories,
  selectionFromDetectedObject,
  toSelectableObjects,
} from "@/lib/intelligence/room-selection";
import {
  buildReplacementGroups,
  toPackageLines,
} from "@/lib/intelligence/replacement-group";
import { selectionToTarget } from "@/lib/intelligence/replacement-assignment";
import { buildReplacementPlan } from "@/lib/intelligence/replacement-planner";
import { buildIntelligentRoomPrompt } from "@/lib/intelligence/prompt-builder";
import { getProductProfiles } from "@/lib/intelligence/product-profile";
import {
  assignInstanceLabels,
  sceneGraphToRoomAnalysis,
  type SceneFurniture,
} from "@/lib/intelligence/scene-graph";
import { selectRoomPackage, packageProductIds } from "@/lib/intelligence/room-package";
import { buildGoldenLivingRoomSceneGraph } from "@/lib/intelligence/fixtures/golden-living-room";
import { getAllProducts, getProductsByIdsInSelectionOrder } from "@/lib/products";
import type { CanonicalCategory } from "@/lib/intelligence/scene-taxonomy";
import type { ReplacementTarget } from "@/lib/intelligence/replacement-assignment";
import { readFileSync } from "fs";

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

const SOURCE = { width: 1400, height: 1050 };
const catalogue = getAllProducts();
const STANDARD_SOFA = catalogue.find((p) => p.id.startsWith("celia-mid-beige-2-seater"))!;
const SECTIONAL_SOFA = catalogue.find((p) => p.id.startsWith("soluna-powder-white"))!;
const COFFEE_TABLE = catalogue.find((p) => p.category === "coffee-tables")!;

/** Two sofas, an armchair, a coffee table and a rug. */
function testRoom(): SceneFurniture[] {
  const base = buildGoldenLivingRoomSceneGraph().furniture.find(
    (f) => f.canonicalCategory === "sofa"
  )!;
  const table = buildGoldenLivingRoomSceneGraph().furniture.find(
    (f) => f.canonicalCategory === "coffee-table"
  )!;
  const rug = buildGoldenLivingRoomSceneGraph().furniture.find(
    (f) => f.canonicalCategory === "rug"
  )!;
  return assignInstanceLabels([
    { ...base, id: "sofa-a", category: "3 seater sofa", boundingBox: { x: 0.05, y: 0.5, width: 0.3, height: 0.2 } },
    { ...base, id: "sofa-b", category: "2 seater sofa", boundingBox: { x: 0.55, y: 0.5, width: 0.25, height: 0.18 } },
    { ...base, id: "armchair-a", category: "armchair", canonicalCategory: "armchair" as CanonicalCategory,
      boundingBox: { x: 0.85, y: 0.55, width: 0.12, height: 0.14 } },
    { ...table, id: "table-a" },
    { ...rug, id: "rug-a" },
  ]);
}

const detected = toSelectableObjects({
  ...buildGoldenLivingRoomSceneGraph(),
  furniture: testRoom(),
});

function groupsFor(categories: CanonicalCategory[], products: [CanonicalCategory, typeof STANDARD_SOFA][]) {
  const objects = objectsForSelectedCategories(categories, detected);
  const byCategory = new Map<CanonicalCategory, ReplacementTarget[]>();
  objects.forEach((object, index) => {
    const target = selectionToTarget(selectionFromDetectedObject(object, SOURCE), index);
    const list = byCategory.get(target.canonicalCategory) ?? [];
    list.push(target);
    byCategory.set(target.canonicalCategory, list);
  });
  return buildReplacementGroups({
    targetsByCategory: byCategory,
    productByCategory: new Map(products),
  });
}

// --- 1. Category grouping ---------------------------------------------------
section("1. Two detected sofas become ONE 'Sofas' type with count 2");
{
  const categories = groupDetectedByCategory(detected);
  const sofas = categories.find((c) => c.canonicalCategory === "sofa")!;

  check("sofas appear once, not twice",
    categories.filter((c) => c.canonicalCategory === "sofa").length === 1);
  check("the count is 2", sofas.count === 2, `${sofas.count}`);
  check("the label is pluralised", sofas.label === "Sofas", sofas.label);
  check("the instances are kept behind it", sofas.objects.length === 2);
  check("a single item stays singular",
    categories.find((c) => c.canonicalCategory === "rug")?.label === "Rug");

  // No customer-facing instance naming at this level.
  check("no 'Sofa 1' / 'Sofa 2' in the category labels",
    !categories.some((c) => /\d/.test(c.label)),
    categories.map((c) => c.label).join(", "));
  check("categories are ordered by count", categories[0].count >= categories[1].count);
}

// --- 2. Category selection → exactly those shelves ------------------------
section("2. Selecting types yields exactly those product shelves");
{
  const objects = objectsForSelectedCategories(["sofa", "coffee-table"], detected);
  const shelfCategories = [...new Set(objects.map((o) => o.canonicalCategory))];

  check("exactly two types resolve", shelfCategories.length === 2, shelfCategories.join(", "));
  check("sofas are included", shelfCategories.includes("sofa"));
  check("coffee table is included", shelfCategories.includes("coffee-table"));
  check("the rug is NOT included", !shelfCategories.includes("rug"));
  check("the armchair is NOT included", !shelfCategories.includes("armchair"));

  // Choosing a type means every piece of that type.
  check("choosing Sofas covers BOTH sofas",
    objects.filter((o) => o.canonicalCategory === "sofa").length === 2);

  const three = objectsForSelectedCategories(["sofa", "coffee-table", "rug"], detected);
  check("three types resolve to three shelves",
    new Set(three.map((o) => o.canonicalCategory)).size === 3);
  check("selecting nothing resolves to nothing",
    objectsForSelectedCategories([], detected).length === 0);
}

// --- 3. Sofa multiplicity ---------------------------------------------------
section("3. A conventional sofa applies to both sofa positions");
{
  const groups = groupsFor(["sofa"], [["sofa", STANDARD_SOFA]]);
  const sofaGroup = groups.find((g) => g.canonicalCategory === "sofa")!;

  check("one group, not two", groups.length === 1);
  check("it targets both sofas", sofaGroup.targets.length === 2);
  check("strategy is replace-each", sofaGroup.strategy === "replace-each");
  check("QUANTITY IS 2", sofaGroup.quantity === 2, `${sofaGroup.quantity}`);
  check("one product covers both", sofaGroup.selectedProductId === STANDARD_SOFA.id);
  check("the basket has one line of quantity 2",
    toPackageLines(groups).length === 1 && toPackageLines(groups)[0].quantity === 2);
}

// --- 4. Sectional replaces the arrangement once ---------------------------
section("4. A sectional replaces the arrangement ONCE");
{
  const groups = groupsFor(["sofa"], [["sofa", SECTIONAL_SOFA]]);
  const sofaGroup = groups.find((g) => g.canonicalCategory === "sofa")!;

  check("both sofas are still cleared", sofaGroup.targets.length === 2);
  check("strategy is replace-group-with-single",
    sofaGroup.strategy === "replace-group-with-single");
  check("QUANTITY IS 1 — not doubled", sofaGroup.quantity === 1);
  check("the basket charges for one unit",
    toPackageLines(groups)[0].quantity === 1);
}

// --- 5. Armchairs stay separate --------------------------------------------
section("5. Armchairs are never folded into Sofas");
{
  const categories = groupDetectedByCategory(detected);
  check("armchair is its own type",
    categories.some((c) => c.canonicalCategory === "armchair"));
  check("the Sofas type excludes the armchair",
    !categories
      .find((c) => c.canonicalCategory === "sofa")!
      .objects.some((o) => o.sceneItemId === "armchair-a"));

  const objects = objectsForSelectedCategories(["sofa"], detected);
  check("selecting Sofas never targets the armchair",
    !objects.some((o) => o.sceneItemId === "armchair-a"));

  for (const product of [STANDARD_SOFA, SECTIONAL_SOFA]) {
    const groups = groupsFor(["sofa"], [["sofa", product]]);
    check(`${product.id.slice(0, 12)}…: armchair untouched`,
      !groups.flatMap((g) => g.targets).some((t) => t.sceneItemId === "armchair-a"));
  }
}

// --- 6. Replace mode adds nothing ------------------------------------------
section("6. Replace mode is an allowlist — nothing may be added");
{
  const ids = [STANDARD_SOFA.id, COFFEE_TABLE.id];
  const products = getProductsByIdsInSelectionOrder(ids);
  const profiles = getProductProfiles(products);
  const plan = buildReplacementPlan({
    sceneGraph: buildGoldenLivingRoomSceneGraph(),
    profiles,
    selectedProductIds: ids,
    aiConceptMode: false,
  });
  const prompt = buildIntelligentRoomPrompt({
    roomAnalysis: sceneGraphToRoomAnalysis(buildGoldenLivingRoomSceneGraph()),
    sceneGraph: buildGoldenLivingRoomSceneGraph(),
    replacementPlan: plan,
    profiles,
    style: "modern luxury",
    roomType: "living room",
    aiConceptMode: false,
    selectedProductIds: ids,
    referenceViewCount: ids.length,
  }).prompt;

  check("the prompt states this is a replacement, not a redesign",
    prompt.includes("THIS IS A REPLACEMENT, NOT A REDESIGN"));
  check("it names the allowlist of what may change",
    /The ONLY things that may change are: /.test(prompt));
  check("it forbids side tables by name",
    /no side tables/.test(prompt), "the observed defect must be named");
  check("it forbids filling empty space",
    /An empty corner stays empty/.test(prompt));
  check("it forbids improving the room",
    /Do NOT tidy, restyle, relight or improve/.test(prompt));
  check("it tells the model to leave anything uncertain alone",
    /If you are unsure whether something may change, leave it alone/.test(prompt));

  // No application-side complementary additions in replace mode.
  check("the plan adds no complementary products",
    plan.additions.every((task) => task.source === "selected"));
  check("every planned product was chosen by the customer",
    [...plan.replacements, ...plan.additions].every((t) => ids.includes(t.productId)));
}

// --- 7. Surprise Me needs no confirmation ----------------------------------
section("7. Surprise Me picks a coherent package with no confirmation step");
{
  const pkg = selectRoomPackage({
    roomType: "living room",
    style: "modern luxury",
    catalogue,
  });
  check("it spans several categories",
    new Set(pkg.items.map((i) => i.category)).size >= 4);
  check("roughly 5-6 pieces", pkg.items.length >= 4 && pkg.items.length <= 6,
    `${pkg.items.length}`);
  check("every item is real", pkg.items.every((i) =>
    catalogue.some((p) => p.id === i.productId)));
  check("no duplicate categories",
    new Set(pkg.items.map((i) => i.category)).size === pkg.items.length);

  // The customer journey must not contain a package screen.
  const studio = readFileSync("src/components/studio/KoalaDesignStudio.tsx", "utf8");
  check("no 'pieces, chosen to work together' screen remains",
    !/pieces, chosen to work together/.test(studio));
  check("no 'Your Koala package' confirmation remains",
    !/Your Koala package/.test(studio));
  // Surprise me now asks exactly ONE question — the look — before designing.
  // That is a question about taste, not a package to approve, so the guarantee
  // being defended is unchanged: the customer never signs off a product list.
  check("Surprise me asks for a look, then designs",
    /designMode === "surprise-me"[\s\S]{0,200}renderSurpriseStyleStep/.test(studio));
  check("choosing the look is the only step before generating",
    /void handleGenerate\("surprise-me"\)/.test(studio));
  check("no package screen stands between the look and the room",
    !/Review your package|Approve your|Confirm your pieces/.test(studio));
}

// --- 8. Products used derive from the final plan ---------------------------
section("8. Products used derive from the final plan");
{
  const pkg = selectRoomPackage({ roomType: "living room", style: "x", catalogue });
  const ids = packageProductIds(pkg);
  const route = readFileSync("src/app/api/studio/generate-gemini/route.ts", "utf8");

  check("products used are filtered to the plan",
    /plannedProductIds\.has\(product\.id\)/.test(route));
  check("compliance failures drop a product",
    /failedComplianceProductIds/.test(route));
  check("an unavailable review never shrinks the package",
    /review-unavailable[\s\S]{0,120}return true/.test(route));
  check("the package is the only source for Surprise me",
    /autoPackage\s*\?\s*getProductsByIdsInSelectionOrder\(packageProductIds\(autoPackage\)\)/.test(
      route
    ));
  check("every package id is a real product",
    ids.every((id) => catalogue.some((p) => p.id === id)));
}

// --- 9. The room analysis stays invisible ----------------------------------
section("9. No detection detail reaches the ordinary journey");
{
  // Comments describe what we avoid, so assertions about behaviour must not
  // read them — a doc line saying 'no "Sofa 1"' would otherwise fail the check.
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const picker = stripComments(
    readFileSync("src/components/studio/ReplaceCategoryPicker.tsx", "utf8")
  );
  const studio = readFileSync("src/components/studio/KoalaDesignStudio.tsx", "utf8");

  // The menu is prebuilt from the room type, so there are no counts to show:
  // nothing has looked at the photo when this screen appears. What must stay
  // true is that no per-instance detail ever reaches it.
  check("the category screen names types, never instances",
    !/Sofa 1|instanceLabel|sceneItemId/.test(picker));
  check("the menu needs no analysis to render",
    !/detectionState|detectedObjects|analysed/.test(picker));
  check("no boxes or dots are drawn on the category screen",
    !/boundingBox|projectBox/.test(picker));
  check("the advanced picker is opt-in",
    /Choose a specific one instead/.test(picker));
  check("manual marking is a secondary link",
    /Mark an area yourself/.test(studio));

  // Customer-facing copy must not use engineering vocabulary.
  const customerCopy = [
    "What would you like to replace?",
    "Choose your new pieces",
    "What should your seating be?",
    "What look are you after?",
  ];
  for (const line of customerCopy) {
    check(`copy present: "${line.slice(0, 34)}…"`, studio.includes(line));
  }
  // Honesty: the menu appears before any analysis, so it must not claim to
  // have found anything in the customer's actual room.
  check("no claim to have found pieces before looking",
    !studio.includes("We found these pieces in your room"));

  for (const jargon of [
    "bounding box",
    "segmentation",
    "object detection",
    "AI detected",
    "replacement instance",
  ]) {
    check(`no customer-facing "${jargon}"`,
      !new RegExp(`>[^<]*${jargon}`, "i").test(studio));
  }
}

// --- 10. Scroll reset survives ---------------------------------------------
section("10. Result still opens at the top");
{
  const studio = readFileSync("src/components/studio/KoalaDesignStudio.tsx", "utf8");
  check("the scroll container is still reset",
    /useLayoutEffect\(\(\) => \{[\s\S]{0,400}scrollTop = 0/.test(studio));
  check("it still re-applies on the next frame",
    /requestAnimationFrame\([\s\S]{0,120}scrollTop = 0/.test(studio));
  check("it still keys off the result epoch",
    /\}, \[step, resultEpoch\]\);/.test(studio));
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All category-flow tests passed.");
