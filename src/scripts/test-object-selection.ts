/**
 * Deterministic tests for room object selection.
 *
 * Run with:  npm run test:object-selection
 *
 * These enforce the sprint's trust guarantee:
 *   NO SELECTION = NO PERMISSION TO CHANGE THAT OBJECT.
 *
 * No network, no API key, no paid calls — everything runs against the golden
 * living-room fixture and pure functions.
 */
import {
  assignSelectionCategory,
  createManualSelection,
  deserialiseSelections,
  displayCategoryName,
  isObjectSelected,
  isSelectableCategory,
  normaliseRect,
  projectBox,
  removeSelection,
  resetSelectionIds,
  serialiseSelections,
  toSelectableObjects,
  toggleObjectSelection,
  type RoomSelection,
} from "@/lib/intelligence/room-selection";
import { buildGoldenLivingRoomSceneGraph } from "@/lib/intelligence/fixtures/golden-living-room";
import { assignInstanceLabels, type SceneFurniture } from "@/lib/intelligence/scene-graph";
import { canonicaliseCategory, type CanonicalCategory } from "@/lib/intelligence/scene-taxonomy";

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

const SOURCE = { width: 1400, height: 1050 };
const scene = buildGoldenLivingRoomSceneGraph();
const selectable = toSelectableObjects(scene);

// --- 1. Fixed objects can never become replaceable selections --------------
section("1. Fixed objects cannot become selectable");
{
  const offered = new Set(selectable.map((o) => o.canonicalCategory));

  for (const fixed of [
    "tv",
    "window",
    "door",
    "curtains",
    "air-conditioner",
    "ceiling-fan",
    "built-in",
    "fireplace",
    "radiator",
  ] as CanonicalCategory[]) {
    check(`${fixed} is not selectable`, !isSelectableCategory(fixed));
    check(`${fixed} is never offered`, !offered.has(fixed));
  }

  check(
    "an unrecognised object is not offered",
    !isSelectableCategory("unknown") && !offered.has("unknown")
  );

  // The fixture contains a TV and curtains — neither may appear.
  check(
    "the fixture's television is not offered",
    !selectable.some((o) => o.sceneItemId === "tv-screen")
  );
  check(
    "the fixture's curtains are not offered",
    !selectable.some((o) => o.sceneItemId === "curtains-left")
  );

  // Even if a model wrongly flags a fixed object replaceable, the category
  // filter must still refuse it.
  const rogue = toSelectableObjects({
    ...scene,
    furniture: scene.furniture.map((item) =>
      item.id === "tv-screen" ? { ...item, replaceable: true } : item
    ),
  });
  check(
    "a mislabelled replaceable TV is still refused",
    !rogue.some((o) => o.sceneItemId === "tv-screen"),
    "category filter must be independent of the replaceable flag"
  );
}

// --- 2. TV vs TV unit stays separated --------------------------------------
section("2. TV and TV unit stay separated");
{
  check(
    "a TV unit IS selectable",
    isSelectableCategory("tv-unit") &&
      selectable.some((o) => o.canonicalCategory === "tv-unit")
  );
  check("a television is NOT selectable", !isSelectableCategory("tv"));

  const tvUnit = selectable.find((o) => o.canonicalCategory === "tv-unit");
  check("the TV unit is offered by its own id", tvUnit?.sceneItemId === "tv-unit-main");
  check(
    "the TV unit is displayed as a TV unit",
    tvUnit?.displayName === "TV unit",
    tvUnit?.displayName
  );

  for (const label of ["TV unit", "tv console", "entertainment unit", "media console"]) {
    check(
      `"${label}" canonicalises to a selectable tv-unit`,
      isSelectableCategory(canonicaliseCategory(label).canonical)
    );
  }
  for (const label of ["TV", "television", "flat screen tv"]) {
    check(
      `"${label}" canonicalises to a NON-selectable tv`,
      !isSelectableCategory(canonicaliseCategory(label).canonical)
    );
  }

  // Selecting the TV unit must never authorise the television.
  let selections: RoomSelection[] = [];
  selections = toggleObjectSelection(selections, tvUnit!, SOURCE);
  check(
    "selecting the TV unit does not select the television",
    !isObjectSelected(selections, "tv-screen")
  );
}

// --- 3. Multiple sofas remain distinct instances ---------------------------
section("3. Multiple sofas remain distinct instances");
{
  const sofas = selectable.filter((o) => o.canonicalCategory === "sofa");
  check("both sofas are offered", sofas.length === 2, `got ${sofas.length}`);
  check(
    "they have different scene ids",
    sofas[0].sceneItemId !== sofas[1].sceneItemId
  );
  check(
    "they get numbered display names",
    sofas.map((s) => s.displayName).sort().join(",") === "Sofa 1,Sofa 2",
    sofas.map((s) => s.displayName).join(", ")
  );
  check(
    "they keep distinct spatial instance labels",
    sofas[0].instanceLabel !== sofas[1].instanceLabel,
    sofas.map((s) => s.instanceLabel).join(" / ")
  );
  check(
    "each carries its own description",
    sofas.every((s) => s.originalObjectDescription.length > 0)
  );
  check(
    "a lone category is not numbered",
    selectable.find((o) => o.canonicalCategory === "rug")?.displayName === "Rug"
  );
}

// --- 4. Selecting one sofa does not select the second ----------------------
section("4. Selecting one sofa does not select the other");
{
  resetSelectionIds();
  const sofas = selectable.filter((o) => o.canonicalCategory === "sofa");
  let selections: RoomSelection[] = [];

  selections = toggleObjectSelection(selections, sofas[0], SOURCE);
  check("one sofa selected", selections.length === 1);
  check("the chosen sofa is authorised", isObjectSelected(selections, sofas[0].sceneItemId));
  check(
    "THE OTHER SOFA IS NOT AUTHORISED",
    !isObjectSelected(selections, sofas[1].sceneItemId),
    "selecting one sofa must never imply permission for another"
  );
  check(
    "the selection names the specific instance",
    selections[0].sceneItemId === sofas[0].sceneItemId
  );

  // Selecting the second adds it without disturbing the first.
  selections = toggleObjectSelection(selections, sofas[1], SOURCE);
  check("both can be selected independently", selections.length === 2);
  check(
    "each selection keeps its own scene id",
    new Set(selections.map((s) => s.sceneItemId)).size === 2
  );

  // Deselecting one leaves the other authorised.
  selections = toggleObjectSelection(selections, sofas[0], SOURCE);
  check("deselecting one removes only that one", selections.length === 1);
  check(
    "the remaining authorisation is the second sofa",
    selections[0].sceneItemId === sofas[1].sceneItemId
  );

  // Nothing is authorised by default.
  check("no selection means no permission", !isObjectSelected([], sofas[0].sceneItemId));
  check(
    "every offered object starts unauthorised",
    selectable.every((o) => !isObjectSelected([], o.sceneItemId))
  );
}

// --- 5. Coordinates survive resizing / state changes -----------------------
section("5. Selection coordinates survive resizing");
{
  resetSelectionIds();
  const sofa = selectable.find((o) => o.canonicalCategory === "sofa")!;
  const selections = toggleObjectSelection([], sofa, SOURCE);
  const box = selections[0].boundingBox;

  check(
    "stored coordinates are normalised 0-1",
    box.x >= 0 && box.y >= 0 && box.x <= 1 && box.y <= 1 &&
      box.width > 0 && box.width <= 1 && box.height > 0 && box.height <= 1
  );

  // The same normalised box projects proportionally at any display size.
  const small = projectBox(box, { width: 375, height: 300 });
  const large = projectBox(box, { width: 1200, height: 960 });
  check(
    "projection scales with display width",
    Math.abs(large.left / small.left - 1200 / 375) < 0.001,
    `${large.left} vs ${small.left}`
  );
  check(
    "projection scales with display height",
    Math.abs(large.height / small.height - 960 / 300) < 0.001
  );

  // A round trip through a display size returns the original box.
  for (const display of [
    { width: 375, height: 300 },
    { width: 390, height: 312 },
    { width: 1024, height: 819 },
  ]) {
    const projected = projectBox(box, display);
    const back = normaliseRect(projected, display);
    const same =
      Math.abs(back.x - box.x) < 1e-6 &&
      Math.abs(back.y - box.y) < 1e-6 &&
      Math.abs(back.width - box.width) < 1e-6 &&
      Math.abs(back.height - box.height) < 1e-6;
    check(`round-trips exactly at ${display.width}px`, same);
  }

  check(
    "the source image size is recorded with the selection",
    selections[0].sourceImage.width === SOURCE.width &&
      selections[0].sourceImage.height === SOURCE.height
  );

  // Drawing at one viewport and rendering at another must agree.
  const drawnSmall = normaliseRect(
    { left: 37.5, top: 30, width: 75, height: 60 },
    { width: 375, height: 300 }
  );
  const drawnLarge = normaliseRect(
    { left: 120, top: 96, width: 240, height: 192 },
    { width: 1200, height: 960 }
  );
  check(
    "the same region drawn at different sizes normalises identically",
    Math.abs(drawnSmall.x - drawnLarge.x) < 1e-6 &&
      Math.abs(drawnSmall.width - drawnLarge.width) < 1e-6,
    `${JSON.stringify(drawnSmall)} vs ${JSON.stringify(drawnLarge)}`
  );

  // Out-of-bounds drags are clamped into the image.
  const clamped = normaliseRect(
    { left: -50, top: -20, width: 900, height: 700 },
    { width: 375, height: 300 }
  );
  check(
    "a drag beyond the edge is clamped into the image",
    clamped.x === 0 && clamped.y === 0 &&
      clamped.x + clamped.width <= 1 && clamped.y + clamped.height <= 1
  );
}

// --- 6. Manual selections serialise / restore correctly --------------------
section("6. Manual selections serialise and restore");
{
  resetSelectionIds();
  const manual = assignSelectionCategory(
    createManualSelection({
      boundingBox: { x: 0.12, y: 0.34, width: 0.4, height: 0.25 },
      sourceImage: SOURCE,
    }),
    "coffee-table"
  );
  const sofa = selectable.find((o) => o.canonicalCategory === "sofa")!;
  const mixed = toggleObjectSelection([manual], sofa, SOURCE);

  const restored = deserialiseSelections(serialiseSelections(mixed));
  check("all selections survive a round trip", restored.length === mixed.length);
  check(
    "the manual selection keeps its exact coordinates",
    JSON.stringify(restored[0].boundingBox) === JSON.stringify(manual.boundingBox)
  );
  check(
    "the manual selection keeps its assigned type",
    restored[0].canonicalCategory === "coffee-table"
  );
  check("the manual selection keeps its method", restored[0].selectionMethod === "manual");
  check("the manual selection keeps its id", restored[0].selectionId === manual.selectionId);
  check(
    "the manual selection still has no confidence",
    !("confidence" in restored[0])
  );
  check(
    "the manual selection keeps its source dimensions",
    restored[0].sourceImage.width === SOURCE.width
  );
  check(
    "the smart selection keeps its scene link",
    restored[1].sceneItemId === sofa.sceneItemId
  );
  check(
    "a restored smart selection keeps its real confidence",
    typeof restored[1].confidence === "number"
  );

  // Corrupt input must be rejected, not trusted.
  check("malformed JSON restores to nothing", deserialiseSelections("{oops").length === 0);
  check("a non-array restores to nothing", deserialiseSelections('{"a":1}').length === 0);
  check(
    "entries missing a bounding box are dropped",
    deserialiseSelections(
      JSON.stringify([{ selectionId: "x", selectionMethod: "manual", canonicalCategory: "sofa" }])
    ).length === 0
  );
  check(
    "entries with an unknown method are dropped",
    deserialiseSelections(
      JSON.stringify([
        { selectionId: "x", selectionMethod: "telepathy", canonicalCategory: "sofa",
          boundingBox: { x: 0, y: 0, width: 1, height: 1 } },
      ])
    ).length === 0
  );

  check(
    "removing a selection removes exactly one",
    removeSelection(mixed, manual.selectionId).length === mixed.length - 1
  );
}

// --- Instance identity for same-category objects ---------------------------
section("Instance identity is preserved for same-category objects");
{
  const three: SceneFurniture[] = [0.1, 0.45, 0.8].map((x, i) => ({
    ...scene.furniture.find((f) => f.canonicalCategory === "sofa")!,
    id: `sofa-${i}`,
    boundingBox: { x, y: 0.5, width: 0.12, height: 0.12 },
  }));
  const labelled = assignInstanceLabels(three);
  const objects = toSelectableObjects({ ...scene, furniture: labelled });

  check("three sofas yield three selectable objects", objects.length === 3);
  check(
    "each is numbered distinctly",
    new Set(objects.map((o) => o.displayName)).size === 3,
    objects.map((o) => o.displayName).join(", ")
  );
  check(
    "each keeps a distinct scene id",
    new Set(objects.map((o) => o.sceneItemId)).size === 3
  );

  // Selecting the middle one authorises only the middle one.
  const selections = toggleObjectSelection([], objects[1], SOURCE);
  check(
    "selecting the middle sofa authorises only it",
    isObjectSelected(selections, objects[1].sceneItemId) &&
      !isObjectSelected(selections, objects[0].sceneItemId) &&
      !isObjectSelected(selections, objects[2].sceneItemId)
  );
}

section("Display naming");
{
  check("tv-unit reads as TV unit", displayCategoryName("tv-unit") === "TV unit");
  check("coffee-table reads as Coffee table", displayCategoryName("coffee-table") === "Coffee table");
  check("sofa reads as Sofa", displayCategoryName("sofa") === "Sofa");
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log("All object-selection tests passed.");
