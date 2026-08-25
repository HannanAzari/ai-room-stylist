/**
 * Add-or-replace: a chosen piece the room does not contain is PLACED, not
 * refused.
 *
 * Run with:  npm run test:add-or-replace
 *
 * The resolver and the readiness gate are pure, so they are exercised directly
 * against real scene graphs. The route and client wiring is asserted from
 * source — "does an absent mirror still return 422" is a wiring fact.
 *
 * No paid calls.
 */
import { readFileSync } from "node:fs";
import { assessSceneReadiness } from "@/lib/intelligence/scene-readiness";
import {
  defaultPlacementFor,
  resolveCategoryIntents,
  type CategoryIntent,
} from "@/lib/intelligence/category-intent";
import { getProductProfiles } from "@/lib/intelligence/product-profile";
import { getAllProducts, getProductsByIdsInSelectionOrder } from "@/lib/products";
import type { SceneGraph } from "@/lib/intelligence/scene-graph";

const ROUTE = readFileSync("src/app/api/studio/generate-gemini/route.ts", "utf8");
const UI = readFileSync("src/components/studio/KoalaDesignStudio.tsx", "utf8");
const catalogue = getAllProducts();

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

const sourceImage = { width: 2048, height: 1536 };
const box = (x: number) => ({ x, y: 0.6, width: 0.2, height: 0.2 });

/**
 * `toSelectableObjects` requires `replaceable` and a bounding box — a fixture
 * without them looks like an empty room and every assertion below would pass or
 * fail for the wrong reason.
 */
const item = (id: string, canonicalCategory: string, label: string, x: number) => ({
  id,
  canonicalCategory,
  instanceLabel: label,
  boundingBox: box(x),
  confidence: 0.9,
  replaceable: true,
  category: canonicalCategory,
  dominantColor: "neutral",
  material: "mixed",
});

/** A readable living room containing a sofa, a coffee table and a TV unit. */
const readableRoom = {
  analysed: true,
  roomType: "living room",
  architecture: {},
  furniture: [
    item("sofa_1", "sofa", "the left sofa", 0.05),
    item("table_1", "coffee-table", "the coffee table", 0.4),
    item("tv_1", "tv-unit", "the TV unit", 0.6),
  ],
} as unknown as SceneGraph;

/** Analysis failed or returned nothing — a genuinely unusable photograph. */
const unreadableRoom = { analysed: false, roomType: "", architecture: {}, furniture: [] } as unknown as SceneGraph;
const emptyRoom = { analysed: true, roomType: "living room", architecture: {}, furniture: [] } as unknown as SceneGraph;

console.log("\nReadiness — the photo, not the shopping list");
{
  const present = assessSceneReadiness({
    sceneGraph: readableRoom,
    requestedCategories: ["coffee-table", "tv-unit"],
  });
  check("a readable room with everything present is ready", present.ready);
  check("nothing is reported absent when everything is found",
    present.absentCategories.length === 0);

  const absent = assessSceneReadiness({
    sceneGraph: readableRoom,
    requestedCategories: ["coffee-table", "mirror", "floor-lamp", "artwork"],
  });
  check("A READABLE ROOM MISSING A MIRROR IS STILL READY", absent.ready,
    absent.reason ?? "");
  check("the absent pieces are reported rather than blocking",
    absent.absentCategories.join(",") === "mirror,floor-lamp,artwork",
    absent.absentCategories.join(","));
  check("a found category is not reported absent",
    !absent.absentCategories.includes("coffee-table"));
  check("no blocking reason is produced for a usable photo", !absent.reason);

  const unreadable = assessSceneReadiness({
    sceneGraph: unreadableRoom,
    requestedCategories: ["coffee-table"],
  });
  check("AN UNREADABLE PHOTO IS STILL REFUSED", !unreadable.ready);
  check("the refusal explains what to do", /wider, brighter shot/.test(unreadable.reason ?? ""));
  check("an unreadable photo reports nothing as merely absent",
    unreadable.absentCategories.length === 0);

  const empty = assessSceneReadiness({ sceneGraph: emptyRoom, requestedCategories: ["sofa"] });
  check("a room with no furniture found at all is refused", !empty.ready,
    "an empty graph means analysis failed, not that the room is empty");
}

console.log("\nPlacement phrasing");
{
  check("every placement is relational, not a coordinate",
    ["mirror", "artwork", "floor-lamp", "rug", "plant"].every((category) => {
      const text = defaultPlacementFor(category as never);
      return text.length > 10 && !/\d/.test(text);
    }));
  check("a mirror is placed on a wall", /wall/.test(defaultPlacementFor("mirror")));
  check("a floor lamp is placed on the floor", /floor/.test(defaultPlacementFor("floor-lamp")));
  check("an unknown category still gets a usable placement",
    defaultPlacementFor("unknown" as never).length > 10);
  check("placements avoid crowding the existing room",
    /without crowding/.test(defaultPlacementFor("unknown" as never)));
}

console.log("\nResolution — replace what exists, add what does not");
{
  const rug = catalogue.find((p) => p.category === "rugs")!;
  const tvUnit = catalogue.find((p) => p.category === "tv-units")!;
  const decor = catalogue.find((p) => p.category === "decor")!;

  const intents: CategoryIntent[] = [
    { canonicalCategory: "tv-unit", productId: tvUnit.id },
    { canonicalCategory: "mirror", productId: decor.id },
    { canonicalCategory: "rug", productId: rug.id },
  ] as unknown as CategoryIntent[];

  const resolved = resolveCategoryIntents({
    intents,
    sceneGraph: readableRoom,
    catalogue,
    profiles: getProductProfiles(
      getProductsByIdsInSelectionOrder([tvUnit.id, decor.id, rug.id])
    ),
    sourceImage,
  });

  check("a contract is produced rather than nothing", resolved.contract !== null);
  const contract = resolved.contract!;

  const replacedCategories = contract.assignments.map((a) => a.canonicalCategory);
  const addedCategories = (contract.additions ?? []).map((a) => a.canonicalCategory);

  check("the TV unit, which the room HAS, becomes a replacement",
    replacedCategories.includes("tv-unit"), replacedCategories.join(","));
  check("the mirror, which the room LACKS, becomes an addition",
    addedCategories.includes("mirror"), addedCategories.join(","));
  check("the rug, which the room LACKS, becomes an addition",
    addedCategories.includes("rug"), addedCategories.join(","));
  check("nothing is silently dropped",
    replacedCategories.length + addedCategories.length === 3,
    `${replacedCategories.length} replaced + ${addedCategories.length} added`);

  check("every addition carries a placement", (contract.additions ?? []).every((a) => a.placement.length > 0));
  check("every addition names the real product",
    (contract.additions ?? []).every((a) => a.productTitle.length > 0 && a.productId.length > 0));
  check("additions use the PLACE action", (contract.additions ?? []).every((a) => a.action === "PLACE"));

  const ids = [
    ...contract.assignments.map((a) => a.taskId),
    ...(contract.additions ?? []).map((a) => a.taskId),
  ];
  check("task ids stay unique across replacements and additions",
    new Set(ids).size === ids.length, ids.join(","));

  check("added products still count towards the basket",
    resolved.quantities[decor.id] === 1 && resolved.quantities[rug.id] === 1,
    JSON.stringify(resolved.quantities));
  check("the absent categories are still reported to the caller",
    resolved.unmatchedCategories.includes("mirror") && resolved.unmatchedCategories.includes("rug"));

  // Everything present → a pure-replace contract, which is what the localized
  // and few-shot paths require.
  const pureReplace = resolveCategoryIntents({
    intents: [{ canonicalCategory: "tv-unit", productId: tvUnit.id }] as unknown as CategoryIntent[],
    sceneGraph: readableRoom,
    catalogue,
    profiles: getProductProfiles(getProductsByIdsInSelectionOrder([tvUnit.id])),
    sourceImage,
  });
  check("a room containing everything still produces a pure-replace contract",
    (pureReplace.contract?.additions?.length ?? 0) === 0 &&
      (pureReplace.contract?.assignments.length ?? 0) === 1);
}

console.log("\nRoute — a warning, not a dead end");
{
  check("an unreadable photo still returns 422",
    /sceneUnreadable: true,[\s\S]{0,120}status: 422/.test(ROUTE));
  check("absent categories no longer reach that refusal",
    /if \(readiness\.absentCategories\.length > 0\) \{/.test(ROUTE));
  check("the notice names the pieces that will be added",
    /We could not clearly find these items in your photo/.test(ROUTE));
  check("the notice says they will be added instead",
    /We'll try to add them to the room instead/.test(ROUTE));
  check("the notice rides on a SUCCESSFUL response, not an error",
    /\.\.\.\(absentNotice\(\) \? \{ notice: absentNotice\(\)/.test(ROUTE));
  check("all three render paths can carry the notice",
    (ROUTE.match(/absentNotice\(\) \?/g) ?? []).length === 3,
    `${(ROUTE.match(/absentNotice\(\) \?/g) ?? []).length} paths`);
  check("the absent list is logged, not warned as a failure",
    /console\.log\("\[studio-gemini\] adding pieces the room does not contain"/.test(ROUTE));
}

console.log("\nRouting — pure replace keeps the benchmark paths");
{
  const LOCALIZED = readFileSync("src/features/room-stylist/services/localized-room-edit.ts", "utf8");
  const FEWSHOT = readFileSync("src/features/room-stylist/services/few-shot-room-edit.ts", "utf8");
  check("the localized path still declines contracts containing additions",
    /contract contains additions or removals/.test(LOCALIZED));
  check("the few-shot path still declines contracts containing additions",
    /contract contains additions or removals/.test(FEWSHOT));
  check("so a mixed add/replace request falls back to the grounding path, which models additions",
    /plan\.additions/.test(readFileSync("src/lib/intelligence/prompt-builder.ts", "utf8")));
}

console.log("\nClient — soft notice, not a red error");
{
  check("the notice has its own state, separate from error", /const \[notice, setNotice\] = useState\(""\)/.test(UI));
  check("it is read from a successful response", /setNotice\(typeof data\.notice === "string"/.test(UI));
  check("it is cleared when a new generation starts",
    /setError\(""\);\s*\n\s*setNotice\(""\);/.test(UI));
  check("it does not use the red error styling",
    /\{notice && !error && \([\s\S]{0,200}border-\[#C9A57A\]\/30/.test(UI));
  check("a real error still wins over a notice", /\{notice && !error && \(/.test(UI));
  check("the red error block is still there for genuine failures",
    /border-red-400\/30/.test(UI));
}

console.log("\nRegression — the customer note actually reaches the model");
{
  /**
   * This was reported as shipped and was not: the commit added the import but
   * the argument never landed, because the patch targeted a call shape that had
   * already been refactored. A dead feature that lints clean is exactly what a
   * wiring assertion is for.
   */
  check("the few-shot call passes the customer note",
    /customerNote: normaliseCustomerNote\(formData\.get\("customerNote"\)\)/.test(ROUTE));
  check("the note is still normalised rather than passed raw",
    /import \{ normaliseCustomerNote \}/.test(ROUTE));
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failures.length}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All add-or-replace tests passed.");
