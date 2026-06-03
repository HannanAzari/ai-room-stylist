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
    label: categoryId,
    products: productList.filter((product) => product.category === categoryId),
  }))
  .filter((category) => category.products.length > 0);

export function getCategoryLabel(category: string) {
  return category;
}

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
    .replace(/\b\d+(?:\s?x\s?\d+)?\s?(?:cm|mm|m)\b/gi, "");

  descriptors.forEach((descriptor) => {
    shortName = shortName.replace(
      new RegExp(`\\b${escapeRegExp(descriptor)}\\b`, "gi"),
      ""
    );
  });

  shortName = shortName.replace(/\s+/g, " ").trim();

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
    : "Price on request";
}

export function hasPositiveMeasurement(value: string) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0;
}
