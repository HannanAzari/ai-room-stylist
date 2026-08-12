/**
 * Deterministic tests for household-level replacement groups.
 *
 * Run with:  npm run test:replacement-group
 *
 * Covers scenarios A-E: standard sofas replaced individually, sectionals
 * collapsing to one unit, armchairs staying out of the sofa family, shelves
 * offering only category-compatible products, and package quantity semantics.
 */
import {
  buildReplacementGroups,
  absorbedTargetsFor,
  classifySofaConfiguration,
  decideStrategy,
  describeGroup,
  primaryTargetFor,
  toPackageLines,
} from "@/lib/intelligence/replacement-group";
import {
  canAssignProductCategory,
  selectionToTarget,
  type ReplacementTarget,
} from "@/lib/intelligence/replacement-assignment";
import {
  selectionFromDetectedObject,
  toSelectableObjects,
} from "@/lib/intelligence/room-selection";
import { getAllProducts } from "@/lib/products";
import { getPackagePricing } from "@/features/room-stylist/services/product-helpers";
import { buildGoldenLivingRoomSceneGraph } from "@/lib/intelligence/fixtures/golden-living-room";
import { assignInstanceLabels, type SceneFurniture } from "@/lib/intelligence/scene-graph";
import type { CanonicalCategory } from "@/lib/intelligence/scene-taxonomy";
import type { Product } from "@/lib/products";

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

/** Two sofas plus an armchair, so the sofa family can be tested in isolation. */
function twoSofasAndAnArmchair(): SceneFurniture[] {
  const base = buildGoldenLivingRoomSceneGraph().furniture.find(
    (f) => f.canonicalCategory === "sofa"
  )!;
  return assignInstanceLabels([
    { ...base, id: "sofa-a", category: "3 seater sofa", boundingBox: { x: 0.05, y: 0.5, width: 0.3, height: 0.2 } },
    { ...base, id: "sofa-b", category: "2 seater sofa", boundingBox: { x: 0.55, y: 0.5, width: 0.25, height: 0.18 } },
    {
      ...base,
      id: "armchair-a",
      category: "armchair",
      canonicalCategory: "armchair" as CanonicalCategory,
      boundingBox: { x: 0.85, y: 0.55, width: 0.12, height: 0.14 },
    },
  ]);
}

function targetsFor(items: SceneFurniture[]): ReplacementTarget[] {
  const scene = { ...buildGoldenLivingRoomSceneGraph(), furniture: items };
  return toSelectableObjects(scene).map((object, index) =>
    selectionToTarget(selectionFromDetectedObject(object, SOURCE), index)
  );
}

function groupsFor(
  items: SceneFurniture[],
  productByCategory: [CanonicalCategory, Product][]
) {
  const targets = targetsFor(items);
  const byCategory = new Map<CanonicalCategory, ReplacementTarget[]>();
  for (const target of targets) {
    const list = byCategory.get(target.canonicalCategory) ?? [];
    list.push(target);
    byCategory.set(target.canonicalCategory, list);
  }
  return buildReplacementGroups({
    targetsByCategory: byCategory,
    productByCategory: new Map(productByCategory),
  });
}

// --- Configuration classification ------------------------------------------
section("Sofa configuration is classified from real fields, conservatively");
{
  check("a corner sofa is sectional",
    classifySofaConfiguration(SECTIONAL_SOFA) === "sectional-or-l-shape",
    SECTIONAL_SOFA.name);
  check("an N-seater is standard",
    classifySofaConfiguration(STANDARD_SOFA) === "standard-sofa",
    STANDARD_SOFA.name);

  const terminal = catalogue.find((p) => /terminal/i.test(p.name))!;
  check("a sofa with a terminal is sectional",
    classifySofaConfiguration(terminal) === "sectional-or-l-shape", terminal.name);

  // "Modular" alone is NOT enough — guessing wrong deletes furniture.
  const modularOnly = catalogue.find(
    (p) => /modular/i.test(p.name) && !/corner|terminal|chaise/i.test(p.name)
  )!;
  check("a plain modular sofa is NOT assumed sectional",
    classifySofaConfiguration(modularOnly) !== "sectional-or-l-shape",
    modularOnly.name);

  check("an unrecognised product is unknown, not sectional",
    classifySofaConfiguration({ ...STANDARD_SOFA, name: "Mystery Couch", shape: null, silhouette: null } as Product) === "unknown");
  check("unknown takes the SAFE standard path",
    decideStrategy({ canonicalCategory: "sofa", targetCount: 2, configuration: "unknown" }) === "replace-each");
}

// --- A. Two sofas, standard sofa selected ----------------------------------
section("A. Two sofas + standard sofa → replace each, armchair untouched");
{
  const groups = groupsFor(twoSofasAndAnArmchair(), [["sofa", STANDARD_SOFA]]);
  const sofaGroup = groups.find((g) => g.canonicalCategory === "sofa")!;

  check("one group for the sofa category", groups.length === 1);
  check("both sofa instances are targeted", sofaGroup.targets.length === 2,
    `${sofaGroup.targets.length}`);
  check("both targets are the sofas",
    sofaGroup.targets.every((t) => t.sceneItemId?.startsWith("sofa-")),
    sofaGroup.targets.map((t) => t.sceneItemId).join(", "));
  check("one chosen product covers them", sofaGroup.selectedProductId === STANDARD_SOFA.id);
  check("strategy is replace-each", sofaGroup.strategy === "replace-each");
  check("quantity is 2 — the room needs two", sofaGroup.quantity === 2);
  check("nothing is absorbed", absorbedTargetsFor(sofaGroup).length === 0);

  check("THE ARMCHAIR IS NOT IN THE SOFA GROUP",
    !sofaGroup.targets.some((t) => t.sceneItemId === "armchair-a"));
  check("no armchair group exists without an armchair product",
    !groups.some((g) => g.canonicalCategory === "armchair"));
  check("the summary shows the quantity", describeGroup(sofaGroup).includes("× 2"),
    describeGroup(sofaGroup));
}

// --- B. Two sofas, sectional selected --------------------------------------
section("B. Two sofas + sectional → one combined unit");
{
  const groups = groupsFor(twoSofasAndAnArmchair(), [["sofa", SECTIONAL_SOFA]]);
  const sofaGroup = groups.find((g) => g.canonicalCategory === "sofa")!;

  check("both sofas are still targeted (both get cleared)",
    sofaGroup.targets.length === 2);
  check("strategy is replace-group-with-single",
    sofaGroup.strategy === "replace-group-with-single");
  check("QUANTITY IS 1 — one physical sectional", sofaGroup.quantity === 1);

  const primary = primaryTargetFor(sofaGroup);
  const absorbed = absorbedTargetsFor(sofaGroup);
  check("it is placed exactly once", absorbed.length === sofaGroup.targets.length - 1);
  check("the placement goes to the largest seating area",
    primary.sceneItemId === "sofa-a",
    `${primary.sceneItemId} (largest box should win)`);
  check("the absorbed seat is the other sofa",
    absorbed[0].sceneItemId === "sofa-b");
  check("the armchair is not absorbed",
    !absorbed.some((t) => t.sceneItemId === "armchair-a"));
  check("the summary explains the combined unit",
    describeGroup(sofaGroup).includes("one combined unit"), describeGroup(sofaGroup));

  // A sectional with only ONE sofa in the room is just a normal replacement.
  const single = groupsFor(
    twoSofasAndAnArmchair().filter((f) => f.id !== "sofa-b"),
    [["sofa", SECTIONAL_SOFA]]
  );
  check("a sectional with one sofa still replaces each",
    single[0].strategy === "replace-each");
  check("...and its quantity is 1", single[0].quantity === 1);
}

// --- C. Selecting sofa never touches the armchair --------------------------
section("C. Sofa selection does not replace an armchair");
{
  for (const product of [STANDARD_SOFA, SECTIONAL_SOFA]) {
    const groups = groupsFor(twoSofasAndAnArmchair(), [["sofa", product]]);
    const allTargets = groups.flatMap((g) => g.targets.map((t) => t.sceneItemId));
    check(`${classifySofaConfiguration(product)}: armchair is never a target`,
      !allTargets.includes("armchair-a"), allTargets.join(", "));
  }

  // An armchair is its own category with its own product.
  const armchairProduct = catalogue.find((p) => p.category === "chairs")!;
  const both = groupsFor(twoSofasAndAnArmchair(), [
    ["sofa", STANDARD_SOFA],
    ["armchair", armchairProduct],
  ]);
  check("armchairs form a separate group", both.length === 2);
  const armchairGroup = both.find((g) => g.canonicalCategory === "armchair")!;
  check("the armchair group holds only the armchair",
    armchairGroup.targets.length === 1 &&
      armchairGroup.targets[0].sceneItemId === "armchair-a");
  check("a sofa product may not fill an armchair region",
    !canAssignProductCategory("armchair", "sofas"));
}

// --- D. Shelves only offer category-compatible products --------------------
section("D. Shelves only offer category-compatible products");
{
  const cases: [CanonicalCategory, string, string[]][] = [
    ["sofa", "sofas", ["coffee-tables", "rugs", "tv-units", "chairs"]],
    ["coffee-table", "coffee-tables", ["sofas", "rugs"]],
    ["rug", "rugs", ["sofas", "coffee-tables"]],
    ["tv-unit", "tv-units", ["sofas", "decor"]],
  ];
  for (const [region, allowed, forbidden] of cases) {
    const eligible = catalogue.filter((p) =>
      canAssignProductCategory(region, p.category)
    );
    check(`${region} shelf offers only ${allowed}`,
      eligible.length > 0 && eligible.every((p) => p.category === allowed),
      [...new Set(eligible.map((p) => p.category))].join(", "));
    for (const bad of forbidden) {
      check(`${region} shelf excludes ${bad}`,
        !eligible.some((p) => p.category === bad));
    }
  }
  check("a television region offers nothing at all",
    catalogue.filter((p) => canAssignProductCategory("tv", p.category)).length === 0);
}

// --- E. Package quantity semantics -----------------------------------------
section("E. Package shows one card per SKU with correct quantity");
{
  const groups = groupsFor(twoSofasAndAnArmchair(), [["sofa", STANDARD_SOFA]]);
  const lines = toPackageLines(groups);

  check("one line per distinct product", lines.length === 1, `${lines.length}`);
  check("no duplicate SKU entries",
    new Set(lines.map((l) => l.productId)).size === lines.length);
  check("quantity records the two physical units",
    lines[0].quantity === 2, `${lines[0].quantity}`);

  const sectionalLines = toPackageLines(
    groupsFor(twoSofasAndAnArmchair(), [["sofa", SECTIONAL_SOFA]])
  );
  check("a sectional is a single unit", sectionalLines[0].quantity === 1);

  // Two categories, two lines.
  const mixed = toPackageLines(
    groupsFor(twoSofasAndAnArmchair(), [["sofa", STANDARD_SOFA]]).concat(
      groupsFor(
        [
          {
            ...buildGoldenLivingRoomSceneGraph().furniture.find(
              (f) => f.canonicalCategory === "coffee-table"
            )!,
          },
        ],
        [["coffee-table", COFFEE_TABLE]]
      )
    )
  );
  check("distinct products get distinct lines", mixed.length === 2);

  // Pricing must charge for the units, not the cards.
  const priced = { ...STANDARD_SOFA, price: 1000 } as Product;
  const single = getPackagePricing([priced], 0);
  const doubled = getPackagePricing([priced], 0, { [priced.id]: 2 });
  check("one unit prices once", single.subtotal === 1000, `${single.subtotal}`);
  check("TWO UNITS PRICE TWICE", doubled.subtotal === 2000, `${doubled.subtotal}`);
  check("item count reflects units, not cards", doubled.totalItems === 2);
  check("a missing quantity safely defaults to 1",
    getPackagePricing([priced], 0, {}).subtotal === 1000);
  check("unpriced products are still never fabricated",
    getPackagePricing([{ ...STANDARD_SOFA, price: null } as Product], 0, {
      [STANDARD_SOFA.id]: 2,
    }).subtotal === 0);
  check("...and are counted as unpriced units",
    getPackagePricing([{ ...STANDARD_SOFA, price: null } as Product], 0, {
      [STANDARD_SOFA.id]: 2,
    }).unpricedItems === 2);
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All replacement-group tests passed.");
