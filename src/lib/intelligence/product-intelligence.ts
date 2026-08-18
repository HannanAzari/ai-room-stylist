/**
 * Access to the imported product-intelligence dataset.
 *
 * The data is produced by a sibling enrichment repo and copied in by
 * `npm run import:intelligence` (see src/scripts/import-product-intelligence.ts
 * for why an import step exists rather than a runtime read).
 *
 * Everything here is read-only and defensive: a product with no enriched record
 * must degrade to the app's existing derived behaviour rather than throw, so a
 * partial dataset can never take the renderer down.
 */
import intelligence from "@/data/product-intelligence.json";

export type EnrichedView = {
  /** Classified view type, e.g. "hero", "45-degree", "detail". */
  view: string;
  /** Public URL under /products/... */
  url: string;
  /** 0-1 score from the enrichment vision pass. */
  usefulness: number;
  width: number;
  height: number;
};

export type EnrichedVisualIdentity = {
  colourFamily: string;
  silhouette: string;
  shape: string;
  baseLegs: string;
  armStyle: string;
  backStyle: string;
  texture: string;
  visualWeight: string;
  styleFamily: string;
  notableFeatures: string[];
  roomCompatibility: string[];
};

export type EnrichedOfficial = {
  subcategory: string;
  canonicalCategory: string;
  configuration: string;
  colour: string;
  description: string;
};

export type EnrichedProduct = {
  id: string;
  visual: EnrichedVisualIdentity;
  official: EnrichedOfficial;
  views: EnrichedView[];
};

const dataset = intelligence as unknown as {
  datasetVersion: string;
  importedAt: string;
  productCount: number;
  products: Record<string, EnrichedProduct>;
};

export function getEnrichedProduct(productId: string): EnrichedProduct | null {
  return dataset.products[productId] ?? null;
}

export function hasEnrichedProduct(productId: string): boolean {
  return Boolean(dataset.products[productId]);
}

export function enrichmentDatasetInfo() {
  return {
    datasetVersion: dataset.datasetVersion,
    importedAt: dataset.importedAt,
    productCount: dataset.productCount,
  };
}

/**
 * How many references one product may contribute.
 *
 * Three is the point of diminishing returns: a hero establishes the object, an
 * angled view adds depth and profile, and a detail resolves material. A fourth
 * near-duplicate spends a slot another PRODUCT needs — and with several
 * products selected the overall budget binds long before per-product appetite
 * does.
 */
export const MAX_VIEWS_PER_PRODUCT = 3;
export const MIN_VIEWS_PER_PRODUCT = 2;

/**
 * View families, in the order a renderer benefits from them.
 *
 * Selection walks these families and takes the best available from each,
 * rather than taking the top N of a flat ranking — three hero shots of the same
 * sofa say much less than a hero, an angle and a material detail. This is what
 * "visually distinct" means operationally.
 */
const VIEW_FAMILIES: Array<{ family: string; members: string[] }> = [
  { family: "hero", members: ["hero", "front"] },
  { family: "angled", members: ["45-degree", "side", "lifestyle"] },
  { family: "detail", members: ["detail"] },
  { family: "other", members: ["rear", "unclassified"] },
];

function familyOf(view: string): string {
  const match = VIEW_FAMILIES.find((entry) => entry.members.includes(view));
  return match?.family ?? "other";
}

/**
 * Choose the reference views for ONE product, deterministically.
 *
 * One pass per family in priority order (so the set is visually distinct),
 * then, only if the cap is not yet met, the best remaining views regardless of
 * family — a product with four detail shots and nothing else should still get
 * its allowance rather than being punished for the enrichment pass's coverage.
 *
 * Ties break on usefulness then URL, so the same input always yields the same
 * ordered set.
 */
export function selectReferenceViews(
  views: EnrichedView[],
  maxViews: number = MAX_VIEWS_PER_PRODUCT
): EnrichedView[] {
  if (maxViews <= 0) return [];

  const ranked = [...views].sort(
    (a, b) => b.usefulness - a.usefulness || a.url.localeCompare(b.url)
  );

  const chosen: EnrichedView[] = [];
  const takenUrls = new Set<string>();

  for (const { family } of VIEW_FAMILIES) {
    if (chosen.length >= maxViews) break;
    const best = ranked.find(
      (view) => !takenUrls.has(view.url) && familyOf(view.view) === family
    );
    if (best) {
      chosen.push(best);
      takenUrls.add(best.url);
    }
  }

  for (const view of ranked) {
    if (chosen.length >= maxViews) break;
    if (takenUrls.has(view.url)) continue;
    chosen.push(view);
    takenUrls.add(view.url);
  }

  return chosen;
}
