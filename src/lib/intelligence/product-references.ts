/**
 * Multiple product reference images (Phase 2).
 *
 * Resolves an ordered set of reference-view image URLs for a product so the
 * image model can receive front / 45° / side / lifestyle / detail references
 * instead of a single photo. Uses whatever views actually exist on disk today
 * (currently `main.jpg`) and automatically picks up richer views the moment a
 * feed or scraper adds them — no code change required.
 */
import type { Product } from "@/lib/products";

// Priority order — front-facing and angled views help the model most; detail
// and close-ups refine material/texture fidelity.
export const PRODUCT_VIEW_ORDER = [
  "main",
  "front",
  "angle", // 45°
  "45",
  "side",
  "lifestyle",
  "detail",
  "closeup",
  "close-up",
] as const;

export type ProductViewUrl = { view: string; url: string };

const IMAGE_EXTENSIONS = ["jpg", "webp"] as const;

function viewRank(view: string): number {
  const index = PRODUCT_VIEW_ORDER.indexOf(
    view as (typeof PRODUCT_VIEW_ORDER)[number]
  );
  return index === -1 ? PRODUCT_VIEW_ORDER.length : index;
}

function inferViewFromUrl(url: string): string {
  const file = url.split("/").pop()?.split(/[?#.]/)[0]?.toLowerCase() || "";
  const known = PRODUCT_VIEW_ORDER.find((view) => file.includes(view));
  return known || (file.includes("main") ? "main" : file || "main");
}

function productImageBase(product: Product): string | null {
  // Derive the product image directory from its primary image path, e.g.
  // "/products/sofas/<id>/main.jpg" -> "/products/sofas/<id>".
  const primary =
    product.imageUrls?.find(Boolean)?.trim() || product.imageUrl?.trim() || "";
  if (!primary.startsWith("/")) return null;
  const clean = primary.split(/[?#]/)[0];
  const lastSlash = clean.lastIndexOf("/");
  return lastSlash > 0 ? clean.slice(0, lastSlash) : null;
}

/**
 * Ordered, de-duplicated list of candidate reference-view URLs for a product.
 * Sources, in priority order:
 *   1. Explicit `product.referenceViews` (real feed data).
 *   2. `product.imageUrls` / `product.imageUrl` (scraped images).
 *   3. Conventional per-view paths in the product's image directory.
 * Non-existent conventional paths are harmlessly skipped by the file loader.
 */
export function getProductReferenceViewUrls(product: Product): ProductViewUrl[] {
  const seen = new Set<string>();
  const results: ProductViewUrl[] = [];

  const push = (view: string, url: string) => {
    const clean = url.trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    results.push({ view, url: clean });
  };

  // 1. Explicit named views.
  if (product.referenceViews) {
    for (const [view, url] of Object.entries(product.referenceViews)) {
      push(view.toLowerCase(), url);
    }
  }

  // 2. Existing image URLs.
  for (const url of product.imageUrls || []) {
    push(inferViewFromUrl(url), url);
  }
  if (product.imageUrl) push(inferViewFromUrl(product.imageUrl), product.imageUrl);

  // 3. Conventional per-view candidates in the product's directory.
  const base = productImageBase(product);
  if (base) {
    for (const view of PRODUCT_VIEW_ORDER) {
      for (const extension of IMAGE_EXTENSIONS) {
        push(view, `${base}/${view}.${extension}`);
      }
    }
  }

  return results.sort((a, b) => viewRank(a.view) - viewRank(b.view));
}
