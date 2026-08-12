/**
 * Guardrail test for product reference images against the REAL catalogue.
 *
 * Run with:  npm run test:references
 *
 * This exercises the actual files in `public/products/**`, so it fails loudly
 * if the catalogue regresses to a state where selected products cannot be given
 * a visual reference. It performs no network calls.
 */
import {
  detectImageMimeType,
  loadProductReferenceImages,
  GEMINI_SUPPORTED_IMAGE_TYPES,
} from "@/lib/product-image-references";
import { buildReferenceManifest } from "@/lib/intelligence/reference-manifest";
import { getAllProducts, getProductsByIdsInSelectionOrder } from "@/lib/products";
import { GOLDEN_SELECTED_PRODUCT_IDS } from "@/lib/intelligence/fixtures/golden-living-room";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("\nMagic-byte detection");
  {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    const webp = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("WEBP", "ascii"),
    ]);
    const avif = Buffer.concat([
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("ftyp", "ascii"),
      Buffer.from("avif", "ascii"),
    ]);

    check("detects JPEG", detectImageMimeType(jpeg) === "image/jpeg");
    check("detects PNG", detectImageMimeType(png) === "image/png");
    check("detects WebP", detectImageMimeType(webp) === "image/webp");
    check("detects AVIF", detectImageMimeType(avif) === "image/avif");
    check(
      "AVIF is not an accepted model input type",
      !GEMINI_SUPPORTED_IMAGE_TYPES.has("image/avif")
    );
    check(
      "a .jpg-named WebP is identified as WebP, not JPEG",
      detectImageMimeType(webp) === "image/webp",
      "extension must never decide the MIME type"
    );
  }

  console.log("\nReal catalogue coverage");
  const allProducts = getAllProducts();
  const { loaded, skipped } = await loadProductReferenceImages(
    allProducts,
    "[test]"
  );

  const coveredIds = new Set(loaded.map((entry) => entry.productId));
  const uncovered = allProducts.filter((p) => !coveredIds.has(p.id));

  console.log(
    `  catalogue=${allProducts.length} covered=${coveredIds.size} uncovered=${uncovered.length} loadedImages=${loaded.length} skipped=${skipped.length}`
  );

  check(
    "at least one product reference image loads",
    loaded.length > 0,
    "every reference was dropped — the image model would receive no product pixels"
  );
  check(
    "the majority of the catalogue has a usable reference",
    coveredIds.size > allProducts.length / 2,
    `${coveredIds.size}/${allProducts.length}`
  );
  check(
    "every loaded image declares a model-accepted MIME type",
    loaded.every((entry) => GEMINI_SUPPORTED_IMAGE_TYPES.has(entry.mimeType)),
    [...new Set(loaded.map((e) => e.mimeType))].join(", ")
  );
  check(
    "every skipped reference carries a reason",
    skipped.every((entry) => Boolean(entry.reason?.trim()))
  );

  if (uncovered.length > 0) {
    const reasons = new Map<string, number>();
    for (const entry of skipped) {
      if (!coveredIds.has(entry.productId)) {
        reasons.set(entry.reason, (reasons.get(entry.reason) || 0) + 1);
      }
    }
    console.log("  products WITHOUT a usable reference image:");
    for (const [reason, count] of reasons) {
      console.log(`    - ${count} × ${reason}`);
    }
  }

  console.log("\nGolden selection end-to-end");
  {
    const products = getProductsByIdsInSelectionOrder(
      GOLDEN_SELECTED_PRODUCT_IDS
    );
    const result = await loadProductReferenceImages(products, "[test]");
    const manifest = buildReferenceManifest({
      loaded: result.loaded,
      selectedProductIds: GOLDEN_SELECTED_PRODUCT_IDS,
    });

    check(
      "all 5 golden products resolve from the catalogue",
      products.length === 5,
      `got ${products.length}`
    );
    check(
      "every golden selected product receives a transmitted reference",
      !manifest.hasUncoveredSelectedProduct,
      `uncovered: ${manifest.uncoveredSelectedProductIds.join(", ")}`
    );
    check(
      "transmitted count matches the number of selected products",
      manifest.transmitted.length === products.length,
      `${manifest.transmitted.length} vs ${products.length}`
    );
    check(
      "transmission order equals customer selection order",
      JSON.stringify(manifest.transmitted.map((e) => e.productId)) ===
        JSON.stringify(GOLDEN_SELECTED_PRODUCT_IDS)
    );
    check(
      "total transmitted bytes stay within budget",
      manifest.transmittedBytes < 12 * 1024 * 1024,
      `${(manifest.transmittedBytes / 1024).toFixed(0)}KB`
    );
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Passed: ${passed}   Failed: ${failed}`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
  console.log("All product-reference tests passed.");
}

void main();
