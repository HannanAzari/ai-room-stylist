/**
 * Per-generation grounding debug packet.
 *
 * ---------------------------------------------------------------------------
 * WHY
 * ---------------------------------------------------------------------------
 * The enriched dataset reaching the renderer is not something to take on trust.
 * The failure this integration fixes was invisible precisely because everything
 * LOOKED fine: the app reported one image per product and nobody could see that
 * 262 enriched images and 55 vision-derived identities existed one directory
 * away, unused.
 *
 * So every generation can now state, per product: which metadata fields were
 * actually supplied (not which exist — which were non-empty and sent), which
 * reference image paths went with it, and how those map to tasks. If fidelity
 * is poor again, this answers "was the renderer even told?" before anyone
 * theorises about prompt wording.
 *
 * Metadata and paths only. Never image bytes.
 */
import type { ReplacementPlan } from "./replacement-planner";
import type { ReferenceManifest } from "./reference-manifest";
import { buildProductGroundingPackets } from "./product-grounding";
import { getEnrichedProduct, enrichmentDatasetInfo } from "./product-intelligence";

export type ProductGroundingDebug = {
  productId: string;
  productName: string;
  /** Tasks this product fills — 2 entries means the same model in two slots. */
  taskIds: number[];
  slotLabel: string;
  /** True when an enriched record backed this product. */
  enriched: boolean;
  /** Metadata field names actually supplied (non-empty) to the prompt. */
  metadataFieldsSupplied: string[];
  /** Field names that were empty and therefore omitted. */
  metadataFieldsMissing: string[];
  /** Public paths of the reference images sent for this product. */
  referenceImagePaths: string[];
  /** Classified view types of those images, in order. */
  referenceViewTypes: string[];
  referenceViewCount: number;
  /** Views the product HAS, before per-product and budget capping. */
  referenceViewsAvailable: number;
  /** The non-negotiable traits extracted for this product. */
  signatureTraits: string[];
  /** Materials that must ALL appear, when the product combines several. */
  materialComponents: string[];
  /** The single most identifying feature, elevated in prompt and reviewer. */
  primaryFeature: string | null;
  /** True when the distinctive-product emphasis rule applied. */
  isDistinctive: boolean;
};

export type GroundingDebugPacket = {
  dataset: ReturnType<typeof enrichmentDatasetInfo>;
  totalTasks: number;
  totalReferenceImages: number;
  totalProducts: number;
  productsWithoutReference: string[];
  products: ProductGroundingDebug[];
};

/**
 * Which grounding fields carried a value.
 *
 * Reports what was SUPPLIED rather than what exists, because an empty field is
 * omitted from the rendered block — so "colour" appearing here is the only
 * proof the renderer was actually told the colour.
 */
function describeFields(packet: {
  configuration: string;
  subcategory: string;
  colour: string;
  material: string;
  shape: string;
  silhouette: string;
  visualWeight: string;
  armStyle: string;
  backStyle: string;
  legsBase: string;
  notableTraits: string[];
  placementRole: string;
  targetInstanceLabel: string;
}) {
  const candidates: Array<[string, string | string[]]> = [
    ["configuration", packet.configuration],
    ["catalogue type", packet.subcategory],
    ["colour", packet.colour],
    ["material / texture", packet.material],
    ["shape", packet.shape],
    ["silhouette", packet.silhouette],
    ["visual weight", packet.visualWeight],
    ["arms", packet.armStyle],
    ["back", packet.backStyle],
    ["base / legs", packet.legsBase],
    ["identifying details", packet.notableTraits],
    ["placement role", packet.placementRole],
    ["replaces", packet.targetInstanceLabel],
  ];

  const supplied: string[] = [];
  const missing: string[] = [];
  for (const [name, value] of candidates) {
    const has = Array.isArray(value)
      ? value.length > 0
      : value.trim().length > 0;
    (has ? supplied : missing).push(name);
  }
  return { supplied, missing };
}

export function buildGroundingDebugPacket(input: {
  plan: ReplacementPlan;
  manifest: ReferenceManifest;
}): GroundingDebugPacket {
  const packets = buildProductGroundingPackets(input.plan);

  // Group by product: the same model in two slots is ONE product with two
  // tasks and one shared set of references, which is exactly the case that
  // regressed before and so is exactly what this must show plainly.
  const byProduct = new Map<string, typeof packets>();
  for (const packet of packets) {
    const list = byProduct.get(packet.productId) ?? [];
    list.push(packet);
    byProduct.set(packet.productId, list);
  }

  const transmitted = input.manifest.transmitted;

  const products: ProductGroundingDebug[] = [];
  for (const [productId, group] of byProduct) {
    const first = group[0];
    const fields = describeFields(first);
    const references = transmitted.filter(
      (entry) => entry.productId === productId
    );
    const enriched = getEnrichedProduct(productId);

    products.push({
      productId,
      productName: first.productName,
      taskIds: group.map((packet) => packet.taskId),
      slotLabel:
        first.slotCount > 1
          ? `${first.categoryLabel} ${group.map((p) => p.slotIndex).join(" & ")} of ${first.slotCount}`
          : first.categoryLabel,
      enriched: Boolean(enriched),
      metadataFieldsSupplied: fields.supplied,
      metadataFieldsMissing: fields.missing,
      referenceImagePaths: references.map((entry) => entry.url),
      referenceViewTypes: references.map((entry) => entry.viewType),
      referenceViewCount: references.length,
      referenceViewsAvailable: enriched?.views.length ?? 0,
      signatureTraits: first.signature.traits,
      materialComponents: first.signature.materialComponents,
      primaryFeature: first.signature.primaryFeature,
      isDistinctive: first.signature.isDistinctive,
    });
  }

  return {
    dataset: enrichmentDatasetInfo(),
    totalTasks:
      input.plan.replacements.length +
      input.plan.removals.length +
      input.plan.additions.length,
    totalReferenceImages: transmitted.length,
    totalProducts: products.length,
    productsWithoutReference: input.manifest.uncoveredSelectedProductIds,
    products,
  };
}

/** Metadata-only log, behind the existing AI debug flag. */
export function logGroundingDebugPacket(packet: GroundingDebugPacket) {
  if (process.env.ENABLE_AI_DEBUG?.toLowerCase() !== "true") return;
  console.log("[grounding-debug]", JSON.stringify(packet, null, 2));
}
