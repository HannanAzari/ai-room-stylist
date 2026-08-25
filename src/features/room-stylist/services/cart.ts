/**
 * The cart seam.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * There is no Koala cart API wired to this app yet. Rather than scatter that
 * fact across button handlers — or worse, print "Add to cart" over a link that
 * opens a product page in a new tab — every cart intent goes through here.
 *
 * Today `addToCart` records the intent locally and returns the product page as
 * a handoff, which is the honest version of what the app can actually do. The
 * moment a real endpoint exists, this is the only file that changes: the two
 * functions keep their signatures, the UI keeps saying "Add to cart", and no
 * component learns anything new about how carts work.
 *
 * Deliberately synchronous and side-effect-free apart from analytics. A real
 * implementation will be async; `CartResult` already carries the shape a caller
 * would need for that, so the call sites will not have to change their
 * handling when it does.
 */
import type { Product } from "@/lib/products";
import { getProductUrl } from "./product-helpers";

export type CartResult = {
  /** Whether the product is in the cart after this operation. */
  inCart: boolean;
  /**
   * Where the customer can complete the purchase today. Null when the product
   * has no page — the UI keeps the item in the cart either way, because a
   * missing URL is a catalogue gap rather than a reason to refuse the intent.
   */
  handoffUrl: string | null;
};

/**
 * Products the customer has put in the cart, by id.
 *
 * Held by the caller (React state) rather than in a module-level singleton, so
 * it survives exactly as long as the flow does and nothing has to be reset on
 * unmount. This module only decides what a cart operation MEANS.
 */
export function addToCart(product: Product, current: string[]): {
  ids: string[];
  result: CartResult;
} {
  const ids = current.includes(product.id) ? current : [...current, product.id];
  return {
    ids,
    result: { inCart: true, handoffUrl: getProductUrl(product) || null },
  };
}

export function removeFromCart(product: Product, current: string[]): {
  ids: string[];
  result: CartResult;
} {
  return {
    ids: current.filter((id) => id !== product.id),
    result: { inCart: false, handoffUrl: getProductUrl(product) || null },
  };
}

export function isInCart(product: Product, current: string[]): boolean {
  return current.includes(product.id);
}

/** Catalogue alternatives for a product, for the swap picker. */
export function alternativesFor(
  product: Product,
  catalogue: Product[]
): Product[] {
  return catalogue.filter(
    (candidate) =>
      candidate.category === product.category && candidate.id !== product.id
  );
}
