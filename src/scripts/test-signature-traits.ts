/**
 * Signature visual traits — exact product identity.
 *
 * Run with:  npm run test:signature
 *
 * ---------------------------------------------------------------------------
 * THE GAP THIS CLOSES
 * ---------------------------------------------------------------------------
 * The traits were already reaching the renderer. The Aspen coffee table was
 * described with "asymmetric two-tier top with a floating glass shelf" and
 * "pierced ribbon-loop matte black base" — and still rendered as a generic
 * stone table. Three reasons, all fixed here and asserted below:
 *
 *  1. No hierarchy: the defining feature sat in a semicolon list at the same
 *     weight as "rounded-rectangle top profile".
 *  2. A CONTRADICTION: `base: black legs base` (name-derived, because the
 *     enrichment pass left baseLegs empty) sat two fields from "pierced
 *     ribbon-loop matte black base". Told the table has both legs and a ribbon
 *     loop, legs is the likelier reading — and legs is what came back.
 *  3. Multi-material products were never flagged, so dropping the glass and
 *     keeping the silhouette satisfied every instruction given.
 */
import {
  buildSignatureTraits,
  formatSignatureTraits,
} from "@/lib/intelligence/signature-traits";
import {
  getEnrichedProduct,
  selectReferenceViews,
} from "@/lib/intelligence/product-intelligence";
import { buildProductGroundingPackets } from "@/lib/intelligence/product-grounding";
import { deriveCriticalFailures } from "@/lib/intelligence/quality-reviewer";
import { resolveCategoryIntents } from "@/lib/intelligence/category-intent";
import { contractToReplacementPlan } from "@/lib/intelligence/replacement-assignment";
import { buildIntelligentRoomPrompt } from "@/lib/intelligence/prompt-builder";
import { getProductProfiles } from "@/lib/intelligence/product-profile";
import { getAllProducts, type Product } from "@/lib/products";
import type { SceneGraph } from "@/lib/intelligence/scene-graph";
import type { RoomAnalysis } from "@/lib/intelligence/room-analysis";
import type { TaskReviewResult } from "@/lib/intelligence/quality-reviewer";

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
function section(t: string) {
  console.log(`\n${t}`);
}

const catalogue = getAllProducts();
const aspen = catalogue.find((p) => p.id.startsWith("aspen"))!;
const isSectional = (n: string) => /corner|chaise|sectional|l shape|terminal/i.test(n);
const sofaA = catalogue.find((p) => p.category === "sofas" && !isSectional(p.name))!;
const sofaB = catalogue.find((p) => p.category === "sofas" && !isSectional(p.name) && p.id !== sofaA.id)!;

function room(): SceneGraph {
  return {
    roomType: "living room", analysed: true,
    furniture: [
      { id: "sofa_a", category: "3 seater sofa", canonicalCategory: "sofa",
        instanceLabel: "the left 3 seater sofa", replaceable: true,
        boundingBox: { x: .03, y: .42, width: .32, height: .3 }, confidence: .92 },
      { id: "sofa_b", category: "3 seater sofa", canonicalCategory: "sofa",
        instanceLabel: "the right 3 seater sofa", replaceable: true,
        boundingBox: { x: .62, y: .42, width: .3, height: .28 }, confidence: .9 },
      { id: "ct", category: "coffee table", canonicalCategory: "coffee-table",
        instanceLabel: "the coffee table", replaceable: true,
        boundingBox: { x: .38, y: .65, width: .2, height: .15 }, confidence: .85 },
    ],
    architecture: { counted: true, windowCount: 1, doorCount: 1, openingCount: 0, features: [] },
  } as unknown as SceneGraph;
}

function planFor(products: Product[], slots: Product[]) {
  const profiles = getProductProfiles(products);
  const resolved = resolveCategoryIntents({
    intents: [
      { canonicalCategory: "sofa", seatingSelection: slots.map((p) => ({
        kind: "sofa-3-seater" as const, count: 1, productId: p.id, productName: p.name })) },
      { canonicalCategory: "coffee-table", productId: aspen.id },
    ],
    sceneGraph: room(), catalogue, profiles, sourceImage: { width: 1200, height: 900 },
  });
  return { plan: contractToReplacementPlan(resolved!.contract!, profiles), profiles };
}

// ===========================================================================
section("A. Signature traits are emitted for distinctive products");
// ===========================================================================
{
  const profiles = getProductProfiles([aspen]);
  const signature = buildSignatureTraits(aspen.id, profiles[0].identity);

  check("Aspen produces signature traits", signature.traits.length > 0);
  check("it is flagged distinctive", signature.isDistinctive);
  check("the most identifying feature is the glass tier",
    /glass/i.test(signature.primaryFeature ?? ""), signature.primaryFeature ?? "");
  check("distinctive construction traits rank above cosmetic ones",
    /glass|loop|tier/i.test(signature.traits[0]), signature.traits[0]);
  check("it is recognised as multi-material",
    signature.materialComponents.length >= 2,
    signature.materialComponents.join(", "));
  check("glass is a named component",
    signature.materialComponents.includes("glass"));
  check("stone is a named component",
    signature.materialComponents.includes("stone"));
  check("the matte black element is a named component",
    signature.materialComponents.includes("matte black finish"),
    "losing the black base was a reported symptom");

  const block = formatSignatureTraits(signature).join("\n");
  check("the block states the traits are non-negotiable",
    /non-negotiable/i.test(block));
  check("...and that all must be visible", /ALL of these are visible/.test(block));
  check("...and calls out the multi-material requirement",
    /MULTI-MATERIAL PRODUCT/.test(block));
  check("...and forbids simplification", /DO NOT SIMPLIFY/.test(block));

  // A plain product must not be dressed up as distinctive.
  const plain = buildSignatureTraits("nonexistent-product", {
    category: "chair", silhouette: "clean-lined", configuration: "",
    material: "fabric", colourFamily: "grey", legsBase: "tapered legs",
    shape: "linear", notableTraits: [],
  });
  check("a plain product is not flagged distinctive", !plain.isDistinctive);
  check("...and gets no multi-material demand",
    plain.materialComponents.length < 2, plain.materialComponents.join(", "));
}

// ===========================================================================
section("B. The Aspen prompt names stone top + glass extension + loop base");
// ===========================================================================
{
  const { plan, profiles } = planFor([sofaA, sofaB, aspen], [sofaA, sofaB]);
  const { prompt } = buildIntelligentRoomPrompt({
    roomAnalysis: { roomType: "living room" } as unknown as RoomAnalysis,
    profiles, style: "modern", roomType: "living room",
    aiConceptMode: false, replacementPlan: plan, referenceViewCount: 9,
  });

  check("the prompt mentions the stone top", /stone top/i.test(prompt));
  check("the prompt mentions the glass shelf/extension",
    /glass shelf|glass extension|floating glass/i.test(prompt));
  check("the prompt mentions the matte black loop base",
    /ribbon-loop|loop.{0,20}base|matte black base/i.test(prompt));
  check("the three appear together in one signature block",
    /SIGNATURE VISUAL TRAITS[\s\S]{0,700}glass[\s\S]{0,700}loop/i.test(prompt));
  check("the prompt states Aspen is multi-material",
    /MULTI-MATERIAL PRODUCT[\s\S]{0,200}glass/i.test(prompt));
  check("the prompt forbids genericising it",
    /DO NOT SIMPLIFY this into a generic piece/.test(prompt));
  check("the global rules forbid single-material rendering",
    /Never render a multi-material product in a single material/.test(prompt));
  check("the global rules forbid substituting a similar product",
    /Never substitute a similar product/.test(prompt));

  // The contradiction that produced the generic table.
  check("the base is no longer described as plain legs",
    !/base \/ legs: black legs base/.test(prompt),
    "a derived 'legs' reading contradicted the sculptural loop");
  check("...it is described as the ribbon loop",
    /base \/ legs: pierced ribbon-loop matte black base/.test(prompt));
}

// ===========================================================================
section("C. Sofa prompts carry upholstery and silhouette traits");
// ===========================================================================
{
  const { plan, profiles } = planFor([sofaA, sofaB, aspen], [sofaA, sofaB]);
  const { prompt } = buildIntelligentRoomPrompt({
    roomAnalysis: { roomType: "living room" } as unknown as RoomAnalysis,
    profiles, style: "modern", roomType: "living room",
    aiConceptMode: false, replacementPlan: plan, referenceViewCount: 9,
  });

  const packets = buildProductGroundingPackets(plan);
  const sofaPackets = packets.filter((p) => p.categoryLabel.includes("sofa"));

  for (const packet of sofaPackets) {
    const label = packet.productName.split(" ").slice(0, 2).join(" ");
    check(`${label}: signature traits emitted`,
      packet.signature.traits.length > 0);
    check(`${label}: upholstery / material described`,
      /weave|woven|bouclé|boucle|fabric|leather|nubuck|textile|upholst/i.test(
        packet.material + " " + packet.signature.traits.join(" ")
      ), packet.material);
    check(`${label}: silhouette described`, packet.silhouette.length > 0,
      packet.silhouette);
    check(`${label}: visual weight described`, packet.visualWeight.length > 0);
    check(`${label}: arm shape described`, packet.armStyle.length > 0,
      packet.armStyle);
    check(`${label}: back shape described`, packet.backStyle.length > 0,
      packet.backStyle);
    check(`${label}: base/legs described`, packet.legsBase.length > 0);
  }

  check("the prompt carries arm detail for the sofas", /arms:/.test(prompt));
  check("the prompt carries back detail", /back:/.test(prompt));
  check("the prompt carries the cushioning/upholstery texture",
    /material \/ texture:/.test(prompt));
  check("both sofas still carry the must-differ rule",
    /MUST DIFFER FROM/.test(prompt));
}

// ===========================================================================
section("D. The reviewer rejects a missing distinctive component");
// ===========================================================================
{
  const { plan } = planFor([sofaA, sofaB, aspen], [sofaA, sofaB]);
  const aspenTask = plan.replacements.find((t) => t.productId === aspen.id)!;

  const baseTask = (over: Partial<TaskReviewResult>): TaskReviewResult => ({
    taskId: aspenTask.taskId, productId: aspen.id,
    productPresent: true, categoryCorrect: true, originalRemovedOrReplaced: true,
    genuineReplacement: true, noDuplicate: true, placementCorrect: true,
    scaleCorrect: true, identityMatches: true,
    signatureTraitsPresent: true, missingSignatureTraits: [], allMaterialsPresent: true,
    reasoning: "", issues: [], ...over,
  });
  // All axes healthy, so nothing here fails on score — the signature checks are
  // what must fire, and only them.
  const axes = {
    roomPreservation: 95, perspective: 95, lighting: 95, productAccuracy: 95,
    placementAccuracy: 95, scale: 95, architecture: 95, furnitureReplacement: 95,
    duplication: 95, crop: 95,
  };
  const globals = {
    noNewArchitecture: true, allOriginalArchitecturePresent: true,
    wallStructurePreserved: true, unselectedSameCategoryUnchanged: true,
    unrelatedFurniturePreserved: true, noUnrequestedAdditions: true, reasoning: "",
  };

  // The exact reported failure: the table reads fine but the glass is gone.
  const missingGlass = deriveCriticalFailures(
    [baseTask({
      signatureTraitsPresent: false,
      missingSignatureTraits: ["asymmetric two-tier top with a floating glass shelf"],
    })],
    axes, globals
  );
  check("a missing glass extension is a critical failure",
    missingGlass.some((f) => f.kind === "signature-trait-missing"));
  check("...and the reason names the trait",
    missingGlass.some((f) => /floating glass shelf/.test(f.detail)),
    missingGlass.map((f) => f.detail).join(" | "));
  check("...even though identityMatches said true",
    baseTask({}).identityMatches,
    "one overall verdict is what let this pass before");

  const missingBase = deriveCriticalFailures(
    [baseTask({
      signatureTraitsPresent: false,
      missingSignatureTraits: ["pierced ribbon-loop matte black base"],
    })], axes, globals
  );
  check("a missing sculptural loop base is a critical failure",
    missingBase.some((f) => f.kind === "signature-trait-missing"));

  const singleMaterial = deriveCriticalFailures(
    [baseTask({ allMaterialsPresent: false })], axes, globals
  );
  check("a multi-material product rendered in one material fails",
    singleMaterial.some((f) => f.kind === "signature-trait-missing"));
  check("...and says so", singleMaterial.some((f) => /several materials/.test(f.detail)));

  // A correct render must not be failed.
  check("a faithful render raises no signature failure",
    !deriveCriticalFailures([baseTask({})], axes, globals)
      .some((f) => f.kind === "signature-trait-missing"));

  // A product that never rendered is already covered by another failure; it
  // must not also be blamed for missing traits it could not have shown.
  check("an absent product is not double-reported as a trait failure",
    !deriveCriticalFailures(
      [baseTask({ productPresent: false, signatureTraitsPresent: false })],
      axes, globals
    ).some((f) => f.kind === "signature-trait-missing"));
}

// ===========================================================================
section("E. Reference selection prefers hero + 3-quarter + detail");
// ===========================================================================
{
  for (const product of [aspen, sofaA, sofaB]) {
    const views = getEnrichedProduct(product.id)!.views;
    const chosen = selectReferenceViews(views);
    const types = chosen.map((v) => v.view);
    const label = product.id.split("-").slice(0, 2).join("-");

    check(`${label}: three references chosen`, chosen.length === 3, types.join(", "));
    check(`${label}: leads with the hero`, types[0] === "hero", types[0]);
    check(`${label}: includes a 3-quarter view`,
      types.includes("45-degree"), types.join(", "));
    check(`${label}: includes a detail view`,
      types.includes("detail"), types.join(", "));
    check(`${label}: no duplicate view types`,
      new Set(types).size === types.length, types.join(", "));
  }

  // The specific change: a 3-quarter view now beats a higher-scoring lifestyle
  // shot, because a styled room photo shows the product small and in context
  // while an elevation shows how it is built.
  const aspenTypes = selectReferenceViews(getEnrichedProduct(aspen.id)!.views)
    .map((v) => v.view);
  check("a 45-degree view is preferred over a better-scoring lifestyle shot",
    aspenTypes.includes("45-degree") && !aspenTypes.includes("lifestyle"),
    aspenTypes.join(", "));

  const lifestyleScore = getEnrichedProduct(aspen.id)!.views
    .find((v) => v.view === "lifestyle")?.usefulness ?? 0;
  const angleScore = getEnrichedProduct(aspen.id)!.views
    .find((v) => v.view === "45-degree")?.usefulness ?? 0;
  check("...and the lifestyle shot really did score higher",
    lifestyleScore > angleScore, `${lifestyleScore} vs ${angleScore}`);
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failures.length}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All signature-trait tests passed.");
