import products from "../data/products.json";

export type Product = {
  id: string;
  name: string;
  category: string;
  styleTags: string[];
  colors: string[];
  materials: string[];
  widthCm?: number | null;
  depthCm?: number | null;
  heightCm?: number | null;
  price: number | null;
  url: string;
  imageUrls?: string[];
  imageUrl?: string;
  // Optional commercial fields. Nullable/undefined-safe: absent until a real
  // Koala product feed populates them. Never fabricated.
  stockStatus?: "in-stock" | "made-to-order" | "out-of-stock" | string | null;
  // Curated demo products that carry verified real price + product URL.
  isHeroDemoProduct?: boolean;

  // ---- Product Intelligence (optional, nullable-safe) ----------------------
  // Populated by a real Koala product feed or an offline enrichment pass.
  // Absent fields are inferred at runtime by the intelligence layer, never
  // fabricated into the catalogue.
  availability?: string | null;
  finish?: string | null;
  shape?: string | null;
  silhouette?: string | null;
  legsBase?: string | null;
  texture?: string | null;
  roomCompatibility?: string[];
  description?: string | null;
  // Named reference views, e.g. { front: "/products/.../front.jpg", angle: ... }.
  referenceViews?: Record<string, string>;
};

export function getAllProducts(): Product[] {
  return products as Product[];
}

export function getProductsForStyle(style: string): Product[] {
  return (products as Product[]).filter((p) =>
    p.styleTags.some((tag) =>
      tag.toLowerCase().includes(style.toLowerCase())
    )
  );
}

/**
 * Catalogue-ordered lookup. Kept for existing callers that do not care about
 * ordering; prefer `getProductsByIdsInSelectionOrder` for anything that feeds
 * the generation pipeline.
 */
export function getProductsByIds(ids: string[]): Product[] {
  return (products as Product[]).filter((p) => ids.includes(p.id));
}

/**
 * Look products up in the order the CUSTOMER selected them, not catalogue
 * order. The generation pipeline uses selection order end-to-end (profiles →
 * replacement plan → reference-image allocation) so that when a budget forces
 * prioritisation, the products the customer picked first are the ones that keep
 * their reference image.
 *
 * Unknown ids are skipped (same as `getProductsByIds`); duplicates in `ids`
 * yield a single entry so a product can never be planned or referenced twice.
 */
export function getProductsByIdsInSelectionOrder(ids: string[]): Product[] {
  const catalogue = products as Product[];
  const byId = new Map(catalogue.map((product) => [product.id, product]));
  const seen = new Set<string>();
  const ordered: Product[] = [];

  for (const id of ids) {
    if (seen.has(id)) continue;
    const product = byId.get(id);
    if (!product) continue;
    seen.add(id);
    ordered.push(product);
  }

  return ordered;
}

export function getPrimaryProductImageUrl(product: Product): string | null {
  const imageFromList = product.imageUrls
    ?.map((imageUrl) => imageUrl.trim())
    .find(Boolean);
  const legacyImage = product.imageUrl?.trim();

  return imageFromList || legacyImage || null;
}
