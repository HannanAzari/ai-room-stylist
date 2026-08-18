/**
 * Render fidelity diagnostics — internal scaffolding.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 * The pieces needed to judge a render already exist and are already wired: the
 * reviewer derives critical failures (including `product-instance-count-
 * mismatch` and `unexplained-addition`), `decideRecommendation` turns those
 * into accept/regenerate, and the route already runs up to
 * MAX_GENERATION_ATTEMPTS per stage and ranks attempts by contract compliance.
 *
 * What was missing is a single, flat record that says — for one attempt — what
 * was ASKED FOR, what the reviewer SAW, and where those two disagree. Today it
 * is written to the debug payload and the server log. It is deliberately a
 * plain data structure with no behaviour, so the auto-retry that comes next can
 * make its decision from this record rather than re-deriving it, and so a
 * fidelity regression can be compared attempt-to-attempt.
 *
 * NOTE — deliberately NOT overbuilt: no retry policy, no thresholds of its
 * own, no persistence. It reports; the existing recommendation logic decides.
 */
import type { ReplacementPlan } from "./replacement-planner";
import type { QualityReview } from "./quality-reviewer";
import type { ReferenceManifest } from "./reference-manifest";
import { buildProductGroundingPackets } from "./product-grounding";

export type CategoryFidelity = {
  categoryLabel: string;
  /** How many pieces of this category the plan requires in the finished room. */
  required: number;
  /** How many the reviewer reports it could actually see fulfilled. */
  observed: number | null;
  /** Distinct products required — 1 means a matching pair, 2+ means mixed. */
  distinctProductsRequired: number;
  /** True when required and observed disagree. */
  mismatch: boolean;
};

export type RenderDiagnostics = {
  /** Which attempt produced this, 1-based. */
  attempt: number;
  /** Renderer that produced the pixels, e.g. "gpt-image". */
  provider: string;
  /** Task counts the plan asked for. */
  plannedReplacements: number;
  plannedRemovals: number;
  plannedAdditions: number;
  /** Per-category required-vs-observed. */
  categories: CategoryFidelity[];
  /** Products whose reference image did NOT make it into the request. */
  productsWithoutReference: string[];
  /** How many reference images were actually transmitted. */
  referencesTransmitted: number;
  /** Critical failure kinds the reviewer raised, if it ran. */
  criticalFailures: string[];
  /** Reviewer's overall score, when available. */
  overallScore: number | null;
  /** Whether the existing recommendation logic wants another attempt. */
  recommendation: "accept" | "regenerate" | "unavailable";
  /**
   * True when every planned category is fulfilled, nothing unexplained was
   * added, and every selected product had a reference. The single boolean an
   * auto-retry would branch on.
   */
  contractSatisfied: boolean;
};

/**
 * Assemble the record. Pure and side-effect free — safe to call per attempt.
 *
 * `review` is optional because the reviewer is best-effort: when it is
 * unavailable the structural half (what was planned, which references were
 * sent) is still worth recording, and the observed half is honestly null
 * rather than assumed good.
 */
export function buildRenderDiagnostics(input: {
  attempt: number;
  provider: string;
  plan: ReplacementPlan;
  manifest: ReferenceManifest;
  review?: QualityReview | null;
  recommendation?: "accept" | "regenerate";
}): RenderDiagnostics {
  const { plan, manifest, review } = input;
  const packets = buildProductGroundingPackets(plan);

  // Required counts per category come from the grounding packets, which are
  // the same structure the prompt states counts from — so the diagnostics and
  // the instruction can never disagree about what was asked for.
  const byCategory = new Map<string, typeof packets>();
  for (const packet of packets) {
    const existing = byCategory.get(packet.categoryLabel);
    if (existing) existing.push(packet);
    else byCategory.set(packet.categoryLabel, [packet]);
  }

  /**
   * The reviewer reports fulfilment per TASK (`productPresent`). A category is
   * observed as the number of its tasks the reviewer actually saw fulfilled —
   * deliberately the same arithmetic `checkProductQuantities` performs, so the
   * diagnostics and the existing critical-failure check can never disagree
   * about the same render.
   */
  const fulfilledTaskIds = new Set(
    (review?.taskResults ?? [])
      .filter((task) => task.productPresent)
      .map((task) => task.taskId)
  );
  const reviewRan = (review?.taskResults ?? []).length > 0;

  const categories: CategoryFidelity[] = [];
  for (const [categoryLabel, group] of byCategory) {
    const observed = reviewRan
      ? group.filter((packet) => fulfilledTaskIds.has(packet.taskId)).length
      : null;
    categories.push({
      categoryLabel,
      required: group.length,
      observed,
      distinctProductsRequired: new Set(group.map((p) => p.productId)).size,
      mismatch: observed !== null && observed !== group.length,
    });
  }

  const criticalFailures = (review?.criticalFailures ?? []).map(
    (failure) => failure.kind
  );

  const productsWithoutReference = manifest.uncoveredSelectedProductIds;

  return {
    attempt: input.attempt,
    provider: input.provider,
    plannedReplacements: plan.replacements.length,
    plannedRemovals: plan.removals.length,
    plannedAdditions: plan.additions.length,
    categories,
    productsWithoutReference,
    referencesTransmitted: manifest.transmitted.length,
    criticalFailures,
    overallScore: review?.overall ?? null,
    recommendation: input.recommendation ?? "unavailable",
    contractSatisfied:
      categories.every((category) => !category.mismatch) &&
      productsWithoutReference.length === 0 &&
      !criticalFailures.includes("unexplained-addition") &&
      !criticalFailures.includes("product-instance-count-mismatch"),
  };
}

/** Metadata-only log line, gated behind the existing AI debug flag. */
export function logRenderDiagnostics(diagnostics: RenderDiagnostics) {
  if (process.env.ENABLE_AI_DEBUG?.toLowerCase() !== "true") return;
  console.log("[render-diagnostics]", JSON.stringify(diagnostics));
}
