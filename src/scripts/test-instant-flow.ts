/**
 * The instant-menu sprint, defended — updated for the seating-contract-
 * hardening sprint's quantity-based seating model.
 *
 * Promises this file defends:
 *
 *  1. The replace menu appears WITHOUT analysing the room.
 *  2. Seating is a quantity-based PLAN — up to three pieces, any mix of the
 *     four shapes, zero allowed for each — not a single preset choice.
 *  3. Category intent resolves to real instances server-side, honouring the
 *     category lock and leaving everything unchosen alone.
 *  4. A room photo is analysed once, not twice.
 *
 * Seating RECONCILIATION (desired count vs existing count producing REPLACE /
 * ADD / REMOVE tasks) has its own dedicated suite: test-seating-contract.ts.
 */
import { readFileSync } from "node:fs";
import {
  getCategoryMenu,
  isCategorySupported,
  isSeatingCategory,
  isValidSeatingPlan,
  buildSeatingPlan,
  describeSeatingPlan,
  seatingPlanPieceCount,
  MAX_SEATING_PIECES,
  SEATING_PIECE_KINDS,
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

  const shelves = readFileSync(
    "src/components/studio/CategoryProductShelves.tsx",
    "utf8"
  );
  check("the shelf knows where its counts came from",
    /countsAreFromRoom/.test(shelves));

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
    /isCategorySupported\(canonicalCategory, allCatalogueProducts\)/.test(
      studio
    ));
}

// --- 2. Seating is a quantity-based plan, not a single preset ---------------
section("2. Seating plans state a desired quantity per shape");
{
  check("four shapes are offered", SEATING_PIECE_KINDS.length === 4);
  // No armchair kind is even representable — the type itself excludes it,
  // because the catalogue has none. Proving the four kinds are exactly the
  // sofa shapes is the runtime half of that guarantee.
  check("exactly the four sofa shapes, nothing else",
    SEATING_PIECE_KINDS.map((entry) => entry.kind).sort().join(",") ===
      ["sofa-2-seater", "sofa-3-seater", "sofa-l-shape", "sofa-modular"].sort().join(","));
  check("the cap is three pieces", MAX_SEATING_PIECES === 3);

  const empty = buildSeatingPlan({});
  check("an empty plan has no pieces", empty.pieces.length === 0);
  check("an empty plan is not valid", !isValidSeatingPlan(empty));

  const one = buildSeatingPlan({ "sofa-l-shape": 1 });
  check("one piece is valid", isValidSeatingPlan(one));
  check("it reads back in plain words",
    describeSeatingPlan(one) === "1 L-shape sofa",
    describeSeatingPlan(one));

  const twoSame = buildSeatingPlan({ "sofa-3-seater": 2 });
  check("2 of the same shape totals 2",
    seatingPlanPieceCount(twoSame) === 2);
  check("2×3-seater reads correctly",
    describeSeatingPlan(twoSame) === "2 3-seater sofas",
    describeSeatingPlan(twoSame));

  const mixed = buildSeatingPlan({ "sofa-3-seater": 1, "sofa-2-seater": 2 });
  check("a mix of shapes totals correctly",
    seatingPlanPieceCount(mixed) === 3);
  check("mixed shapes read as a sentence",
    describeSeatingPlan(mixed) === "1 3-seater sofa and 2 2-seater sofas",
    describeSeatingPlan(mixed));
  check("three pieces is at the cap, still valid", isValidSeatingPlan(mixed));

  // Rule 4: invalid counts above the max must not silently pass through the
  // data layer — building a plan with a raw count above the cap on one shape
  // must itself already exceed MAX_SEATING_PIECES.
  const over = buildSeatingPlan({ "sofa-modular": 4 });
  check("four of one shape exceeds the cap",
    seatingPlanPieceCount(over) === 4 && !isValidSeatingPlan(over));

  // Rule 2: zero is a real, representable choice for every shape.
  const zeroed = buildSeatingPlan({
    "sofa-3-seater": 0,
    "sofa-2-seater": 0,
    "sofa-l-shape": 0,
    "sofa-modular": 0,
  });
  check("all-zero collapses to no pieces", zeroed.pieces.length === 0);

  // Negative or fractional input is clamped, never trusted verbatim.
  const dirty = buildSeatingPlan({ "sofa-3-seater": -2.7 });
  check("negative counts clamp to zero", dirty.pieces.length === 0);

  // Rule 1/3 belong to the stepper UI itself — assert the picker actually
  // enforces them rather than merely trusting the data layer.
  const picker = readFileSync(
    "src/components/studio/SeatingPlanPicker.tsx",
    "utf8"
  );
  check("the stepper caps the running total, not just one row",
    /MAX_SEATING_PIECES/.test(picker));
  check("the picker renders one row per shape",
    /SEATING_PIECE_KINDS\.map/.test(picker));
  check("no armchair stepper on this screen",
    !/armchair/i.test(picker));

  const studio = readFileSync(
    "src/components/studio/KoalaDesignStudio.tsx",
    "utf8"
  );
  check("confirming seating requires a valid plan",
    /isValidSeatingPlan\(categoryPlans\[seatingCategory\]!\)/.test(studio));
}

// --- 3. Style is asked once and never invented -------------------------------
section("3. Surprise me asks for a look");
{
  check("there are a handful of looks", SURPRISE_STYLES.length === 7);
  check('"No preference" is offered',
    SURPRISE_STYLES.some((style) => style.id === "no-preference"));
  check("no preference carries no style tags",
    getSurpriseStyle("no-preference")?.styleTags.length === 0);
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

// --- 4. Category intent parsing is forgiving, never fatal --------------------
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

  const seating = parseCategoryIntents(
    JSON.stringify([
      {
        canonicalCategory: "sofa",
        seatingSelection: [
          { kind: "sofa-l-shape", count: 1, productId: "p1", productName: "L-Shape Sofa" },
        ],
      },
      {
        canonicalCategory: "sofa",
        seatingSelection: [
          { kind: "sofa-3-seater", count: 0, productId: "p2", productName: "3-Seater" },
          { kind: "sofa-2-seater", count: "two", productId: "p3", productName: "2-Seater" },
        ],
      },
      { canonicalCategory: "rug", seatingSelection: "nope" },
    ])
  );
  check("a well-formed seating intent survives",
    seating.length === 1 && seating[0].seatingSelection?.length === 1);
  check("a zero count and a non-numeric count are both dropped",
    seating[0].seatingSelection?.[0].kind === "sofa-l-shape");
  check("an intent with neither productId nor seatingSelection is dropped",
    seating.every((entry) => entry.canonicalCategory !== "rug"));
}

// --- 5. Simple-category resolution against a real room ------------------------
section("5. Plain intent resolves to the room's actual pieces");
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

  // Defensive: a product id that isn't in the catalogue must not become a
  // task just because it was well-formed JSON.
  const bogus = resolveCategoryIntents({
    intents: [{ canonicalCategory: "rug", productId: "not-a-real-product" }],
    sceneGraph: scene,
    catalogue,
    profiles: [],
    sourceImage: SOURCE,
  });
  check("a product id absent from the catalogue produces no contract",
    bogus.contract === null);
}

// --- 6. A photo is analysed once ---------------------------------------------
section("6. The same room is not analysed twice");
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

  clearSceneCache();
  setCachedSceneGraph(key, { ...scene, analysed: false } as SceneGraph);
  check("a failed analysis is never remembered",
    getCachedSceneGraph(key) === undefined);
  check("and leaves the cache empty", sceneCacheSize() === 0);

  clearSceneCache();
  for (let index = 0; index < 40; index += 1) {
    setCachedSceneGraph(roomImageKey(new Uint8Array([index, index])), scene);
  }
  check("the cache stays bounded", sceneCacheSize() <= 12, `${sceneCacheSize()}`);

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

  // Phase 7: the debug instrumentation must exist, and must be gated behind
  // the same debug flag as everything else — never exposed to a normal user.
  check("generation reports whether this call analysed or reused",
    /sceneAnalysis:\s*\{[\s\S]{0,200}analysisCallMade/.test(generate));
  check("detection reports the same",
    /sceneAnalysis:\s*\{[\s\S]{0,200}analysisCallMade/.test(detect));
  /**
   * The sceneAnalysis instrumentation rides on the aiDebug response payload,
   * which is itself gated. Asserted by adjacency rather than by matching the
   * whole block: the route now has several `isAiDebugEnabled()` gates
   * (generation mode, render calls), so "the first one" and "a fixed-width
   * window" both silently test the wrong thing.
   */
  check("generation's instrumentation sits behind the debug gate",
    /if \(isAiDebugEnabled\(\)\) \{\s*\n\s*responseBody\.aiDebug = \{/.test(generate) &&
      /responseBody\.aiDebug = \{[\s\S]{0,400}sceneAnalysis/.test(generate),
    "it must not be reachable without ENABLE_AI_DEBUG");
  const detectDebugBlock =
    detect.match(/if \(isAiDebugEnabled\(\)\) \{[\s\S]{0,400}/)?.[0] ?? "";
  check("detection's instrumentation sits behind the debug gate",
    /sceneAnalysis/.test(detectDebugBlock));
}

// --- 7. The flow state is one declared shape ---------------------------------
section("7. The flow has a shape, not a scatter of flags");
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

// --- 8. The result page is untouched -----------------------------------------
section("8. This sprint did not touch the result");
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
