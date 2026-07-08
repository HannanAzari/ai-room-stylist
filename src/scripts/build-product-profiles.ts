/**
 * Generates docs/product-profiles.json — the Product Intelligence database for
 * the whole catalogue (rich attributes + AI profile per product).
 *
 * Run: npm run intelligence:profiles
 *
 * These profiles are also computed at runtime by the generation pipeline; this
 * artifact is for inspection/QA and to show the intelligence layer concretely.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllProducts } from "../lib/products";
import { buildProductProfile } from "../lib/intelligence/product-profile";
import { getProductReferenceViewUrls } from "../lib/intelligence/product-references";

const products = getAllProducts();

const profiles = products.map((product) => {
  const profile = buildProductProfile(product, products);
  const referenceViews = getProductReferenceViewUrls(product).map((v) => v.view);
  return {
    // Rich product record
    id: product.id,
    title: product.name,
    category: product.category,
    price: product.price,
    url: product.url || null,
    availability: profile.availability,
    dimensions: {
      widthCm: product.widthCm ?? null,
      depthCm: product.depthCm ?? null,
      heightCm: product.heightCm ?? null,
    },
    colours: profile.colours,
    materials: profile.materials,
    finish: profile.finish,
    style: profile.style,
    roomCompatibility: profile.roomTypes,
    shape: profile.shape,
    silhouette: profile.silhouette,
    legsBase: profile.legsBase,
    texture: profile.texture,
    tags: profile.tags,
    referenceViews: [...new Set(referenceViews)],
    // AI profile
    aiProfile: {
      style: profile.style,
      colour: profile.colour,
      materials: profile.materials,
      shape: profile.shape,
      promptFragment: profile.promptFragment,
      negativePrompt: profile.negativePrompt,
      replacementRules: profile.replacementRules,
      roomTypes: profile.roomTypes,
      matchingProducts: profile.matchingProducts,
    },
  };
});

const outputPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../docs/product-profiles.json"
);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(profiles, null, 2) + "\n", "utf8");

console.log(
  `Wrote ${profiles.length} product intelligence profiles → ${outputPath}`
);
