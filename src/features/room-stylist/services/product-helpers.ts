import allProducts from "@/data/products.json";
import {
  getPrimaryProductImageUrl,
  type Product,
} from "@/lib/products";
import type { ProductCategoryGroup } from "../types";

const preferredCategoryOrder = [
  "sofas",
  "coffee-tables",
  "dining-tables",
  "chairs",
  "lighting",
  "decor",
  "rugs",
];

export const productList = allProducts as Product[];

const CATEGORY_LABEL_OVERRIDES: Record<string, string> = {
  "tv-units": "TV Units",
  "bed-sides": "Bedsides",
  "coffee-tables": "Coffee Tables",
  "dining-tables": "Dining Tables",
};

export function getCategoryLabel(category: string) {
  if (!category) return "";
  if (CATEGORY_LABEL_OVERRIDES[category]) return CATEGORY_LABEL_OVERRIDES[category];

  return category
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export const productsByCategory: ProductCategoryGroup[] = Array.from(
  new Set(productList.map((product) => product.category).filter(Boolean))
)
  .sort((a, b) => {
    const aIndex = preferredCategoryOrder.indexOf(a);
    const bIndex = preferredCategoryOrder.indexOf(b);

    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;

    return a.localeCompare(b);
  })
  .map((categoryId) => ({
    id: categoryId,
    label: getCategoryLabel(categoryId),
    products: productList.filter((product) => product.category === categoryId),
  }))
  .filter((category) => category.products.length > 0);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getShortProductName(product: Product) {
  const descriptors = [
    ...product.colors,
    ...product.materials,
    "antique",
    "ash",
    "beige",
    "black",
    "bronze",
    "brown",
    "brushed",
    "cream",
    "ebony",
    "fabric",
    "finish",
    "gloss",
    "gold",
    "leather",
    "light",
    "matte",
    "mocha",
    "sand",
    "sintered",
    "soft",
    "stone",
    "top",
    "vegan",
    "velvet",
    "velveteen",
    "veneer",
    "walnut",
    "white",
    "wooden",
  ]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  let shortName = product.name
    .replace(/\bwith\b.*$/i, "")
    // Whole dimension phrases like "250cm x 350cm" or "180x180cm".
    .replace(/\b\d+\s?(?:cm|mm|m)?\s?[x×]\s?\d+\s?(?:cm|mm|m)\b/gi, "")
    .replace(/\b\d+(?:\s?x\s?\d+)?\s?(?:cm|mm|m)\b/gi, "");

  descriptors.forEach((descriptor) => {
    shortName = shortName.replace(
      new RegExp(`\\b${escapeRegExp(descriptor)}\\b`, "gi"),
      ""
    );
  });

  shortName = shortName
    // Drop any orphaned "x"/"×" left behind after dimension removal.
    .replace(/\s+[x×]\s+/gi, " ")
    .replace(/\s+[x×]$/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!shortName) {
    shortName = product.name.replace(/\s+/g, " ").trim();
  }

  const words = shortName.split(" ");

  return words.length > 7 ? words.slice(0, 7).join(" ") : shortName;
}

export function getProductImageUrl(product: Product): string | null {
  return getPrimaryProductImageUrl(product);
}

export function getProductUrl(product: Product): string | null {
  const productUrl = product.url?.trim();

  return productUrl || null;
}

export function getProductsFromIds(productIds: string[]): Product[] {
  return productIds
    .map((productId) => productList.find((product) => product.id === productId))
    .filter((product): product is Product => Boolean(product));
}

export function mergeUniqueProducts(
  currentProducts: Product[],
  productsToAdd: Product[]
) {
  const seenProductIds = new Set(currentProducts.map((product) => product.id));

  return [
    ...currentProducts,
    ...productsToAdd.filter((product) => {
      if (seenProductIds.has(product.id)) return false;

      seenProductIds.add(product.id);
      return true;
    }),
  ];
}

export function formatPrice(price: Product["price"]) {
  return typeof price === "number"
    ? `$${price.toLocaleString()}`
    : "Price available on product page";
}

export function formatMoney(amount: number) {
  return `$${Math.round(amount).toLocaleString()}`;
}

// Mock bundle saving applied to a fully-priced room package. Not a real
// promotion — clearly labelled in the UI as an illustrative package saving.
export const BUNDLE_SAVING_RATE = 0.1;

export type PackagePricing = {
  totalItems: number;
  pricedItems: number;
  unpricedItems: number;
  hasAnyPrice: boolean;
  hasAllPrices: boolean;
  // Sums are over the priced items only — never fabricated for missing prices.
  subtotal: number;
  saving: number;
  total: number;
  savingRate: number;
};

/**
 * Computes package pricing across whatever products carry a real price.
 * Fully priced → subtotal/saving/total for the whole package.
 * Partially priced → the same figures for the priced items only, and the
 * caller surfaces "Some pricing available on product pages".
 * No price is ever fabricated for a missing value.
 */
export function getPackagePricing(
  products: Product[],
  savingRate = BUNDLE_SAVING_RATE,
  /**
   * Physical units required per product id. A room needing two of the same
   * sofa is ONE card but TWO units — without this the package would quietly
   * under-charge. Missing entries default to 1.
   */
  quantities?: Record<string, number>
): PackagePricing {
  const unitsFor = (product: Product) =>
    Math.max(1, Math.round(quantities?.[product.id] ?? 1));

  const totalItems = products.reduce(
    (count, product) => count + unitsFor(product),
    0
  );
  const pricedProducts = products.filter(
    (product) => typeof product.price === "number"
  );
  const pricedItems = pricedProducts.reduce(
    (count, product) => count + unitsFor(product),
    0
  );
  const subtotal = pricedProducts.reduce(
    (sum, product) => sum + (product.price as number) * unitsFor(product),
    0
  );
  const saving = Math.round(subtotal * savingRate);

  return {
    totalItems,
    pricedItems,
    unpricedItems: totalItems - pricedItems,
    hasAnyPrice: pricedItems > 0,
    hasAllPrices: totalItems > 0 && pricedItems === totalItems,
    subtotal,
    saving,
    total: subtotal - saving,
    savingRate,
  };
}

export function getHeroDemoProducts(): Product[] {
  return productList.filter((product) => product.isHeroDemoProduct);
}

export function hasPositiveMeasurement(value: string) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0;
}
