/**
 * The pre-generation selection flow: room type, selected-products summary and
 * the confirmation gate before a paid render.
 *
 * Run with:  npm run test:selection-flow
 *
 * The room-type menu logic is pure and asserted against the real catalogue.
 * The screen wiring is asserted from the component source — the bugs worth
 * catching here are "Generate still fires straight from a tap" and "a room type
 * offers a category with an empty shelf behind it", both of which are wiring
 * facts rather than anything a pure function would show.
 */
import { readFileSync } from "node:fs";
import {
  FULLY_SUPPORTED_ROOM_TYPE,
  getCategoryMenu,
  getSupportedCategoryMenu,
  isCategorySupported,
  SELECTABLE_ROOM_TYPES,
} from "@/lib/intelligence/room-categories";
import { getAllProducts } from "@/lib/products";

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

console.log("\nRoom types");
{
  const labels = SELECTABLE_ROOM_TYPES.map((entry) => entry.label);
  check("all four room types are offered",
    ["Living room", "Dining room", "Bedroom", "Home office"].every((label) => labels.includes(label)),
    labels.join(", "));
  check("living room is the default and the fully supported one",
    FULLY_SUPPORTED_ROOM_TYPE === "living room");
  check("every offered room type has a menu behind it",
    SELECTABLE_ROOM_TYPES.every((entry) => getCategoryMenu(entry.value).length > 0));

  /**
   * The living room menu is deliberately NOT filtered: its unavailable entries
   * already render as "coming soon", and that screen is the one every existing
   * test and demo path exercises.
   */
  check("the living room keeps its complete menu",
    getSupportedCategoryMenu("living room", catalogue).length ===
      getCategoryMenu("living room").length);
  check("the living room menu really does contain unsupported entries",
    getCategoryMenu("living room").some((entry) => !isCategorySupported(entry.canonicalCategory, catalogue)),
    "otherwise the filtering test below proves nothing");

  for (const entry of SELECTABLE_ROOM_TYPES.filter((e) => e.value !== FULLY_SUPPORTED_ROOM_TYPE)) {
    const menu = getSupportedCategoryMenu(entry.value, catalogue);
    check(`${entry.label}: every offered category can actually be filled`,
      menu.every((item) => isCategorySupported(item.canonicalCategory, catalogue)),
      menu.map((m) => m.label).join(", "));
    check(`${entry.label}: filtering removed something rather than being a no-op`,
      menu.length < getCategoryMenu(entry.value).length,
      `${menu.length} of ${getCategoryMenu(entry.value).length}`);
  }

  const office = getSupportedCategoryMenu("home office", catalogue);
  check("home office hides desks and bookshelves, which Koala does not stock",
    !office.some((entry) => ["desk", "bookshelf"].includes(entry.canonicalCategory)),
    office.map((m) => m.label).join(", "));
  /**
   * Every catalogue "chair" is a dining chair. Offering one as a desk chair
   * would be the same category error CATEGORY_LOCK already refuses for
   * armchairs, so the home office menu must not carry it at all.
   */
  check("home office does not offer a dining chair as a desk chair",
    !office.some((entry) => entry.canonicalCategory === "chair"),
    office.map((m) => m.label).join(", "));
  check("home office still offers something", office.length > 0, office.map((m) => m.label).join(", "));
  console.log(`      home office offers: ${office.map((m) => m.label).join(", ")}`);

  check("an unknown room type still falls back to a usable menu",
    getCategoryMenu("submarine").length > 0);
}

console.log("\nRoom-type step");
{
  check("a room-type selector component exists", /function RoomTypeSelector\(/.test(UI));
  check("step 2 asks the room before it asks what to do",
    UI.indexOf('if (step === 2 && !roomTypeConfirmed)') > -1 &&
      UI.indexOf('if (step === 2 && !roomTypeConfirmed)') < UI.indexOf('What would you like to do?'));
  check("the choice is held in flow state", /const \[roomTypeConfirmed, setRoomTypeConfirmed\]/.test(UI));
  check("the selector writes straight to the existing roomType state",
    /onChange=\{setRoomType\}/.test(UI));
  check("a Continue button advances past the room question",
    /onClick=\{\(\) => setRoomTypeConfirmed\(true\)\}/.test(UI));
  check("Back returns to the room question instead of the photo screen",
    /if \(step === 2 && roomTypeConfirmed\) \{[\s\S]{0,240}setRoomTypeConfirmed\(false\);/.test(UI));
  check("each room type states what is behind it rather than implying a full range",
    /Full Koala range/.test(UI) && /Coming soon/.test(UI));
  check("the replace menu is filtered by catalogue coverage",
    /getSupportedCategoryMenu\(roomType, allCatalogueProducts\)/.test(UI));
  check("resetting the wizard clears the room-type step",
    /setRoomTypeConfirmed\(false\);/.test(UI));
}

console.log("\nSelected-products review");
{
  /**
   * The standalone "Selected (n)" footer button was removed: two CTAs plus Back
   * crowded a 375px footer. The confirmation sheet is now the ONE review step,
   * so everything it used to offer must still be there.
   */
  check("no standalone Selected button remains in the footer",
    !/Selected \(\{shelfChosenProductIds\.length\}\)/.test(UI));
  check("the footer is a clean two-button layout",
    /grid-cols-\[auto_1fr\]/.test(UI));
  check("the sheet still lists the chosen products",
    /products=\{shelfChosenProducts\}/.test(UI));
  check("the sheet shows each product's category",
    /product\.category\.replace\(\/-\/g, " "\)/.test(UI));
  check("products can still be removed from the sheet",
    /onRemove=\{removeShelfProduct\}/.test(UI) &&
      /function removeShelfProduct\(productId: string\)/.test(UI));
  check("the sheet still states the room type", /roomTypeLabel=\{roomType\}/.test(UI));
  check("the sheet can still be dismissed", /aria-label="Close selected products"/.test(UI));

  /**
   * With the review mode gone, the sheet has exactly one purpose. Leaving a
   * `mode` prop nothing sets would be dead code.
   */
  check("the unreachable review mode was removed, not left behind",
    !/selectedSheetMode/.test(UI) && !/"review" \| "confirm"/.test(UI));
}

console.log("\nConfirmation before generate");
{
  /**
   * The regression that matters: Generate used to call handleGenerate directly.
   * It must now only open the sheet, and generation must happen from the
   * sheet's own Confirm.
   */
  const generateButton = UI.slice(
    UI.indexOf('replacePhase === "products" && ('),
    UI.indexOf('replacePhase === "products" && (') + 2000
  );
  check("the Generate button no longer starts generation directly",
    !/onClick=\{\(\) => void handleGenerate\(\)\}/.test(generateButton), "still calls handleGenerate on tap");
  check("the Generate button opens the confirmation sheet",
    /setSelectedSheetOpen\(true\);/.test(generateButton));
  check("generation happens from the sheet's Confirm",
    /onConfirm=\{\(\) => \{[\s\S]{0,160}void handleGenerate\(\);/.test(UI));
  check("the sheet offers an explicit Confirm action", /Confirm and generate/.test(UI));
  check("the sheet offers a Cancel that just closes it",
    /<StudioButton variant="ghost" onClick=\{onClose\} className="rounded-2xl">\s*\n\s*Cancel/.test(UI));
  check("there is exactly one Cancel, not two competing ones",
    (UI.match(/>\s*\n?\s*Cancel\s*\n?\s*<\/StudioButton>/g) ?? []).length === 1);

  /**
   * An incomplete selection must not reach the confirmation sheet at all — the
   * CTA stays disabled and keeps naming what is missing.
   */
  check("an incomplete selection cannot open the confirmation",
    /disabled=\{!canGenerateConcept\(\) \|\| loading\}/.test(generateButton));
  check("the CTA still names how many pieces are missing",
    /Choose \$\{unfilledShelfCount\} more/.test(generateButton));
  check("unfilled shelves genuinely block generation",
    /if \(unfilledShelfCount > 0\) return false;/.test(UI));
  check("confirming is blocked while a render is already running",
    /confirmDisabled=\{loading \|\| refining\}/.test(UI));
  check("confirming is blocked with an empty selection",
    /confirmDisabled \|\| products\.length === 0/.test(UI));
  check("one sheet serves both modes, so the two lists cannot drift",
    (UI.match(/<SelectedProductsSheet/g) ?? []).length === 1);
}

console.log("\nExisting behaviour preserved");
{
  check("the room type still reaches the API", /formData\.append\("roomType", roomType\)/.test(UI));
  check("the generation handler itself is unchanged in shape",
    /async function handleGenerate\(/.test(UI));
  check("the customer note box is still on the products step", /id="customer-note"/.test(UI));
  check("the elapsed timer wiring is untouched", /beginTimedRequest\(\)/.test(UI));
  check("surprise-me still has its own generate path",
    /designMode === "surprise-me"/.test(UI));
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failures.length}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All selection-flow tests passed.");
