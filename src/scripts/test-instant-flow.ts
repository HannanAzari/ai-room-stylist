/**
 * The instant-menu sprint, defended.
 *
 * Four promises this sprint makes, each of which is easy to break silently:
 *
 *  1. The replace menu appears WITHOUT analysing the room. If a future change
 *     reintroduces a detection call on the way in, the customer goes back to
 *     staring at a spinner and nobody notices in review.
 *  2. Seating is a PLAN, not a swap — and a plan asking for more than the room
 *     holds must actually produce those extra pieces rather than dropping them.
 *  3. Category intent resolves to real instances server-side, honouring the
 *     category lock and leaving everything unchosen alone.
 *  4. A room photo is analysed once, not twice.
 */
import { readFileSync } from "node:fs";
import {
  getCategoryMenu,
  isCategorySupported,
  isSeatingCategory,
  buildSeatingPlan,
  describeSeatingPlan,
  seatingPlanProductCategories,
  SEATING_PRESETS,
  SURPRISE_STYLES,
  surpriseStylePrompt,
  getSurpriseStyle,
  emptyFlowState,
} from "@/lib/intelligence/room-categories";
import {
  parseCategoryIntents,
  resolveCategoryIntents,
} from "@/lib/intelligence/category-intent";
import {
  clearSceneCache,
  getCachedSceneGraph,
  roomImageKey,
  sceneCacheSize,
  setCachedSceneGraph,
} from "@/lib/intelligence/scene-cache";
import { canAssignProductCategory } from "@/lib/intelligence/replacement-assignment";
import { getProductProfiles } from "@/lib/intelligence/product-profile";
import { getAllProducts } from "@/lib/products";
import type { SceneGraph } from "@/lib/intelligence/scene-graph";

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

function section(title: string) {
  console.log(`\n${title}`);
}

const catalogue = getAllProducts();
const SOURCE = { width: 1200, height: 900 };

/** A room with two sofas, one rug and a fixed window. */
function sceneWithTwoSofas(): SceneGraph {
  return {
    roomType: "living room",
    analysed: true,
    furniture: [
      {
        id: "sofa_a",
        category: "3 seater sofa",
        canonicalCategory: "sofa",
        instanceLabel: "the left 3 seater sofa",
        replaceable: true,
        boundingBox: { x: 0.05, y: 0.45, width: 0.35, height: 0.3 },
        confidence: 0.9,
      },
      {
        id: "sofa_b",
        category: "2 seater sofa",
        canonicalCategory: "sofa",
        instanceLabel: "the right 2 seater sofa",
        replaceable: true,
        boundingBox: { x: 0.55, y: 0.45, width: 0.3, height: 0.28 },
        confidence: 0.88,
      },
      {
        id: "rug_a",
        category: "rug",
        canonicalCategory: "rug",
        instanceLabel: "the rug",
        replaceable: true,
        boundingBox: { x: 0.2, y: 0.7, width: 0.5, height: 0.2 },
        confidence: 0.8,
      },
      {
        id: "window_a",
        category: "window",
        canonicalCategory: "window",
        instanceLabel: "the window",
        replaceable: false,
        boundingBox: { x: 0.8, y: 0.1, width: 0.15, height: 0.4 },
        confidence: 0.95,
      },
    ],
    architecture: {},
  } as unknown as SceneGraph;
}

function firstProductIn(category: string) {
  const product = catalogue.find((entry) => entry.category === category);
  if (!product) throw new Error(`no ${category} in the catalogue`);
  return product;
}

// --- 1. The menu is prebuilt ------------------------------------------------
section("1. The replace menu costs nothing to show");
{
  const menu = getCategoryMenu("living room");
  check("a living room menu exists", menu.length > 0);
  check("it leads with seating",
    menu[0].canonicalCategory === "sofa" && menu[0].behaviour === "seating");
  check("sofas are the configurable one",
    isSeatingCategory("living room", "sofa"));
  check("a rug is a plain swap", !isSeatingCategory("living room", "rug"));
  check("an unknown room type still gets a menu",
    getCategoryMenu("games room").length > 0);
  check("room type is matched case-insensitively",
    getCategoryMenu("Living Room").length === menu.length);

  // Honesty: the menu is written from what a room contains, so some entries
  // have nothing behind them. Those must be reported as unsupported, not
  // quietly offered.
  check("sofas are supported", isCategorySupported("sofa", catalogue));
  check("rugs are supported", isCategorySupported("rug", catalogue));
  check("sideboards are not supported yet",
    !isCategorySupported("sideboard", catalogue));
  check("plants are not supported yet",
    !isCategorySupported("plant", catalogue));
  // The catalogue has no armchairs at all — everything filed under "chairs"
  // is a DINING chair. Offering one for an armchair region would put a dining
  // chair where the armchair was, which is a category error dressed up as a
  // near-enough match.
  check("armchairs are not supported yet",
    !isCategorySupported("armchair", catalogue));
  check("nothing may fill an armchair region",
    !canAssignProductCategory("armchair", "chairs"));
  check("dining chairs still fill dining-chair regions",
    canAssignProductCategory("chair", "chairs"));
  check("the catalogue really has no armchairs",
    catalogue.filter((p) => p.category === "chairs")
      .every((p) => /dining/i.test(p.name)));

  // Copy honesty: with no analysis, a count describes the customer's plan, not
  // their room, and the shelf has to say which.
  const shelves = readFileSync(
    "src/components/studio/CategoryProductShelves.tsx",
    "utf8"
  );
  check("the shelf knows where its counts came from",
    /countsAreFromRoom/.test(shelves));
  check('it only claims "in your room" when it looked',
    /countsAreFromRoom\s*\n?\s*\?\s*`\$\{targetCount\} in your room`/.test(
      shelves
    ));

  // The whole point of a prebuilt menu: nothing analyses the room to show it.
  const studio = readFileSync(
    "src/components/studio/KoalaDesignStudio.tsx",
    "utf8"
  );
  const replaceCardBlock =
    studio.match(/title="Replace items"[\s\S]{0,700}?\/>/)?.[0] ?? "";
  check("choosing Replace items runs no detection",
    replaceCardBlock.length > 0 &&
      !/detectRoomObjects/.test(replaceCardBlock));
  check("detection is reserved for the advanced and manual paths",
    (studio.match(/void detectRoomObjects\(\)/g) ?? []).length === 2);
  check("no shelf is built for a type nothing can fill",
    /if \(!isCategorySupported\(canonicalCategory, allCatalogueProducts\)\)/.test(
      studio
    ));
  check("the seating configurator hides what it cannot supply",
    /armchairsAvailable=\{isCategorySupported\(/.test(studio));
}

// --- 2. Seating is a destination, not a swap --------------------------------
section("2. Seating plans state where the room should end up");
{
  const lShape = SEATING_PRESETS.find((preset) => preset.id === "sofa-l");
  if (!lShape) throw new Error("missing the L-shape preset");

  const alone = buildSeatingPlan(lShape, 0);
  check("a bare plan is just the sofa", alone.pieces.length === 1);
  check("it reads back in plain words",
    describeSeatingPlan(alone) === "1 L-shape sofa",
    describeSeatingPlan(alone));

  const withChairs = buildSeatingPlan(lShape, 2);
  check("armchairs join the plan", withChairs.pieces.length === 2);
  check("and it still reads like a sentence",
    describeSeatingPlan(withChairs) === "1 L-shape sofa and 2 armchairs",
    describeSeatingPlan(withChairs));
  check("a plan needing two kinds needs two shelves",
    seatingPlanProductCategories(withChairs).length === 2);
  check("sofa pieces come from sofas",
    seatingPlanProductCategories(alone)[0] === "sofas");
  check("zero armchairs adds nothing",
    buildSeatingPlan(lShape, 0).pieces.every((p) => p.kind !== "armchair"));
  check("every preset offers armchairs",
    SEATING_PRESETS.every((preset) => preset.armchairsAdjustable));
  check("the presets stay a short list", SEATING_PRESETS.length <= 5);
}

// --- 3. Style is asked once and never invented -------------------------------
section("3. Surprise me asks for a look");
{
  check("there are a handful of looks", SURPRISE_STYLES.length === 7);
  check('"No preference" is offered',
    SURPRISE_STYLES.some((style) => style.id === "no-preference"));
  check("no preference carries no style tags",
    getSurpriseStyle("no-preference")?.styleTags.length === 0);

  // "No preference" must defer to the room, not invent a look for it.
  check("no preference falls back to the room's own direction",
    surpriseStylePrompt("no-preference", "warm neutral") === "warm neutral");
  check("an unknown id falls back too",
    surpriseStylePrompt("art-deco", "warm neutral") === "warm neutral");
  check("null falls back too",
    surpriseStylePrompt(null, "modern luxury") === "modern luxury");
  check("a real choice is used",
    surpriseStylePrompt("scandinavian", "modern luxury") === "scandinavian");
  check("every style has a label",
    SURPRISE_STYLES.every((style) => style.label.trim().length > 0));
  check("style ids are unique",
    new Set(SURPRISE_STYLES.map((s) => s.id)).size === SURPRISE_STYLES.length);
}

// --- 4. Intent parsing is forgiving, never fatal -----------------------------
section("4. Category intent survives the wire");
{
  check("nothing parses to nothing", parseCategoryIntents(null).length === 0);
  check("junk parses to nothing", parseCategoryIntents("not json").length === 0);
  check("a non-array parses to nothing",
    parseCategoryIntents('{"a":1}').length === 0);

  const mixed = parseCategoryIntents(
    JSON.stringify([
      { canonicalCategory: "sofa", productId: "p1" },
      { canonicalCategory: "rug" },
      { productId: "p2" },
      null,
      { canonicalCategory: "rug", productId: "p3", sceneItemIds: ["rug_a", 7] },
    ])
  );
  check("valid entries survive", mixed.length === 2);
  check("one bad entry costs one category, not the request",
    mixed[0].canonicalCategory === "sofa");
  check("non-string scene ids are dropped",
    mixed[1].sceneItemIds?.length === 1);

  const planned = parseCategoryIntents(
    JSON.stringify([
      {
        canonicalCategory: "sofa",
        productId: "p1",
        seatingPlan: { presetId: "sofa-l", pieces: [{ kind: "sofa-l-shape", count: 1 }] },
      },
      {
        canonicalCategory: "rug",
        productId: "p2",
        seatingPlan: { presetId: 9, pieces: "nope" },
      },
    ])
  );
  check("a well-formed plan survives", planned[0].seatingPlan !== undefined);
  check("a malformed plan is dropped, the intent kept",
    planned[1] !== undefined && planned[1].seatingPlan === undefined);
}

// --- 5. Resolution against a real room ---------------------------------------
section("5. Intent resolves to the room's actual pieces");
{
  const rug = firstProductIn("rugs");
  const scene = sceneWithTwoSofas();

  const resolved = resolveCategoryIntents({
    intents: [{ canonicalCategory: "rug", productId: rug.id }],
    sceneGraph: scene,
    catalogue,
    profiles: getProductProfiles([rug]),
    sourceImage: SOURCE,
  });
  check("one rug in the room becomes one task",
    resolved.contract?.assignments.length === 1);
  check("the task points at the actual rug",
    resolved.contract?.assignments[0].target.sceneItemId === "rug_a");
  check("the sofas are protected, not touched",
    (resolved.contract?.protectedItems ?? []).some(
      (item) => item.sceneItemId === "sofa_a"
    ));
  check("the window is never a target",
    !(resolved.contract?.assignments ?? []).some(
      (a) => a.target.sceneItemId === "window_a"
    ));

  // "Replace my sofas" means every sofa. But how many PIECES that becomes
  // depends on what was chosen: two sofas replaced by two two-seaters is two
  // of everything; two sofas replaced by one sectional is one piece placed
  // once, covering both — and the basket must charge accordingly. Both
  // branches are asserted, because a rule that only ever takes one path is
  // not a rule.
  const isSectional = (name: string) =>
    /corner|chaise|sectional|l shape|terminal/i.test(name);
  const standardSofa = catalogue.find(
    (p) => p.category === "sofas" && !isSectional(p.name)
  );
  const sectionalSofa = catalogue.find(
    (p) => p.category === "sofas" && isSectional(p.name)
  );
  if (!standardSofa || !sectionalSofa) {
    throw new Error("the catalogue no longer has both sofa shapes");
  }

  const twoStandard = resolveCategoryIntents({
    intents: [{ canonicalCategory: "sofa", productId: standardSofa.id }],
    sceneGraph: scene,
    catalogue,
    profiles: getProductProfiles([standardSofa]),
    sourceImage: SOURCE,
  });
  check("two sofas replaced one-for-one give two tasks",
    twoStandard.contract?.assignments.length === 2,
    `${twoStandard.contract?.assignments.length}`);
  check("and the basket charges for two",
    twoStandard.quantities[standardSofa.id] === 2,
    JSON.stringify(twoStandard.quantities));

  const oneSectional = resolveCategoryIntents({
    intents: [{ canonicalCategory: "sofa", productId: sectionalSofa.id }],
    sceneGraph: scene,
    catalogue,
    profiles: getProductProfiles([sectionalSofa]),
    sourceImage: SOURCE,
  });
  check("a sectional absorbing both sofas is placed once",
    oneSectional.contract?.assignments.length === 1,
    `${oneSectional.contract?.assignments.length}`);
  check("and the basket charges for one",
    oneSectional.quantities[sectionalSofa.id] === 1,
    JSON.stringify(oneSectional.quantities));
  check("the sofa it did not land on is still accounted for",
    (oneSectional.contract?.assignments.length ?? 0) +
      (oneSectional.contract?.protectedItems.filter(
        (item) => item.canonicalCategory === "sofa"
      ).length ?? 0) >= 1);

  // The advanced picker narrows to one named piece.
  const narrowed = resolveCategoryIntents({
    intents: [
      {
        canonicalCategory: "sofa",
        productId: standardSofa.id,
        sceneItemIds: ["sofa_b"],
      },
    ],
    sceneGraph: scene,
    catalogue,
    profiles: getProductProfiles([standardSofa]),
    sourceImage: SOURCE,
  });
  check("narrowing to one piece produces one task",
    narrowed.contract?.assignments.length === 1);
  check("and it is the piece that was named",
    narrowed.contract?.assignments[0].target.sceneItemId === "sofa_b");
  check("the other sofa becomes protected",
    (narrowed.contract?.protectedItems ?? []).some(
      (item) => item.sceneItemId === "sofa_a"
    ));

  // A category the room does not contain is reported, not silently ignored.
  const missing = resolveCategoryIntents({
    intents: [{ canonicalCategory: "artwork", productId: rug.id }],
    sceneGraph: scene,
    catalogue,
    profiles: getProductProfiles([rug]),
    sourceImage: SOURCE,
  });
  check("a type the room lacks is reported",
    missing.unmatchedCategories.includes("artwork"));
  check("and produces no contract rather than a wrong one",
    missing.contract === null);

  check("no intents means no contract",
    resolveCategoryIntents({
      intents: [],
      sceneGraph: scene,
      catalogue,
      profiles: [],
      sourceImage: SOURCE,
    }).contract === null);
  check("an unanalysed room yields no contract",
    resolveCategoryIntents({
      intents: [{ canonicalCategory: "rug", productId: rug.id }],
      sceneGraph: undefined,
      catalogue,
      profiles: getProductProfiles([rug]),
      sourceImage: SOURCE,
    }).contract === null);
}

// --- 6. A plan asking for more than the room holds ---------------------------
section("6. Extra pieces are placed, not dropped");
{
  const armchair = firstProductIn("chairs");
  // The room has no armchairs at all, and the customer asked for two.
  const resolved = resolveCategoryIntents({
    intents: [
      {
        canonicalCategory: "armchair",
        productId: armchair.id,
        seatingPlan: {
          presetId: "sofa-l",
          pieces: [{ kind: "armchair", count: 2 }],
        },
      },
    ],
    sceneGraph: sceneWithTwoSofas(),
    catalogue,
    profiles: getProductProfiles([armchair]),
    sourceImage: SOURCE,
  });

  check("both armchairs become real placements",
    resolved.contract?.additions?.length === 2,
    `${resolved.contract?.additions?.length}`);
  check("they are placements, not replacements",
    (resolved.contract?.additions ?? []).every((a) => a.action === "PLACE"));
  check("they carry unique task ids",
    new Set((resolved.contract?.additions ?? []).map((a) => a.taskId)).size ===
      (resolved.contract?.additions?.length ?? 0));
  check("the basket charges for two",
    resolved.quantities[armchair.id] === 2,
    JSON.stringify(resolved.quantities));
  check("the room's own furniture is still protected",
    (resolved.contract?.protectedItems ?? []).length > 0);
}

// --- 7. A photo is analysed once ---------------------------------------------
section("7. The same room is not analysed twice");
{
  clearSceneCache();
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const other = new Uint8Array([1, 2, 3, 4, 6]);

  const key = roomImageKey(bytes);
  check("the same bytes give the same key", key === roomImageKey(bytes));
  check("different bytes give a different key", key !== roomImageKey(other));
  check("a cold cache holds nothing", getCachedSceneGraph(key) === undefined);

  const scene = sceneWithTwoSofas();
  setCachedSceneGraph(key, scene);
  check("an analysis is remembered", getCachedSceneGraph(key) === scene);
  check("only for the photo it belongs to",
    getCachedSceneGraph(roomImageKey(other)) === undefined);

  // A failed analysis must NOT be cached: fifteen minutes of pretending the
  // room is empty is far worse than analysing again.
  clearSceneCache();
  setCachedSceneGraph(key, { ...scene, analysed: false } as SceneGraph);
  check("a failed analysis is never remembered",
    getCachedSceneGraph(key) === undefined);
  check("and leaves the cache empty", sceneCacheSize() === 0);

  // Bounded, so a long-lived instance cannot grow without limit.
  clearSceneCache();
  for (let index = 0; index < 40; index += 1) {
    setCachedSceneGraph(roomImageKey(new Uint8Array([index, index])), scene);
  }
  check("the cache stays bounded", sceneCacheSize() <= 12, `${sceneCacheSize()}`);

  // Both routes must actually use it, or none of the above matters.
  const generate = readFileSync(
    "src/app/api/studio/generate-gemini/route.ts",
    "utf8"
  );
  const detect = readFileSync(
    "src/app/api/studio/detect-objects/route.ts",
    "utf8"
  );
  check("generation checks the cache", /getCachedSceneGraph/.test(generate));
  check("detection checks the cache", /getCachedSceneGraph/.test(detect));
  check("generation stores what it analysed",
    /setCachedSceneGraph/.test(generate));
  check("detection stores what it analysed", /setCachedSceneGraph/.test(detect));
}

// --- 8. The flow state is one declared shape ---------------------------------
section("8. The flow has a shape, not a scatter of flags");
{
  const flow = emptyFlowState("living room");
  check("a fresh flow has no mode", flow.mode === null);
  check("it remembers the room type", flow.roomType === "living room");
  check("nothing is chosen", flow.selectedCategories.length === 0);
  check("no style is assumed", flow.surpriseStyle === null);
  check("no plans are assumed",
    Object.keys(flow.categoryPlans).length === 0);
  check("no products are assumed",
    Object.keys(flow.selectedProducts).length === 0);
  check("no analysis is assumed",
    Object.keys(flow.targetedDetections).length === 0);
  check("nothing is marked by hand", flow.manualSelections.length === 0);
}

// --- 9. The result page is untouched -----------------------------------------
section("9. This sprint did not touch the result");
{
  const studio = readFileSync(
    "src/components/studio/KoalaDesignStudio.tsx",
    "utf8"
  );
  check("the scroll owner is still the container, not the window",
    /scrollContainerRef/.test(studio) && !/window\.scrollTo\(/.test(
      studio.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    ));
  check("a new result still opens at the top", /resultEpoch/.test(studio));
  check("the product carousel is still in use",
    /CategoryProductShelves/.test(studio));
  check("units still travel with the result",
    /productQuantities/.test(studio));
}

console.log(`\nPassed: ${passed}   Failed: ${failures.length}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log("All instant-flow tests passed.");
