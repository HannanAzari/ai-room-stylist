import fs from "fs/promises";
import path from "path";

type Product = {
  id: string;
  name: string;
  category: string;
  styleTags: string[];
  colors: string[];
  materials: string[];
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
  price: null;
  imageUrls: string[];
  url: string;
};

const COLOR_WORDS = [
  "cream", "beige", "white", "black", "grey", "gray", "brown", "walnut",
  "gold", "green", "blue", "charcoal", "almond", "champagne", "tan",
  "mustard", "ivory", "amber", "stone", "sand", "bronze", "mocha", "toffee"
];

const MATERIAL_WORDS = [
  "fabric", "velvet", "chenille", "leather", "vegan-leather",
  "marble", "oak", "ash", "glass", "metal", "stainless-steel",
  "wood", "boucle", "linen", "travertine", "veneer", "sintered-stone",
  "ceramic"
];

function titleCaseFromSlug(slug: string) {
  return slug
    .split("-")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function extractTags(slug: string, words: string[]) {
  return words
    .filter(word => slug.includes(word))
    .map(word => word.replace("-", " "));
}

async function main() {
  const productsRoot = path.join(process.cwd(), "public", "products");
  const categories = await fs.readdir(productsRoot);

  const products: Product[] = [];

  for (const category of categories) {
    const categoryPath = path.join(productsRoot, category);
    const stat = await fs.stat(categoryPath);

    if (!stat.isDirectory()) continue;

    const productFolders = await fs.readdir(categoryPath);

    for (const productId of productFolders) {
      const productPath = path.join(categoryPath, productId);
      const productStat = await fs.stat(productPath);

      if (!productStat.isDirectory()) continue;

      const files = await fs.readdir(productPath);

      const imageFiles = files.filter(file =>
        /\.(jpg|jpeg|png|webp)$/i.test(file)
      );

      if (imageFiles.length === 0) continue;

      const imageUrls = imageFiles.map(file =>
        `/products/${category}/${productId}/${file}`
      );

      const slugText = `${category}-${productId}`.toLowerCase();

      products.push({
        id: productId,
        name: titleCaseFromSlug(productId),
        category,
        styleTags: ["modern luxury"],
        colors: extractTags(slugText, COLOR_WORDS),
        materials: extractTags(slugText, MATERIAL_WORDS),
        widthCm: null,
        depthCm: null,
        heightCm: null,
        price: null,
        imageUrls,
        url: "",
      });
    }
  }

  await fs.mkdir(path.join(process.cwd(), "src", "data"), { recursive: true });

  await fs.writeFile(
    path.join(process.cwd(), "src", "data", "products.json"),
    JSON.stringify(products, null, 2)
  );

  console.log(`Done. Created products.json with ${products.length} products.`);
}

main();
