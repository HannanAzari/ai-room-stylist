/**
 * Import the product-intelligence enrichment output into this app.
 *
 * Run with:  npm run import:intelligence
 *
 * ---------------------------------------------------------------------------
 * WHY AN IMPORT STEP AT ALL
 * ---------------------------------------------------------------------------
 * The enrichment job writes to a SIBLING repo. Only this repo is deployed, so
 * reading that directory at runtime would work locally and fail on Vercel. The
 * enriched images and metadata therefore have to be copied in, and this script
 * is the one place that happens — the enrichment repo is treated as read-only
 * input and is never modified.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT RECONCILES
 * ---------------------------------------------------------------------------
 * Three mismatches between the two sides, each of which silently breaks a naive
 * copy:
 *
 *  1. The on-disk FILENAMES are stale. Every enrichment image is named
 *     `NN-unclassified.webp` because classification ran after download, and the
 *     real `viewType` lives only in image-manifest.json. This app infers view
 *     type from the filename, so a straight copy would label all 262 images
 *     "unclassified" and the view-selection logic would have nothing to sort by.
 *     Files are therefore renamed to `NN-<viewType>.webp` on the way in.
 *
 *  2. The manifest's hero entry is NOT an enrichment path. Its `localPath` is
 *     `/products/<category>/<id>/main.jpg` — an app-public path for the image
 *     this repo already had. Those 55 entries look "missing" from the
 *     enrichment repo because they were never in it, and they must be resolved
 *     against public/ instead. That is also why the manifest says 317 images
 *     while 262 files exist alongside it: 317 = 262 enrichment + 55 heroes.
 *
 *  3. `localPathState` says "downloaded" for all 317 regardless. Existence is
 *     therefore verified per file rather than trusted.
 *
 * Product ids, prices, URLs and categories are NOT taken from here — they stay
 * with the existing products.json, which remains the commercial source of
 * truth. This adds visual intelligence and reference views beside it.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { getAllProducts } from "@/lib/products";

const ENRICHMENT_ROOT = "/Users/hannan/Koala/koala-product-enrichment";
const INTELLIGENCE_DIR = join(ENRICHMENT_ROOT, "data/product-intelligence");
const APP_ROOT = process.cwd();

type ManifestImage = {
  productId: string;
  viewType: string;
  localPath: string;
  mimeType: string;
  widthPx: number;
  heightPx: number;
  bytes: number;
  usefulness: number;
  source: string;
};

/** A field in the enrichment record: a value plus its provenance. */
type SourcedValue<T> = { value: T; source?: string; confidence?: number };

function valueOf<T>(field: SourcedValue<T> | undefined): T | undefined {
  return field?.value;
}

/**
 * View priority for renderer grounding.
 *
 * Ordered by how much each view tells the renderer about what the product IS:
 * a hero establishes the whole object, a 45-degree adds depth and the side
 * profile, and a detail resolves material and finish. `rear` and `unclassified`
 * are last — they are rarely the most informative thing to spend a slot on.
 */
const VIEW_PRIORITY = [
  "hero",
  "front",
  "45-degree",
  "side",
  "lifestyle",
  "detail",
  "rear",
  "unclassified",
];

function viewRank(viewType: string): number {
  const index = VIEW_PRIORITY.indexOf(viewType);
  return index === -1 ? VIEW_PRIORITY.length : index;
}

function main() {
  const manifest = JSON.parse(
    readFileSync(join(INTELLIGENCE_DIR, "image-manifest.json"), "utf8")
  ) as { images: ManifestImage[] };
  const enriched = JSON.parse(
    readFileSync(join(INTELLIGENCE_DIR, "products.json"), "utf8")
  ) as { products: Array<{ id: string; official: Record<string, SourcedValue<unknown>>; visualIdentity: Record<string, SourcedValue<unknown>> }> };

  const appProducts = getAllProducts();
  const appById = new Map(appProducts.map((p) => [p.id, p]));
  const enrichedById = new Map(enriched.products.map((p) => [p.id, p]));

  const byProduct = new Map<string, ManifestImage[]>();
  for (const image of manifest.images) {
    const list = byProduct.get(image.productId) ?? [];
    list.push(image);
    byProduct.set(image.productId, list);
  }

  const output: Record<string, unknown> = {};
  let copied = 0;
  let heroesResolved = 0;
  let skippedMissing = 0;
  const unmatched: string[] = [];

  for (const product of appProducts) {
    const images = byProduct.get(product.id) ?? [];
    const record = enrichedById.get(product.id);
    if (!record) unmatched.push(product.id);

    const views: Array<{
      view: string;
      url: string;
      usefulness: number;
      width: number;
      height: number;
    }> = [];

    for (const image of images) {
      const isAppHero = image.localPath.startsWith("/products/");

      if (isAppHero) {
        // Already in this repo — verify rather than copy.
        const heroPath = join(APP_ROOT, "public", image.localPath);
        if (!existsSync(heroPath)) {
          skippedMissing += 1;
          continue;
        }
        heroesResolved += 1;
        views.push({
          view: image.viewType,
          url: image.localPath,
          usefulness: image.usefulness,
          width: image.widthPx,
          height: image.heightPx,
        });
        continue;
      }

      const sourcePath = join(ENRICHMENT_ROOT, image.localPath);
      if (!existsSync(sourcePath)) {
        skippedMissing += 1;
        continue;
      }

      // Rename to carry the REAL view type — see note 1 in the header.
      const extension = image.localPath.split(".").pop() || "webp";
      const index = String(views.length + 1).padStart(2, "0");
      const fileName = `${index}-${image.viewType}.${extension}`;
      const publicUrl = `/products/${product.category}/${product.id}/${fileName}`;
      const destination = join(APP_ROOT, "public", publicUrl);

      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(sourcePath, destination);
      copied += 1;

      views.push({
        view: image.viewType,
        url: publicUrl,
        usefulness: image.usefulness,
        width: image.widthPx,
        height: image.heightPx,
      });
    }

    // Deterministic order: best view type first, then by usefulness, then by
    // URL so equal entries never reorder between runs.
    views.sort(
      (a, b) =>
        viewRank(a.view) - viewRank(b.view) ||
        b.usefulness - a.usefulness ||
        a.url.localeCompare(b.url)
    );

    const official = record?.official ?? {};
    const visual = record?.visualIdentity ?? {};

    output[product.id] = {
      id: product.id,
      // Visual intelligence — vision-derived, far richer than the name-derived
      // heuristics this app was inferring on its own.
      visual: {
        colourFamily: valueOf(visual.colourFamily as SourcedValue<string>) ?? "",
        silhouette: valueOf(visual.silhouette as SourcedValue<string>) ?? "",
        shape: valueOf(visual.shape as SourcedValue<string>) ?? "",
        baseLegs: valueOf(visual.baseLegs as SourcedValue<string>) ?? "",
        armStyle: valueOf(visual.armStyle as SourcedValue<string>) ?? "",
        backStyle: valueOf(visual.backStyle as SourcedValue<string>) ?? "",
        texture: valueOf(visual.texture as SourcedValue<string>) ?? "",
        visualWeight: valueOf(visual.visualWeight as SourcedValue<string>) ?? "",
        styleFamily: valueOf(visual.styleFamily as SourcedValue<string>) ?? "",
        notableFeatures:
          valueOf(visual.notableFeatures as SourcedValue<string[]>) ?? [],
        roomCompatibility:
          valueOf(visual.roomCompatibility as SourcedValue<string[]>) ?? [],
      },
      // Official catalogue facts that describe the PRODUCT, not its commerce.
      // Price/url/category deliberately excluded — products.json owns those.
      official: {
        subcategory: valueOf(official.subcategory as SourcedValue<string>) ?? "",
        canonicalCategory:
          valueOf(official.canonicalCategory as SourcedValue<string>) ?? "",
        configuration:
          valueOf(official.configuration as SourcedValue<string>) ?? "",
        colour: valueOf(official.colour as SourcedValue<string>) ?? "",
        description:
          valueOf(official.description as SourcedValue<string>) ?? "",
      },
      views,
    };
  }

  const outputPath = join(APP_ROOT, "src/data/product-intelligence.json");
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        datasetVersion: "1.0.0",
        importedAt: new Date().toISOString(),
        source: "koala-product-enrichment/data/product-intelligence",
        productCount: Object.keys(output).length,
        products: output,
      },
      null,
      2
    ) + "\n"
  );

  const viewCounts = Object.values(output).map(
    (entry) => (entry as { views: unknown[] }).views.length
  );
  const distribution = viewCounts.reduce<Record<number, number>>((acc, n) => {
    acc[n] = (acc[n] ?? 0) + 1;
    return acc;
  }, {});

  console.log("Product intelligence imported.");
  console.log(`  app products:        ${appProducts.length}`);
  console.log(`  enriched records:    ${enrichedById.size}`);
  console.log(`  unmatched app ids:   ${unmatched.length}${unmatched.length ? ` (${unmatched.join(", ")})` : ""}`);
  console.log(`  images copied:       ${copied}`);
  console.log(`  existing heroes kept:${heroesResolved}`);
  console.log(`  manifest entries missing on disk: ${skippedMissing}`);
  console.log(`  views per product:   ${JSON.stringify(distribution)}`);
  console.log(`  total views indexed: ${viewCounts.reduce((a, b) => a + b, 0)}`);
  console.log(`  written to:          ${outputPath}`);
  if (appById.size !== appProducts.length) {
    console.warn("  WARNING: duplicate product ids in products.json");
  }
}

main();
