/**
 * Product grounding, slot mapping and render diagnostics.
 *
 * Run with:  npm run test:grounding-packet
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SUITE EXISTS FOR
 * ---------------------------------------------------------------------------
 * Live test: both sofas change and the room is preserved, but the rendered
 * furniture is only "in the spirit of" the chosen product. Three things the
 * prompt never said turned out to matter, and the third is a real bug:
 *
 *   1. which SLOT a chosen product fills;
 *   2. that a selected product is the required OUTCOME, not inspiration;
 *   3. that two slots given two DIFFERENT products must look different.
 *
 * (3) is the mirror image of last sprint's bug. "Same model twice" was stated
 * explicitly; "two different models" was stated nowhere at all, so a renderer
 * that drew two identical sofas satisfied every instruction it was given.
 */
import {
  buildProductGroundingPackets,
  formatProductGroundingSection,
  formatSlotSummary,
} from "@/lib/intelligence/product-grounding";
import { buildRenderDiagnostics } from "@/lib/intelligence/render-diagnostics";
import { resolveCategoryIntents } from "@/lib/intelligence/category-intent";
import { contractToReplacementPlan } from "@/lib/intelligence/replacement-assignment";
import { buildIntelligentRoomPrompt } from "@/lib/intelligence/prompt-builder";
import { buildReferenceManifest } from "@/lib/intelligence/reference-manifest";
import { getProductProfiles } from "@/lib/intelligence/product-profile";
import { getAllProducts, type Product } from "@/lib/products";
import type { ReplacementPlan } from "@/lib/intelligence/replacement-planner";
import type { SceneGraph } from "@/lib/intelligence/scene-graph";
import type { RoomAnalysis } from "@/lib/intelligence/room-analysis";
import type { QualityReview } from "@/lib/intelligence/quality-reviewer";

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
const isSectional = (n: string) =>
  /corner|chaise|sectional|l shape|terminal/i.test(n);
const sofaA = catalogue.find((p) => p.category === "sofas" && !isSectional(p.name))!;
const sofaB = catalogue.find(
  (p) => p.category === "sofas" && !isSectional(p.name) && p.id !== sofaA.id
)!;
const coffeeTable = catalogue.find((p) => p.category === "coffee-tables")!;
if (!sofaA || !sofaB || !coffeeTable) {
  throw new Error("the catalogue no longer has the products this suite needs");
}

function twoSofaRoom(): SceneGraph {
  return {
    roomType: "living room",
    analysed: true,
    furniture: [
      { id: "sofa_a", category: "3 seater sofa", canonicalCategory: "sofa",
        instanceLabel: "the left 3 seater sofa", replaceable: true,
        boundingBox: { x: 0.03, y: 0.42, width: 0.32, height: 0.3 }, confidence: 0.92 },
      { id: "sofa_b", category: "3 seater sofa", canonicalCategory: "sofa",
        instanceLabel: "the right 3 seater sofa", replaceable: true,
        boundingBox: { x: 0.62, y: 0.42, width: 0.3, height: 0.28 }, confidence: 0.9 },
      { id: "coffee_table_a", category: "coffee table", canonicalCategory: "coffee-table",
        instanceLabel: "the coffee table", replaceable: true,
        boundingBox: { x: 0.38, y: 0.65, width: 0.2, height: 0.15 }, confidence: 0.85 },
    ],
    architecture: { counted: true, windowCount: 1, doorCount: 1, openingCount: 0, features: [] },
  } as unknown as SceneGraph;
}

/** Build the plan for a given pair of sofa slot products (+ coffee table). */
function planFor(slotProducts: Product[], withCoffeeTable = true): ReplacementPlan {
  const products = withCoffeeTable ? [...slotProducts, coffeeTable] : slotProducts;
  const profiles = getProductProfiles(products);
  const resolved = resolveCategoryIntents({
    intents: [
      {
        canonicalCategory: "sofa",
        seatingSelection: slotProducts.map((p) => ({
          kind: "sofa-3-seater" as const, count: 1, productId: p.id, productName: p.name,
        })),
      },
      ...(withCoffeeTable
        ? [{ canonicalCategory: "coffee-table" as const, productId: coffeeTable.id }]
        : []),
    ],
    sceneGraph: twoSofaRoom(),
    catalogue,
    profiles,
    sourceImage: { width: 1200, height: 900 },
  });
  return contractToReplacementPlan(resolved!.contract!, profiles);
}

const promptFor = (plan: ReplacementPlan, products: Product[]) =>
  buildIntelligentRoomPrompt({
    roomAnalysis: { roomType: "living room" } as unknown as RoomAnalysis,
    profiles: getProductProfiles(products),
    style: "modern", roomType: "living room", aiConceptMode: false,
    replacementPlan: plan, referenceViewCount: 3,
  }).prompt;

// ===========================================================================
section("1. Slot mapping — which chosen product fills which physical slot");
// ===========================================================================
{
  const packets = buildProductGroundingPackets(planFor([sofaA, sofaB]));
  const sofaPackets = packets.filter((p) => p.categoryLabel.includes("sofa"));

  check("one packet per replacement task", packets.length === 3, `${packets.length}`);
  check("two sofa packets", sofaPackets.length === 2);
  check("slots are numbered 1 of 2 and 2 of 2",
    sofaPackets[0].slotIndex === 1 && sofaPackets[0].slotCount === 2 &&
      sofaPackets[1].slotIndex === 2 && sofaPackets[1].slotCount === 2);
  check("each slot names the physical object it replaces",
    sofaPackets[0].targetInstanceLabel !== sofaPackets[1].targetInstanceLabel,
    `${sofaPackets[0].targetInstanceLabel} / ${sofaPackets[1].targetInstanceLabel}`);
  check("each slot carries its own position in the room",
    Boolean(sofaPackets[0].targetLocation) && Boolean(sofaPackets[1].targetLocation));
  check("the coffee table is a single slot, not numbered",
    packets.find((p) => p.categoryLabel.includes("coffee"))!.slotCount === 1);
  check("packets are ordered by task id",
    packets.every((p, i, all) => i === 0 || all[i - 1].taskId < p.taskId));

  // Every field objective A asked for.
  const one = sofaPackets[0];
  for (const [field, present] of [
    ["product id", Boolean(one.productId)],
    ["product name", Boolean(one.productName)],
    ["category", Boolean(one.categoryLabel)],
    ["slot / count", one.slotIndex > 0 && one.slotCount > 0],
    ["configuration (seat count where applicable)", typeof one.configuration === "string"],
    ["colour", typeof one.colour === "string"],
    ["material", typeof one.material === "string"],
    ["shape", typeof one.shape === "string"],
    ["silhouette", typeof one.silhouette === "string"],
    ["notable traits", Array.isArray(one.notableTraits)],
    ["placement role", Boolean(one.placementRole)],
    ["pairing", Boolean(one.pairing)],
  ] as Array<[string, boolean]>) {
    check(`the packet carries ${field}`, present);
  }
}

// ===========================================================================
section("2. Two DIFFERENT sofa models — the case nothing used to state");
// ===========================================================================
{
  const plan = planFor([sofaA, sofaB]);
  const packets = buildProductGroundingPackets(plan);
  const sofas = packets.filter((p) => p.categoryLabel.includes("sofa"));

  check("both sofa slots are marked as needing to differ",
    sofas.every((p) => p.pairing === "different-from"));
  check("each names the other's task id",
    sofas[0].pairedTaskIds.includes(sofas[1].taskId) &&
      sofas[1].pairedTaskIds.includes(sofas[0].taskId));
  check("the two slots carry different product ids",
    sofas[0].productId !== sofas[1].productId);

  const summary = formatSlotSummary(packets).join(" ");
  check("the count summary says 2 DIFFERENT models", /2 DIFFERENT models/.test(summary), summary);
  check("...and names both products", summary.includes(sofaA.name) && summary.includes(sofaB.name));
  check("...and forbids drawing the same sofa twice",
    /Do not draw the same sofa twice/.test(summary));

  const prompt = promptFor(plan, [sofaA, sofaB, coffeeTable]);
  check("the prompt contains the grounding section",
    prompt.includes("SELECTED PRODUCTS — THE REQUIRED OUTCOME"));
  check("the prompt states MUST DIFFER FROM for the sofa slots",
    /MUST DIFFER FROM: task \d+/.test(prompt));
  check("the prompt forbids two identical pieces for two different products",
    /Never draw two identical pieces where the plan names two DIFFERENT products/.test(prompt));
  check("the prompt never claims the two slots must match",
    !prompt.includes("MUST MATCH:"),
    "a same-model instruction here would contradict the customer's choice");
}

// ===========================================================================
section("3. The SAME sofa twice — still stated, and not confused with above");
// ===========================================================================
{
  const plan = planFor([sofaA, sofaA]);
  const packets = buildProductGroundingPackets(plan);
  const sofas = packets.filter((p) => p.categoryLabel.includes("sofa"));

  check("both slots are marked as a matching pair",
    sofas.every((p) => p.pairing === "same-as"));
  check("both slots carry the same product id",
    sofas[0].productId === sofas[1].productId);
  check("they are still two distinct slots",
    sofas[0].taskId !== sofas[1].taskId &&
      sofas[0].slotIndex === 1 && sofas[1].slotIndex === 2);

  const summary = formatSlotSummary(packets).join(" ");
  check("the count summary says SAME model", /must be the SAME model/.test(summary), summary);
  check("...and says exactly 2", /exactly 2 sofas/.test(summary));

  const prompt = promptFor(plan, [sofaA, coffeeTable]);
  check("the prompt states MUST MATCH", /MUST MATCH: task \d+/.test(prompt));
  check("the prompt does NOT tell them to differ",
    !prompt.includes("MUST DIFFER FROM:"),
    "that would contradict the matching-pair choice");
  check("the existing REPEATED PRODUCTS block still fires",
    prompt.includes("REPEATED PRODUCTS"));
}

// ===========================================================================
section("4. A single sofa — no slot noise, no pairing claims");
// ===========================================================================
{
  const packets = buildProductGroundingPackets(planFor([sofaA], false));
  const sofas = packets.filter((p) => p.categoryLabel.includes("sofa"));
  check("one sofa packet", sofas.length === 1);
  check("pairing is 'only'", sofas[0].pairing === "only");
  check("no paired task ids", sofas[0].pairedTaskIds.length === 0);
  check("the count summary stays silent for single pieces",
    formatSlotSummary(packets).length === 0);
  const section4 = formatProductGroundingSection(packets);
  check("the block has no slot ordinal for a single piece",
    !/1 of 1/.test(section4), section4.slice(0, 200));
}

// ===========================================================================
section("5. The grounding block is deterministic and self-contained");
// ===========================================================================
{
  const plan = planFor([sofaA, sofaB]);
  const first = formatProductGroundingSection(buildProductGroundingPackets(plan));
  const second = formatProductGroundingSection(buildProductGroundingPackets(planFor([sofaA, sofaB])));
  check("the same plan produces a byte-identical block", first === second,
    "a fidelity regression must be diffable");
  check("it states the products are the outcome, not inspiration",
    /NOT mood boards, style hints or loose inspiration/.test(first));
  check("it states that a same-style piece is a failure",
    /merely 'in the same style' is a failed render/.test(first));
  check("each block is separated by a blank line",
    /\n\nPRODUCT FOR TASK/.test(first));
  check("empty fields are omitted rather than left dangling",
    !/: *\n/.test(first) && !first.includes(": |"));
}

// ===========================================================================
section("6. Reference budget follows the renderer, not the old Gemini cap");
// ===========================================================================
{
  // Six products, one reference image each — the case that used to lose one.
  const loaded = Array.from({ length: 6 }, (_, i) => ({
    productId: `product-${i + 1}`,
    productName: `Product ${i + 1}`,
    view: "main",
    url: `/products/test/product-${i + 1}/main.jpg`,
    file: new File([new Uint8Array([1, 2, 3])], "main.jpg", { type: "image/jpeg" }),
    mimeType: "image/jpeg",
    bytes: 120_000,
  }));
  const selectedProductIds = loaded.map((l) => l.productId);

  const geminiBudget = buildReferenceManifest({ loaded, selectedProductIds, maxReferences: 5 });
  const gptBudget = buildReferenceManifest({ loaded, selectedProductIds, maxReferences: 12 });

  check("the old 5-image budget drops a product's only reference",
    geminiBudget.hasUncoveredSelectedProduct,
    `uncovered: ${geminiBudget.uncoveredSelectedProductIds.join(", ")}`);
  check("the GPT Image budget covers all six",
    !gptBudget.hasUncoveredSelectedProduct);
  check("...and transmits all six", gptBudget.transmitted.length === 6);
  check("the byte ceiling still applies independently",
    buildReferenceManifest({ loaded, selectedProductIds, maxReferences: 12, maxBytes: 200_000 })
      .transmitted.length < 6);
}

// ===========================================================================
section("7. Render diagnostics — required vs observed");
// ===========================================================================
{
  const plan = planFor([sofaA, sofaB]);
  const manifest = buildReferenceManifest({
    loaded: [sofaA, sofaB, coffeeTable].map((p) => ({
      productId: p.id, productName: p.name, view: "main",
      url: `/products/${p.category}/${p.id}/main.jpg`,
      file: new File([new Uint8Array([1])], "main.jpg", { type: "image/jpeg" }),
      mimeType: "image/jpeg", bytes: 100,
    })),
    plan,
    selectedProductIds: [sofaA.id, sofaB.id, coffeeTable.id],
  });

  // No reviewer: the structural half is still recorded, the observed half is
  // honestly null rather than assumed good.
  const withoutReview = buildRenderDiagnostics({
    attempt: 1, provider: "gpt-image", plan, manifest,
  });
  check("planned counts are recorded",
    withoutReview.plannedReplacements === 3);
  check("observed is null when the reviewer did not run",
    withoutReview.categories.every((c) => c.observed === null));
  check("recommendation is 'unavailable' without a reviewer",
    withoutReview.recommendation === "unavailable");
  check("references transmitted are recorded",
    withoutReview.referencesTransmitted === 3);
  check("no product is missing a reference here",
    withoutReview.productsWithoutReference.length === 0);

  // A review that saw only ONE of the two sofas — the original bug.
  const sofaTaskIds = plan.replacements
    .filter((t) => t.existingCanonicalCategory === "sofa")
    .map((t) => t.taskId);
  const partialReview = {
    taskResults: plan.replacements.map((task) => ({
      taskId: task.taskId,
      productPresent: task.taskId !== sofaTaskIds[1],
    })),
    criticalFailures: [{ kind: "product-instance-count-mismatch" }],
    overall: 62,
  } as unknown as QualityReview;

  const partial = buildRenderDiagnostics({
    attempt: 1, provider: "gpt-image", plan, manifest,
    review: partialReview, recommendation: "regenerate",
  });
  const sofaCategory = partial.categories.find((c) => c.categoryLabel.includes("sofa"))!;
  check("a half-fulfilled sofa pair is detected",
    sofaCategory.required === 2 && sofaCategory.observed === 1 && sofaCategory.mismatch,
    `required ${sofaCategory.required}, observed ${sofaCategory.observed}`);
  check("the fulfilled coffee table is not flagged",
    !partial.categories.find((c) => c.categoryLabel.includes("coffee"))!.mismatch);
  check("contractSatisfied is false", !partial.contractSatisfied);
  check("the critical failure kind is carried through",
    partial.criticalFailures.includes("product-instance-count-mismatch"));
  check("distinct products required is recorded for the mixed pair",
    sofaCategory.distinctProductsRequired === 2);

  // A fully satisfied render.
  const goodReview = {
    taskResults: plan.replacements.map((task) => ({ taskId: task.taskId, productPresent: true })),
    criticalFailures: [],
    overall: 88,
  } as unknown as QualityReview;
  const good = buildRenderDiagnostics({
    attempt: 2, provider: "gpt-image", plan, manifest,
    review: goodReview, recommendation: "accept",
  });
  check("a fully fulfilled render satisfies the contract", good.contractSatisfied);
  check("no category mismatches", good.categories.every((c) => !c.mismatch));
  check("the attempt number is recorded", good.attempt === 2);
  check("the provider is recorded", good.provider === "gpt-image");

  // The record is a plain structure an auto-retry can branch on.
  check("the diagnostics record serialises cleanly",
    typeof JSON.parse(JSON.stringify(good)).contractSatisfied === "boolean");
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failures.length}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log("All product-grounding tests passed.");
