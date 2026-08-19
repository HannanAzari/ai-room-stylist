/**
 * Is the scene understood well enough to run this generation?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Scene analysis fails silently. When the call times out or returns nothing
 * usable, `analyzeSceneGraph` falls back to an EMPTY graph — and an empty graph
 * is not an error anywhere downstream, it just means "this room contains no
 * furniture". The plan then degrades in a very specific and expensive way:
 *
 *   - seating is desired-count driven, so it becomes ADD tasks: the new sofas
 *     are PLACED beside the customer's existing sofas rather than replacing
 *     them;
 *   - a plain category like coffee-table has nothing to replace, so it produces
 *     NO TASK AT ALL and the product the customer chose is silently dropped.
 *
 * Measured during the renderer benchmark: three of four paid renders came back
 * unusable for exactly this reason, and nothing in the pipeline noticed. The
 * customer waits two minutes, pays for a render, and gets their old furniture
 * with new furniture next to it.
 *
 * So the pipeline now refuses to spend the render. Failing loudly with "we
 * could not read your room, try another photo" is a far better outcome than
 * charging for a result that cannot satisfy the contract.
 */
import type { SceneGraph } from "./scene-graph";
import { canonicalCategoryLabel, type CanonicalCategory } from "./scene-taxonomy";

export type SceneReadiness = {
  ready: boolean;
  /** Categories the customer chose that the analysis could not find. */
  missingCategories: CanonicalCategory[];
  /** How many instances of each requested category were detected. */
  detectedByCategory: Record<string, number>;
  /** Customer-safe explanation, present only when not ready. */
  reason?: string;
};

/**
 * Categories that must be FOUND in the room before a replacement can run.
 *
 * Only replace-style intents are checked. A category the customer wants ADDED
 * has nothing to find by definition, and seating is excluded here because its
 * own resolver handles desired-vs-existing explicitly — what matters for
 * seating is that the room was read at all, which `analysed` covers.
 */
export function assessSceneReadiness(input: {
  sceneGraph: SceneGraph;
  /** Canonical categories the customer asked to change. */
  requestedCategories: CanonicalCategory[];
}): SceneReadiness {
  const { sceneGraph, requestedCategories } = input;

  const detectedByCategory: Record<string, number> = {};
  for (const item of sceneGraph.furniture ?? []) {
    const key = item.canonicalCategory;
    detectedByCategory[key] = (detectedByCategory[key] ?? 0) + 1;
  }

  /**
   * An unanalysed room is the headline case. `analysed: false` means the call
   * failed or fell back — not that the room is empty — and every requested
   * category is therefore unverifiable.
   */
  if (!sceneGraph.analysed || (sceneGraph.furniture ?? []).length === 0) {
    return {
      ready: false,
      missingCategories: requestedCategories,
      detectedByCategory,
      reason:
        "We could not read the furniture in this photo. Try a wider, brighter shot of the room with the furniture clearly visible.",
    };
  }

  const missingCategories = requestedCategories.filter(
    (category) => (detectedByCategory[category] ?? 0) === 0
  );

  if (missingCategories.length > 0) {
    const labels = missingCategories.map(canonicalCategoryLabel);
    return {
      ready: false,
      missingCategories,
      detectedByCategory,
      reason:
        labels.length === 1
          ? `We could not find a ${labels[0]} in this photo, so we cannot replace it. Try a photo where the ${labels[0]} is clearly visible.`
          : `We could not find these in this photo: ${labels.join(", ")}. Try a photo where they are clearly visible.`,
    };
  }

  return { ready: true, missingCategories: [], detectedByCategory };
}
