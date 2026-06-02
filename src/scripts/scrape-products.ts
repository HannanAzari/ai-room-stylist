import { chromium } from "playwright";
import fs from "fs/promises";
import path from "path";
import slugify from "slugify";

type Product = {
  id: string;
  name: string;
  category: string;
  styleTags: string[];
  colors: string[];
  materials: string[];
  widthCm?: number | null;
  depthCm?: number | null;
  heightCm?: number | null;
  price?: number | null;
  imageUrls: string[];
  url: string;
};


const PRODUCT_URLS = [
  "https://koalaliving.com.au/Kensley-Almond-Cream-Leather-2-Seater-Dual-Electric-Recliner",
  "https://koalaliving.com.au/Lennox-Cream-Leather-3-Seater-Sofa",
  "https://koalaliving.com.au/Elva-Green-Pastel-Leather-3-Seater-Sofa",
  "https://koalaliving.com.au/Marvie-Champagne-Beige-Semi-Aniline-Leather-3-Pieces-Modular-Sofa",
  "https://koalaliving.com.au/Portia-Vintage-Tan-Leather-4-Seater-Sofa",
  "https://koalaliving.com.au/Celia-Mid-Beige-2-Seater-Woven-Fabric-Sofa",
  "https://koalaliving.com.au/Pierce-Shadow-White-Woven-Fabric-Corner-Electric-Recliner",
  "https://koalaliving.com.au/Calma-Pearl-Beige-Fabric-2-Pieces-Modular-Sofa",
  "https://koalaliving.com.au/Gabriella-Mid-Beige-3-Seater-Woven-Fabric-Sofa",
  "https://koalaliving.com.au/Bellagio-Stone-Cream-Woven-Fabric-3-Pieces-Modular-Sofa-With-Left-Terminal-and-Side-Platform",
  "https://koalaliving.com.au/Soluna-Powder-White-Chenille-Fabric-4-Pieces-Modular-Sofa",
  "https://koalaliving.com.au/Kelly-Pearl-Beige-Fabric-3-Seater-Sofa-Champagne-Gold-Legs",
  "https://koalaliving.com.au/Gabriella-Vintage-Mustard-3-Seater-Woven-Fabric-Sofa",
  "https://koalaliving.com.au/Ophelia-II-Smoky-Walnut-Veneer-Curved-Dining-Table",
  "https://koalaliving.com.au/Terra-Linea-Amber-Brown-Ash-Veneer-Two-Triangular-Leg-Rectangular-Dining-Table-240cmx120cm",
  "https://koalaliving.com.au/Sierra-Walnut-Brown-Dining-Table-Wooden-Top-240x120cm",
  "https://koalaliving.com.au/Grayson-Black-Rectangular-Dining-Table-with-Statuario-White-Sintered-Stone-Top---240x105cm",
  "https://koalaliving.com.au/Romina-Sand-Beige-Vegan-Leather-Dining-Chair-Ebony-Brown-Ash-Legs",
  "https://koalaliving.com.au/Maggie-Sand-Beige-Vegan-Leather-Dining-Chair-Ebony-Brown-Ash-Legs",
  "https://koalaliving.com.au/Ballina-Sand-Beige-Vegan-Leather-Dining-Chair-Ebony-Brown-Ash-Legs",
  "https://koalaliving.com.au/Terra-Linea-Light-Ash-Veneer-Dining-Table-Single-Leg-240cm-x-120cm",
  "https://koalaliving.com.au/Gloria-Sand-Beige-Vegan-Leather-Dining-Chair-Smoky-Ash-Legs",
  "https://koalaliving.com.au/Jamil-Ash-Oak-Veneer-Dining-Table",
  "https://koalaliving.com.au/Solene-Chandelier-Amber-Glass",
  "https://koalaliving.com.au/Lunara-Chandelier",
  "https://koalaliving.com.au/Emmeline-Chandelier",
  "https://koalaliving.com.au/Margo-Walnut-Wooden-Floor-Lamp",
  "https://koalaliving.com.au/Alina-Floor-Lamp-150cm",
  "https://koalaliving.com.au/Arges-Stone-Green-Floor-Rug-Large-250cm-x-350cm",
  "https://koalaliving.com.au/Dixon-String-Floor-Rug-Extra-Large-300cm-x-350cm",
  "https://koalaliving.com.au/Estonia-Ivory-Beige-Floor-Rug-Large-250cm-x-350cm",
  "https://koalaliving.com.au/Messina-Nomad-Floor-Rug-Medium-200cm-x-300cm",
  "https://koalaliving.com.au/Millaray-III-Antique-Gold-Arch-Mirror-120-cm",
  "https://koalaliving.com.au/Millaray-III-Antique-Gold-Round-Mirror",
  "https://koalaliving.com.au/Crimson-Silence-Painting-180x180cm",
  "https://koalaliving.com.au/Muted-Vermilion-Painting-80x120cm",
  "https://koalaliving.com.au/Static-Trace-Painting-120x200cm",
  "https://koalaliving.com.au/Ochre-Memory-Painting-180x180cm",
  "https://koalaliving.com.au/Rust-on-Pulse-Painting-230x140cm",
  "https://koalaliving.com.au/Thames-Calacatta-Oro-White-Sintered-Stone-Square-Coffee-Table",
  "https://koalaliving.com.au/San-Pierre-Walnut-Veneer-Coffee-Table-Low-Travertine-Finish-Sintered-Stone-Top",
  "https://koalaliving.com.au/Vania-Coffee-Table",
  "https://koalaliving.com.au/Aspen-White-Sintered-Stone-Coffee-Table---Matte-Black-Legs",
  "https://koalaliving.com.au/Sir-Lionell-Gliding-White-Sintered-Stone-Coffee-Table---Walnut-Brown-Wooden-Legs",
  "https://koalaliving.com.au/Terra-Linea-Light-Ash-Veneer-Triangular-High-Coffee-Table",
  "https://koalaliving.com.au/San-Pierre-Light-Brown-Ash-Veneer-Entertainment-Unit---Travertine-Finish-Sintered-Stone-Top",
  "https://koalaliving.com.au/Tinsley-Brushed-Champagne-Gold-Stainless-Steel-Entertainment-Unit",
  "https://koalaliving.com.au/Sierra-Walnut-Brown-Entertainment-Unit-Ceramic-Top",
  "https://koalaliving.com.au/Jamil-Ash-Oak-Veneer-Entertainment-Unit",
  "https://koalaliving.com.au/Grayson-Statuario-White-Sintered-Stone-Entertainment-Unit-Brushed-Bronze-Legs",
  "https://koalaliving.com.au/Ophelia-Mid-Beige-Fabric-Queen-Bed-with-Smoky-Walnuty-Bed-Frame",
  "https://koalaliving.com.au/Estelle-Velvet-Mustard-Velveteen-Fabric-Queen-Bed",
  "https://koalaliving.com.au/Sir-Lionell-Gliding-White-Sintered-Stone-Dresser-Walnut-Brown-Wooden-Leg",
  "https://koalaliving.com.au/Summerton-Stone-White-Fabric-Queen-Bed-Toffee-Brown-Ash",
  "https://koalaliving.com.au/Archie-White-Sintered-Stone-Oval-Bedside-Table-White-Ribbing",
  "https://koalaliving.com.au/Costanza-Mocha-Walnut-Brown-Wooden-Dresser",
  "https://koalaliving.com.au/Martina-Soft-Beige-Vegan-Leather-Queen-Bed",
];

const COLOR_WORDS = [
  "cream", "beige", "white", "black", "grey", "gray", "brown", "walnut",
  "gold", "green", "blue", "charcoal", "almond", "champagne", "tan",
  "mustard", "ivory", "amber", "stone", "sand", "smoky", "bronze",
  "mocha", "toffee"
];

const MATERIAL_WORDS = [
  "fabric", "velvet", "velveteen", "chenille", "leather", "vegan leather",
  "semi-aniline leather", "marble", "oak", "ash", "glass", "metal",
  "stainless steel", "wood", "wooden", "boucle", "linen", "travertine",
  "veneer", "sintered stone", "ceramic"
];

const STYLE_WORDS = [
  "modern luxury", "warm neutral", "minimal", "hotel style",
  "organic modern", "dark luxury", "coastal", "contemporary",
  "art deco", "classic", "elegant"
];

function guessCategory(text: string) {
  const lower = text.toLowerCase();

  if (lower.includes("sofa") || lower.includes("recliner") || lower.includes("lounge")) return "sofas";
  if (lower.includes("coffee table")) return "coffee-tables";
  if (lower.includes("dining table")) return "dining-tables";
  if (lower.includes("dining chair") || lower.includes("chair")) return "chairs";
  if (lower.includes("lamp") || lower.includes("chandelier") || lower.includes("lighting")) return "lighting";
  if (lower.includes("rug")) return "rugs";
  if (lower.includes("entertainment unit") || lower.includes("tv unit")) return "tv-units";
  if (lower.includes("bed") || lower.includes("dresser") || lower.includes("bedside")) return "beds";
  if (lower.includes("mirror") || lower.includes("painting")) return "decor";

  return "decor";
}

function extractTags(text: string, words: string[]) {
  const lower = text.toLowerCase();
  return words.filter(word => lower.includes(word));
}

function normalizeImageUrl(src: string) {
  const urlObj = new URL(src);
  urlObj.search = "";

  return urlObj.href
    .replace(/_\d+x\d+\./, ".")
    .replace(/_\d+x\./, ".")
    .replace(/_large\./, ".")
    .replace(/_medium\./, ".")
    .replace(/_small\./, ".")
    .replace(/_compact\./, ".")
    .replace(/_thumb\./, ".");
}

function isBadImage(text: string) {
  const lower = text.toLowerCase();

  return (
    lower.includes("logo") ||
    lower.includes("icon") ||
    lower.includes("banner") ||
    lower.includes("payment") ||
    lower.includes("afterpay") ||
    lower.includes("zip") ||
    lower.includes("klarna") ||
    lower.includes("facebook") ||
    lower.includes("instagram") ||
    lower.includes("youtube") ||
    lower.includes("trustpilot") ||
    lower.includes("review") ||
    lower.includes("placeholder") ||
    lower.includes("sprite") ||
    lower.includes("svg") ||
    lower.includes("gif")
  );
}

async function downloadImage(url: string, filePath: string) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed image download: ${url}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(filePath, buffer);
}

async function scrapeProduct(browser: Awaited<ReturnType<typeof chromium.launch>>, url: string): Promise<Product | null> {
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

    const name =
      (await page.locator("h1").first().textContent({ timeout: 10000 }).catch(() => null))?.trim() ||
      url.split("/").pop()?.replace(/-/g, " ") ||
      "Unnamed Product";

    const bodyText = await page.locator("body").innerText();

    const priceText = await page
      .locator("text=/\\$[0-9,.]+/")
      .first()
      .textContent({ timeout: 5000 })
      .catch(() => null);

    const price = priceText
      ? Number(priceText.replace(/[^0-9.]/g, ""))
      : null;

    const rawImages = await page.$$eval("img", imgs =>
      imgs
        .map(img => ({
          src:
            img.getAttribute("src") ||
            img.getAttribute("data-src") ||
            img.getAttribute("data-original") ||
            "",
          alt: img.getAttribute("alt") || "",
        }))
        .filter(img => img.src)
    );

    const seen = new Set<string>();

    const productKeywords = slugify(name, { lower: true, strict: true })
      .split("-")
      .filter(word => word.length > 3);

    const imageUrls = rawImages
      .map(img => {
        let src = img.src;

        if (src.startsWith("//")) src = `https:${src}`;
        if (src.startsWith("/")) src = new URL(src, url).href;

        return {
          ...img,
          src,
          normalized: normalizeImageUrl(src),
        };
      })
      .filter(img => {
        const text = `${img.src} ${img.alt}`.toLowerCase();

        if (isBadImage(text)) return false;
        if (!text.includes("koalaliving")) return false;

        const matchesProduct = productKeywords.some(word =>
          text.includes(word)
        );

        if (!matchesProduct) return false;

        if (seen.has(img.normalized)) return false;
        seen.add(img.normalized);

        return true;
      })
      .map(img => img.src)
      .slice(0, 1);

    const id = slugify(name, { lower: true, strict: true });
    const category = guessCategory(name);

    const productDir = path.join(
      process.cwd(),
      "public",
      "products",
      category,
      id
    );

    await fs.mkdir(productDir, { recursive: true });

    const localImageUrls: string[] = [];

    for (let i = 0; i < imageUrls.length; i++) {
      const filename = "main.jpg";
      const filePath = path.join(productDir, filename);

      try {
        await downloadImage(imageUrls[i], filePath);
        localImageUrls.push(`/products/${category}/${id}/${filename}`);
      } catch {
        console.log(`Skipped image: ${imageUrls[i]}`);
      }
    }

    const allText = `${name} ${bodyText}`;

    console.log(`Saved ${name} — ${localImageUrls.length} images`);

    return {
      id,
      name,
      category,
      styleTags: extractTags(allText, STYLE_WORDS),
      colors: extractTags(allText, COLOR_WORDS),
      materials: extractTags(allText, MATERIAL_WORDS),
      widthCm: null,
      depthCm: null,
      heightCm: null,
      price,
      imageUrls: localImageUrls,
      url,
    };
  } catch (err) {
    console.error(`Failed: ${url}`, err);
    return null;
  } finally {
    await page.close();
  }
}

async function main() {
  if (PRODUCT_URLS.some(url => url.includes("..."))) {
    throw new Error("Replace placeholder product URLs with real product URLs first.");
  }

  await fs.rm(path.join(process.cwd(), "public", "products"), {
    recursive: true,
    force: true,
  });

  const browser = await chromium.launch({ headless: true });
  const products: Product[] = [];

  try {
    for (const url of PRODUCT_URLS) {
      const product = await scrapeProduct(browser, url);
      if (product) products.push(product);
    }
  } finally {
    await browser.close();
  }

  await fs.mkdir(path.join(process.cwd(), "src", "data"), { recursive: true });

  await fs.writeFile(
    path.join(process.cwd(), "src", "data", "products.json"),
    JSON.stringify(products, null, 2)
  );

  console.log(`Done. Saved ${products.length} products.`);
}

main();
