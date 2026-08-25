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
 * So the pipeline refuses to spend the render when the ROOM could not be read.
 * Failing loudly with "we could not read your room, try another photo" is a far
 * better outcome than charging for a result that cannot satisfy the contract.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY NO LONGER BLOCKS
 * ---------------------------------------------------------------------------
 * A readable room that simply does not contain one of the chosen items is a
 * different situation entirely, and it used to be treated the same way. A
 * customer who picks a mirror for a room with no mirror has not made a mistake
 * — they want a mirror — and a dead end there is both bad UX and a lost sale.
 *
 * Those categories are now reported as `absentCategories` and the pipeline
 * turns them into ADD tasks instead. `ready` therefore answers only one
 * question: was this photograph usable at all.
 */
import type { SceneGraph } from "./scene-graph";
import type { CanonicalCategory } from "./scene-taxonomy";

export type SceneReadiness = {
  ready: boolean;
  /**
   * Categories the customer chose that the analysis could not find, in the
   * case where the room itself could not be read. Empty for a readable room —
   * see `absentCategories`.
   */
  missingCategories: CanonicalCategory[];
  /**
   * Requested categories a READABLE room does not contain. These are added
   * rather than replaced, and never block generation.
   */
  absentCategories: CanonicalCategory[];
  /** How many instances of each requested category were detected. */
  detectedByCategory: Record<string, number>;
  /** Customer-safe explanation, present only when not ready. */
  reason?: string;
};

/**
 * Is this photograph usable, and which requested categories is it missing?
 *
 * `ready` is now about the PHOTO alone. A readable room that lacks a requested
 * category returns `ready: true` with that category in `absentCategories`, for
 * the caller to turn into an ADD task.
 *
 * Seating is excluded by the caller because its own resolver handles
 * desired-vs-existing explicitly; what matters there is that the room was read
 * at all, which `analysed` covers.
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
      absentCategories: [],
      detectedByCategory,
      reason:
        "We could not read the furniture in this photo. Try a wider, brighter shot of the room with the furniture clearly visible.",
    };
  }

  /**
   * Requested categories the room does not contain.
   *
   * Not a failure — these become ADD tasks. Returned so the caller can tell the
   * customer what will be added rather than replaced.
   */
  const absentCategories = requestedCategories.filter(
    (category) => (detectedByCategory[category] ?? 0) === 0
  );

  return { ready: true, missingCategories: [], absentCategories, detectedByCategory };
}
