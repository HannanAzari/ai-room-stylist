/**
 * Result-page actions: Add to cart and Swap.
 *
 * Run with:  npm run test:result-actions
 *
 * The cart seam is pure and tested directly. The card wiring is asserted from
 * source, because the failures that matter here are "the swap changed the card
 * without re-rendering the room" and "the old product stayed in the shop list"
 * — both wiring facts.
 *
 * No paid calls.
 */
import { readFileSync } from "node:fs";
import {
  addToCart,
  alternativesFor,
  isInCart,
  removeFromCart,
} from "@/features/room-stylist/services/cart";
import { getAllProducts } from "@/lib/products";
import type { Product } from "@/lib/products";

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

const sofa = catalogue.find((p) => p.category === "sofas")!;
const otherSofa = catalogue.filter((p) => p.category === "sofas")[1]!;
const table = catalogue.find((p) => p.category === "coffee-tables")!;
const noUrl = { ...sofa, id: "no-url", url: "" } as Product;

console.log("\nCart seam");
{
  const added = addToCart(sofa, []);
  check("adding puts the product in the cart", added.result.inCart);
  check("adding returns the ids to store", added.ids.includes(sofa.id));
  check("a product page is offered as the handoff today",
    added.result.handoffUrl === sofa.url);

  check("adding twice does not duplicate",
    addToCart(sofa, [sofa.id]).ids.filter((id) => id === sofa.id).length === 1);

  const removed = removeFromCart(sofa, [sofa.id, table.id]);
  check("removing takes only that product out",
    !removed.ids.includes(sofa.id) && removed.ids.includes(table.id));
  check("removing reports the product as out of the cart", !removed.result.inCart);

  check("membership is readable", isInCart(sofa, [sofa.id]) && !isInCart(table, [sofa.id]));

  /**
   * A missing product URL is a catalogue gap, not a reason to refuse the
   * customer's intent — the item still goes in the cart.
   */
  check("a product with no page still goes in the cart",
    addToCart(noUrl, []).result.inCart && addToCart(noUrl, []).result.handoffUrl === null);

  check("the cart never mutates the array it is given",
    (() => {
      const original = [table.id];
      addToCart(sofa, original);
      return original.length === 1;
    })());
}

console.log("\nSwap alternatives");
{
  const alternatives = alternativesFor(sofa, catalogue);
  check("alternatives come from the same category",
    alternatives.every((p) => p.category === sofa.category), sofa.category);
  check("the product being swapped is excluded",
    !alternatives.some((p) => p.id === sofa.id));
  check("there are real alternatives for a sofa", alternatives.length > 0,
    `${alternatives.length}`);
  check("a specific other sofa is offered as an alternative",
    alternatives.some((p) => p.id === otherSofa.id), otherSofa.id);
  check("a different category yields a different set",
    alternativesFor(table, catalogue).every((p) => p.category === "coffee-tables"));
  check("a category with only one product yields an empty list, not a crash",
    alternativesFor(sofa, [sofa]).length === 0);
}

console.log("\nCard actions");
{
  check("the actions live in one reusable component", /function ProductActions\(/.test(UI));
  check("the card shows Add to cart", /\{inCart \? "In cart" : "Add to cart"\}/.test(UI));
  check("the card shows Swap", /\{swapping \? "Swapping\.\.\." : "Swap"\}/.test(UI));
  check("the old View on Koala CTA is gone", !/View on Koala/.test(UI));
  check("the old Available in store CTA is gone", !/Available in store/.test(UI));
  check("the product page survives as a de-emphasised link",
    /View product details/.test(UI));
  check("result cards pass the shared actions component",
    /<ProductActions\s*\n\s*product=\{product\}/.test(UI));
  check("cart state drives the button, not local guesswork",
    /inCart=\{isInCart\(product, cartProductIds\)\}/.test(UI));
  check("swap is disabled while any render is running",
    /swapDisabled=\{refining \|\| loading\}/.test(UI));
  check("the swapping card shows progress",
    /swapping=\{swappingProductId === product\.id\}/.test(UI));
}

console.log("\nSwap flow");
{
  check("a picker sheet exists", /function SwapProductSheet\(/.test(UI));
  check("the picker is opened from the card", /onSwap=\{setSwapTarget\}/.test(UI));
  check("the picker offers same-category alternatives",
    /alternatives=\{alternativesFor\(swapTarget, allCatalogueProducts\)\}/.test(UI));
  check("the picker warns that choosing re-renders the room",
    /Choosing a replacement re-renders your room/.test(UI));
  check("an empty category is handled honestly",
    /No other \{product\.category\.replace/.test(UI));

  /**
   * The point of the whole flow: a swap must actually regenerate. Changing the
   * card while the image still shows the old sofa is a lie the customer can see.
   */
  check("choosing a replacement runs a real generation",
    /async function handleSwapChoice\([\s\S]{0,900}await handleRefine\(\{/.test(UI));
  check("the instruction names both the old and the new product",
    /Replace the \$\{getShortProductName\(original\)\} in this room with the \$\{getShortProductName\(replacement\)\}/.test(UI));
  check("the instruction asks for everything else to stay put",
    /Keep its position, scale and the rest of the room exactly as they are/.test(UI));
  check("the replacement product is sent as the refinement product",
    /refinementProductIds: \[replacement\.id\]/.test(UI));

  check("the swapped-out product is REPLACED in the shop list, not added beside",
    /replacedProductId: original\.id/.test(UI) &&
      /products\.filter\(\(entry\) => entry\.id !== overrides\.replacedProductId\)/.test(UI));
  check("the swapped-out product is taken out of the cart",
    /current\.filter\(\(id\) => id !== original\.id\)/.test(UI));
  check("the progress flag is always cleared, even on failure",
    /\} finally \{\s*\n\s*setSwappingProductId\(null\);/.test(UI));

  /**
   * Swap must send its instruction in the same tick it is triggered; reading
   * `changeRequest` from state would send whatever the refine box contained.
   */
  check("refine accepts explicit overrides rather than reading stale state",
    /async function handleRefine\(overrides\?: \{/.test(UI));
  check("the request body uses the override, not the state",
    /changeRequest: request,/.test(UI) && /refinementProductIds: refinementIds,/.test(UI));
}

console.log("\nExisting behaviour preserved");
{
  check("the room package CTA is untouched", /Add room package to cart/.test(UI));
  check("recommendations keep their own action", /Add to package|removeRecommendation/.test(UI));
  check("the refine sheet still exists", /refineSheetOpen && \(/.test(UI));
  check("results are still cached for restore", /saveResultCache\(updatedConcepts, updatedProducts\)/.test(UI));
  check("a new room clears the cart", /setCartProductIds\(\[\]\);/.test(UI));
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failures.length}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All result-action tests passed.");
