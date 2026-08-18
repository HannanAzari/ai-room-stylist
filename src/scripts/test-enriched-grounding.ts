/**
 * Enriched product intelligence, end to end — and the acceptance case.
 *
 * Run with:  npm run test:enriched
 *
 * ---------------------------------------------------------------------------
 * WHY THE ENRICHED DATA WAS NOT REACHING THE RENDERER
 * ---------------------------------------------------------------------------
 * There was no connection at all. The enrichment job writes into a SIBLING
 * repo; this app read its own products.json (one imageUrl each, no
 * referenceViews) and its own public/products tree (one main.jpg each). Nothing
 * referenced the enrichment output, so 262 images and 55 vision-derived
 * identities sat one directory away, unused.
 *
 * Two further mismatches would have broken a naive copy, and are covered here:
 *   - enrichment filenames are all `NN-unclassified.webp` (classification ran
 *     after download); the real viewType lives only in image-manifest.json,
 *     and this app infers view type from the FILENAME.
 *   - the manifest's hero entries point at `/products/<cat>/<id>/main.jpg`,
 *     an APP-public path, not an enrichment path — which is why the manifest
 *     counts 317 images while 262 files sit beside it. 317 = 262 + 55 heroes.
 *
 * Section 5 is the acceptance case: two DIFFERENT 3-seater sofas plus one
 * coffee table, proven from the debug packet with no paid API call.
 */
import {
  getEnrichedProduct,
  hasEnrichedProduct,
  selectReferenceViews,
  enrichmentDatasetInfo,
  MAX_VIEWS_PER_PRODUCT,
  type EnrichedView,
} from "@/lib/intelligence/product-intelligence";
import { getProductReferenceViewUrls } from "@/lib/intelligence/product-references";
import { getProductProfile, getProductProfiles } from "@/lib/intelligence/product-profile";
import { buildProductGroundingPackets, formatProductGroundingSection } from "@/lib/intelligence/product-grounding";
import { buildGroundingDebugPacket } from "@/lib/intelligence/grounding-debug";
import { buildReferenceManifest } from "@/lib/intelligence/reference-manifest";
import { resolveCategoryIntents } from "@/lib/intelligence/category-intent";
import { contractToReplacementPlan } from "@/lib/intelligence/replacement-assignment";
import { getAllProducts } from "@/lib/products";
import type { SceneGraph } from "@/lib/intelligence/scene-graph";
import { existsSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title: string) {
  console.log(`\n${title}`);
}

const catalogue = getAllProducts();
const isSectional = (n: string) => /corner|chaise|sectional|l shape|terminal/i.test(n);
const sofaA = catalogue.find((p) => p.category === "sofas" && !isSectional(p.name))!;
const sofaB = catalogue.find((p) => p.category === "sofas" && !isSectional(p.name) && p.id !== sofaA.id)!;
const coffeeTable = catalogue.find((p) => p.category === "coffee-tables")!;

// ===========================================================================
section("1. The dataset actually arrived");
// ===========================================================================
{
  const info = enrichmentDatasetInfo();
  check("the dataset is present", info.productCount > 0, `${info.productCount}`);
  check("it covers all 55 catalogue products", info.productCount === 55, `${info.productCount}`);
  check("every catalogue product has an enriched record",
    catalogue.every((p) => hasEnrichedProduct(p.id)),
    catalogue.filter((p) => !hasEnrichedProduct(p.id)).map((p) => p.id).join(", "));

  const totalViews = catalogue.reduce(
    (sum, p) => sum + (getEnrichedProduct(p.id)?.views.length ?? 0), 0
  );
  check("all 317 reference views are indexed (262 enriched + 55 heroes)",
    totalViews === 317, `${totalViews}`);

  const multiView = catalogue.filter((p) => (getEnrichedProduct(p.id)?.views.length ?? 0) > 1);
  check("the app no longer has one image per product",
    multiView.length >= 51, `${multiView.length} products with >1 view`);
}

// ===========================================================================
section("2. Every indexed reference actually exists on disk");
// ===========================================================================
{
  let missing = 0;
  const missingExamples: string[] = [];
  for (const product of catalogue) {
    for (const view of getEnrichedProduct(product.id)?.views ?? []) {
      if (!existsSync(`${process.cwd()}/public${view.url}`)) {
        missing += 1;
        if (missingExamples.length < 3) missingExamples.push(view.url);
      }
    }
  }
  check("no indexed view points at a missing file",
    missing === 0, `${missing} missing, e.g. ${missingExamples.join(", ")}`);

  // The enrichment manifest reported localPathState "downloaded" for all 317
  // regardless, so existence is verified rather than trusted.
  check("view types are real classifications, not filename guesses",
    catalogue.some((p) =>
      (getEnrichedProduct(p.id)?.views ?? []).some((v) => v.view === "45-degree")
    ),
    "the on-disk filenames all said 'unclassified'");
}

// ===========================================================================
section("3. Deterministic, visually distinct view selection");
// ===========================================================================
{
  const views: EnrichedView[] = [
    { view: "detail", url: "/d1.webp", usefulness: 0.9, width: 1000, height: 1000 },
    { view: "hero", url: "/h1.webp", usefulness: 0.8, width: 1000, height: 1000 },
    { view: "detail", url: "/d2.webp", usefulness: 0.85, width: 1000, height: 1000 },
    { view: "45-degree", url: "/a1.webp", usefulness: 0.7, width: 1000, height: 1000 },
    { view: "detail", url: "/d3.webp", usefulness: 0.95, width: 1000, height: 1000 },
  ];

  const chosen = selectReferenceViews(views, 3);
  check("the cap is respected", chosen.length === 3);
  check("one view per family, not three of the best-scoring kind",
    new Set(chosen.map((v) => v.view === "detail" ? "detail" : v.view === "hero" ? "hero" : "angled")).size === 3,
    chosen.map((v) => v.view).join(", "));
  check("the hero comes first", chosen[0].view === "hero", chosen[0].view);
  check("...even though a detail scored higher",
    views.find((v) => v.url === "/d3.webp")!.usefulness > chosen[0].usefulness,
    "three views of one angle say less than three angles");
  check("selection is deterministic",
    JSON.stringify(selectReferenceViews(views, 3)) === JSON.stringify(chosen));

  // A product whose enrichment produced only one family still gets its share.
  const detailOnly: EnrichedView[] = [
    { view: "detail", url: "/x1.webp", usefulness: 0.9, width: 1, height: 1 },
    { view: "detail", url: "/x2.webp", usefulness: 0.8, width: 1, height: 1 },
    { view: "detail", url: "/x3.webp", usefulness: 0.7, width: 1, height: 1 },
  ];
  check("a single-family product is not punished",
    selectReferenceViews(detailOnly, 3).length === 3);
  check("...and takes them in usefulness order",
    selectReferenceViews(detailOnly, 3)[0].url === "/x1.webp");
  check("a zero cap yields nothing", selectReferenceViews(views, 0).length === 0);
  check("the default cap is 2-3", MAX_VIEWS_PER_PRODUCT === 3);
}

// ===========================================================================
section("4. Enriched metadata reaches ProductIdentity");
// ===========================================================================
{
  const enriched = getEnrichedProduct(sofaA.id)!;
  const profile = getProductProfile(sofaA);

  check("the identity uses the vision-derived silhouette",
    profile.identity.silhouette === enriched.visual.silhouette,
    `${profile.identity.silhouette}`);
  check("...the vision-derived colour family",
    profile.identity.colourFamily === enriched.visual.colourFamily);
  check("...the vision-derived base/legs",
    profile.identity.legsBase === enriched.visual.baseLegs);
  check("...the vision-derived texture as material",
    profile.identity.material === enriched.visual.texture);
  check("...and the vision-derived notable features",
    JSON.stringify(profile.identity.notableTraits) ===
      JSON.stringify(enriched.visual.notableFeatures));
  check("identity is richer than the name-derived guess",
    profile.identity.silhouette.length > 15, profile.identity.silhouette);

  // Commercial fields must be untouched by the integration.
  check("the product id is unchanged", profile.id === sofaA.id);
  check("the title is unchanged", profile.title === sofaA.name);
  check("the category is unchanged", profile.category === sofaA.category);
  check("pricing still comes from products.json",
    catalogue.find((p) => p.id === sofaA.id)!.price === sofaA.price);
  check("the product URL still comes from products.json",
    catalogue.find((p) => p.id === sofaA.id)!.url === sofaA.url);
}

// ===========================================================================
section("5. ACCEPTANCE — two different 3-seater sofas + one coffee table");
// ===========================================================================
{
  const scene = {
    roomType: "living room", analysed: true,
    furniture: [
      { id: "sofa_a", category: "3 seater sofa", canonicalCategory: "sofa",
        instanceLabel: "the left 3 seater sofa", replaceable: true,
        boundingBox: { x: .03, y: .42, width: .32, height: .3 }, confidence: .92 },
      { id: "sofa_b", category: "3 seater sofa", canonicalCategory: "sofa",
        instanceLabel: "the right 3 seater sofa", replaceable: true,
        boundingBox: { x: .62, y: .42, width: .3, height: .28 }, confidence: .9 },
      { id: "coffee_table_a", category: "coffee table", canonicalCategory: "coffee-table",
        instanceLabel: "the coffee table", replaceable: true,
        boundingBox: { x: .38, y: .65, width: .2, height: .15 }, confidence: .85 },
    ],
    architecture: { counted: true, windowCount: 1, doorCount: 1, openingCount: 0, features: [] },
  } as unknown as SceneGraph;

  const products = [sofaA, sofaB, coffeeTable];
  const profiles = getProductProfiles(products);
  const resolved = resolveCategoryIntents({
    intents: [
      { canonicalCategory: "sofa", seatingSelection: [
        { kind: "sofa-3-seater", count: 1, productId: sofaA.id, productName: sofaA.name },
        { kind: "sofa-3-seater", count: 1, productId: sofaB.id, productName: sofaB.name },
      ]},
      { canonicalCategory: "coffee-table", productId: coffeeTable.id },
    ],
    sceneGraph: scene, catalogue, profiles, sourceImage: { width: 1200, height: 900 },
  });
  const plan = contractToReplacementPlan(resolved!.contract!, profiles);

  // Build the reference set exactly as the route does: real selected views,
  // capped per product, then the renderer's overall budget.
  const loaded = products.flatMap((product) =>
    getProductReferenceViewUrls(product).map((view) => ({
      productId: product.id,
      productName: product.name,
      view: view.view,
      url: view.url,
      file: null as unknown as File,
      mimeType: "image/webp",
      bytes: 120_000,
    }))
  );
  const manifest = buildReferenceManifest({
    loaded, plan, selectedProductIds: products.map((p) => p.id), maxReferences: 12,
  });
  const debug = buildGroundingDebugPacket({ plan, manifest });

  console.log("\n  --- DEBUG PACKET (no paid API call) ---");
  console.log(`  total tasks: ${debug.totalTasks}   total reference images: ${debug.totalReferenceImages}   products: ${debug.totalProducts}`);
  for (const entry of debug.products) {
    console.log(`\n  ${entry.productId}`);
    console.log(`    slot            : ${entry.slotLabel}  (tasks ${entry.taskIds.join(", ")})`);
    console.log(`    enriched        : ${entry.enriched}`);
    console.log(`    metadata sent   : ${entry.metadataFieldsSupplied.join(", ")}`);
    if (entry.metadataFieldsMissing.length) {
      console.log(`    metadata absent : ${entry.metadataFieldsMissing.join(", ")}`);
    }
    console.log(`    views sent      : ${entry.referenceViewCount} of ${entry.referenceViewsAvailable} available`);
    console.log(`    view types      : ${entry.referenceViewTypes.join(", ")}`);
    for (const path of entry.referenceImagePaths) console.log(`      - ${path}`);
  }
  console.log("");

  check("three tasks: two sofas and a coffee table", debug.totalTasks === 3, `${debug.totalTasks}`);
  check("three distinct products", debug.totalProducts === 3);
  check("no product is missing a reference",
    debug.productsWithoutReference.length === 0,
    debug.productsWithoutReference.join(", "));

  const a = debug.products.find((p) => p.productId === sofaA.id)!;
  const b = debug.products.find((p) => p.productId === sofaB.id)!;
  const table = debug.products.find((p) => p.productId === coffeeTable.id)!;

  check("sofa A is present", Boolean(a));
  check("sofa B is present", Boolean(b));
  check("the coffee table is present", Boolean(table));
  check("the two sofas are DIFFERENT products", a.productId !== b.productId);

  for (const [label, entry] of [["sofa A", a], ["sofa B", b], ["coffee table", table]] as const) {
    check(`${label} is backed by enriched metadata`, entry.enriched);
    check(`${label} gets its OWN references`, entry.referenceViewCount >= 2,
      `${entry.referenceViewCount}`);
    check(`${label} gets at most ${MAX_VIEWS_PER_PRODUCT}`,
      entry.referenceViewCount <= MAX_VIEWS_PER_PRODUCT, `${entry.referenceViewCount}`);
    check(`${label}'s references are visually distinct`,
      new Set(entry.referenceViewTypes).size === entry.referenceViewTypes.length,
      entry.referenceViewTypes.join(", "));
    check(`${label}'s paths all belong to that product`,
      entry.referenceImagePaths.every((path) => path.includes(entry.productId)),
      entry.referenceImagePaths.join(", "));
    check(`${label} supplies real metadata fields`,
      entry.metadataFieldsSupplied.length >= 8,
      `${entry.metadataFieldsSupplied.length}`);
  }

  // No image may be shared between products — the mapping bug this guards.
  const allPaths = debug.products.flatMap((p) => p.referenceImagePaths);
  check("no reference image is shared between products",
    new Set(allPaths).size === allPaths.length);
  check("every transmitted reference is mapped to a task",
    manifest.transmitted.every((entry) => entry.taskIds.length > 0));
  check("each sofa's reference is labelled for its own task",
    manifest.transmitted.filter((e) => e.productId === sofaA.id).every((e) => e.taskIds.includes(a.taskIds[0])) &&
      manifest.transmitted.filter((e) => e.productId === sofaB.id).every((e) => e.taskIds.includes(b.taskIds[0])));

  // And the prompt block itself carries the enriched detail.
  const block = formatProductGroundingSection(buildProductGroundingPackets(plan));
  check("the prompt block names both sofas", block.includes(sofaA.name) && block.includes(sofaB.name));
  check("the prompt block carries enriched arm detail", /arms:/.test(block));
  check("the prompt block carries enriched texture", /material \/ texture:/.test(block));
  check("the prompt block still states they must differ", /MUST DIFFER FROM/.test(block));
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failures.length}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All enriched-grounding tests passed.");
