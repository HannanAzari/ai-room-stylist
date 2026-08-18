/**
 * AI Quality Reviewer V2 (Sprint 4), restructured as a per-task compliance
 * checklist by the Replacement Accuracy sprint (Phases 9–11).
 *
 * The reviewer compares three things:
 *   1. the customer's original room photo,
 *   2. the deterministic Replacement Plan (what SHOULD have changed), and
 *   3. the generated redesign,
 * and returns BOTH:
 *   - global quality axes (how good the image is), and
 *   - per-task contract compliance (whether the plan was actually executed).
 *
 * Why the split: the previous reviewer only asked for global axis scores, so a
 * render that recoloured the customer's sofa instead of replacing it, or that
 * swapped the wrong category, could still pass on the strength of good lighting
 * and realism. Quality and contract compliance are now judged separately, and a
 * critical compliance failure rejects the attempt regardless of its score.
 *
 * The reviewer is an AI assessment, not ground truth — every per-task field is
 * the model's judgement and is represented as such. No certainty is fabricated.
 *
 * Fallback-safe: with no API key / network failure / unparseable output it
 * returns a `review-unavailable` result. Generation is never blocked, but the
 * unavailability is reported rather than silently treated as a pass.
 */
import { formatIdentity } from "./product-profile";
import type { QualityScore } from "./quality-score";
import type { ReplacementPlan } from "./replacement-planner";
import type { SceneArchitecture } from "./scene-graph";
import { canonicalCategoryLabel } from "./scene-taxonomy";

/**
 * Product-quantity ground truth, derived from the plan itself — not asked of
 * the model. The plan already states, deterministically, how many instances
 * of a product the finished room must contain; that is arithmetic on task
 * ids, not a judgement call. Only whether each task's instance actually
 * rendered (`productPresent`) is left to the model's eyes.
 */
export type ProductQuantityExpectation = {
  productId: string;
  productName: string;
  expectedFinalInstanceCount: number;
  /** The task ids whose fulfilment together satisfy this count. */
  taskIds: number[];
};

/** One expectation per product the plan actually uses. */
export function deriveProductQuantityExpectations(
  plan: ReplacementPlan
): ProductQuantityExpectation[] {
  const byProduct = new Map<string, ProductQuantityExpectation>();
  const bump = (productId: string, productName: string, taskId: number) => {
    const existing = byProduct.get(productId);
    if (existing) {
      existing.expectedFinalInstanceCount += 1;
      existing.taskIds.push(taskId);
    } else {
      byProduct.set(productId, {
        productId,
        productName,
        expectedFinalInstanceCount: 1,
        taskIds: [taskId],
      });
    }
  };
  for (const task of plan.replacements) {
    bump(task.productId, task.productTitle, task.taskId);
  }
  for (const task of plan.additions) {
    bump(task.productId, task.productTitle, task.taskId);
  }
  return [...byProduct.values()];
}

/**
 * Compare each product's expected final instance count against how many of
 * its tasks the reviewer actually saw fulfilled. A task counts as fulfilled
 * only when the model reported `productPresent` for it — that field is
 * already per-task ground truth, so this needs no new question asked of the
 * model, just arithmetic over the answer it already gave.
 */
export function checkProductQuantities(
  expectations: ProductQuantityExpectation[],
  taskResults: TaskReviewResult[]
): CriticalFailure[] {
  const presentTaskIds = new Set(
    taskResults.filter((task) => task.productPresent).map((task) => task.taskId)
  );
  const failures: CriticalFailure[] = [];
  for (const expectation of expectations) {
    const observed = expectation.taskIds.filter((taskId) =>
      presentTaskIds.has(taskId)
    ).length;
    if (observed !== expectation.expectedFinalInstanceCount) {
      failures.push({
        kind: "product-instance-count-mismatch",
        taskId: expectation.taskIds[0] ?? null,
        productId: expectation.productId,
        detail: `${expectation.productName}: the finished room should contain ${expectation.expectedFinalInstanceCount} (tasks ${expectation.taskIds.join(", ")}), but ${observed} actually appeared.`,
      });
    }
  }
  return failures;
}

const REVIEW_MODEL = "gemini-2.5-flash";
const REVIEW_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${REVIEW_MODEL}:generateContent`;
const REVIEW_TIMEOUT_MS = 12_000;

// Weighted overall (0–100) at/above which a result is accepted.
export const REVIEW_THRESHOLD = 70;
// Any single critical axis below this is treated as a hard failure (regenerate),
// even if the weighted overall would otherwise pass.
export const CRITICAL_AXIS_THRESHOLD = 60;

export type ReviewRecommendation = "accept" | "regenerate";

/**
 * Whether the review actually ran. `review-unavailable` means the gate did not
 * execute — it must never be reported as a pass.
 */
export type ReviewStatus =
  | "reviewed-and-passed"
  | "reviewed-and-failed"
  | "review-unavailable";

/** Machine-readable critical failure kinds (Phase 10). */
export type CriticalFailureKind =
  | "selected-product-missing"
  | "wrong-category-replaced"
  | "original-target-remains"
  | "recoloured-not-replaced"
  | "duplicate-product"
  | "wrong-placement"
  | "product-identity-mismatch"
  | "architecture-changed"
  | "architecture-hallucinated"
  | "architecture-element-missing"
  | "unselected-same-category-changed"
  /**
   * An object appears that no authorised task explains — the plan's ADD
   * tasks are the only objects allowed to be new. Renamed from
   * "unrequested-addition": the underlying check is unchanged, but the name
   * now matches the typed REPLACE/ADD/REMOVE contract rather than the older,
   * looser "the customer didn't ask for this" framing.
   */
  | "unexplained-addition"
  | "camera-reframed"
  /**
   * The finished room contains the wrong number of instances of a selected
   * product. Computed deterministically from the plan's task count against
   * how many of those tasks the reviewer actually saw fulfilled — never from
   * an aggregate score, so "requested 2, only 1 rendered" cannot be masked by
   * an otherwise good-looking image.
   */
  | "product-instance-count-mismatch"
  /**
   * A signature visual trait of the product is missing or simplified — the
   * glass extension gone from a stone-and-glass table, a sculptural loop base
   * rendered as ordinary legs. Distinct from product-identity-mismatch, which
   * is the model's overall judgement: this names the specific component that
   * was lost, so the failure is actionable rather than a verdict.
   */
  | "signature-trait-missing";

export type CriticalFailure = {
  kind: CriticalFailureKind;
  taskId: number | null;
  productId: string | null;
  detail: string;
};

/** The model's assessment of one replacement/placement task. */
export type TaskReviewResult = {
  taskId: number;
  productId: string;
  /** Is the intended new product visible in the render at all? */
  productPresent: boolean;
  /** Does it occupy the correct furniture/category role? */
  categoryCorrect: boolean;
  /** Was the original target actually removed/replaced (not left in place)? */
  originalRemovedOrReplaced: boolean;
  /** A genuine swap, rather than the original merely recoloured/restyled? */
  genuineReplacement: boolean;
  /** Is the product free of duplicates in the render? */
  noDuplicate: boolean;
  /** Is it in the zone/location the plan specified? */
  placementCorrect: boolean;
  /** Is its physical scale plausible for the room? */
  scaleCorrect: boolean;
  /**
   * Does the rendered object match the product's STRUCTURED IDENTITY
   * (configuration, material, colour family, base, notable traits) — not merely
   * the right category in roughly the right style?
   */
  identityMatches: boolean;
  /**
   * Does the rendered object show EVERY signature visual trait the prompt
   * listed as non-negotiable? Separate from `identityMatches` because a piece
   * can read as the right product overall while quietly dropping the one
   * component that makes it that product.
   */
  signatureTraitsPresent: boolean;
  /**
   * Named traits/components the reviewer could not see. Populated only when
   * `signatureTraitsPresent` is false, and quoted verbatim into the failure so
   * the reason is specific ("no glass extension") rather than a score.
   */
  missingSignatureTraits: string[];
  /**
   * For multi-material products: were ALL the stated materials visible? A
   * stone-and-glass table rendered entirely in stone fails here even when the
   * silhouette is right.
   */
  allMaterialsPresent: boolean;
  /** The model's short explanation for this task's verdict (debug-visible). */
  reasoning: string;
  /** Free-text observations from the model. */
  issues: string[];
};

/**
 * Whole-room checks that are not tied to a single task. Booleans are phrased so
 * that TRUE always means "good", and an unparseable/missing value therefore
 * fails safe.
 */
export type GlobalReviewChecks = {
  /** No door/window/arch/opening exists that was not in the original. */
  noNewArchitecture: boolean;
  /** Every original door/window/arch/opening is still present. */
  allOriginalArchitecturePresent: boolean;
  /** Wall layout and room envelope unchanged. */
  wallStructurePreserved: boolean;
  /** Objects sharing a category with a planned item were left alone. */
  unselectedSameCategoryUnchanged: boolean;
  /** Furniture outside the plan is untouched. */
  unrelatedFurniturePreserved: boolean;
  /**
   * No object exists that the plan never asked for. Replace mode must not
   * "complete" the room — an unrequested side table is a defect.
   */
  noUnrequestedAdditions: boolean;
  /** The model's explanation of the global verdict (debug-visible). */
  reasoning: string;
};

export type ReviewAxes = {
  roomPreservation: number;
  perspective: number;
  lighting: number;
  productAccuracy: number;
  placementAccuracy: number;
  scale: number;
  architecture: number;
  furnitureReplacement: number;
  duplication: number;
  crop: number;
};

export type QualityReview = ReviewAxes & {
  /** Per-task compliance assessment; empty when the plan had no tasks. */
  taskResults: TaskReviewResult[];
  /** Whole-room checks (architecture, instance discipline). */
  globalChecks: GlobalReviewChecks;
  /** Derived deterministically from taskResults + axes. */
  criticalFailures: CriticalFailure[];
  /** True when there are no critical failures. Separate from `overall`. */
  contractCompliant: boolean;
  /** Weighted quality score, used for RANKING attempts. */
  overall: number;
  recommendation: ReviewRecommendation;
  status: ReviewStatus;
};

/** Result of an attempted review, including the unavailable case. */
export type ReviewOutcome =
  | { status: "reviewed-and-passed" | "reviewed-and-failed"; review: QualityReview }
  | { status: "review-unavailable"; review: null; reason: string };

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Coerce a model-supplied boolean. Missing/unparseable values default to the
 * SAFE side (`false` = "cannot confirm this passed") so an omitted field can
 * never manufacture a pass.
 */
function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

function asIssueList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

export function computeReviewOverall(axes: ReviewAxes): number {
  // The failure modes that break believability (architecture, placement,
  // duplication, missing product) carry the most weight.
  const weighted =
    axes.roomPreservation * 0.16 +
    axes.architecture * 0.16 +
    axes.placementAccuracy * 0.14 +
    axes.productAccuracy * 0.12 +
    axes.duplication * 0.12 +
    axes.crop * 0.1 +
    axes.furnitureReplacement * 0.08 +
    axes.scale * 0.06 +
    axes.perspective * 0.03 +
    axes.lighting * 0.03;
  return Math.round(weighted);
}

/**
 * Derive critical failures from the STRUCTURED per-task results plus the global
 * axes (Phase 10). These are contract violations: they reject the attempt no
 * matter how high the weighted quality score is.
 */
export function deriveCriticalFailures(
  taskResults: TaskReviewResult[],
  axes: ReviewAxes,
  globalChecks?: GlobalReviewChecks,
  criticalThreshold = CRITICAL_AXIS_THRESHOLD,
  /**
   * When supplied, the plan's own task counts are checked against how many
   * of those tasks actually rendered — see `checkProductQuantities`. Added
   * as a trailing optional parameter so every existing call site, tests
   * included, keeps working unchanged; only the caller that has a plan
   * needs to pass it.
   */
  plan?: ReplacementPlan
): CriticalFailure[] {
  const failures: CriticalFailure[] = [];

  for (const task of taskResults) {
    const at = { taskId: task.taskId, productId: task.productId };

    if (!task.productPresent) {
      failures.push({
        ...at,
        kind: "selected-product-missing",
        detail: `Task ${task.taskId}: the selected product is not visible in the generated room.`,
      });
      // The remaining per-task checks are meaningless if it is absent.
      continue;
    }
    if (!task.categoryCorrect) {
      failures.push({
        ...at,
        kind: "wrong-category-replaced",
        detail: `Task ${task.taskId}: the product does not occupy the furniture role the plan specified.`,
      });
    }
    if (!task.originalRemovedOrReplaced) {
      failures.push({
        ...at,
        kind: "original-target-remains",
        detail: `Task ${task.taskId}: the original object that should have been replaced is still present.`,
      });
    }
    if (!task.genuineReplacement) {
      failures.push({
        ...at,
        kind: "recoloured-not-replaced",
        detail: `Task ${task.taskId}: the original item appears recoloured or restyled rather than genuinely replaced.`,
      });
    }
    if (!task.noDuplicate) {
      failures.push({
        ...at,
        kind: "duplicate-product",
        detail: `Task ${task.taskId}: the product appears more than once.`,
      });
    }
    if (!task.placementCorrect) {
      failures.push({
        ...at,
        kind: "wrong-placement",
        detail: `Task ${task.taskId}: the product is not in the location the plan specified.`,
      });
    }
    if (!task.identityMatches) {
      failures.push({
        ...at,
        kind: "product-identity-mismatch",
        detail: `Task ${task.taskId}: the rendered object is the right category but does not match the product's identity (configuration, material, colour family, base or notable traits).`,
      });
    }
    /**
     * A dropped signature trait is its own failure, named specifically.
     *
     * Raised independently of `identityMatches` on purpose: the reported
     * symptom was a table that read as broadly correct while losing the glass
     * extension and the sculptural base, and a single overall verdict is
     * exactly what let that pass. Only raised when the reviewer actually
     * assessed the task, so a product with no signature traits stated cannot
     * fail on one.
     */
    if (!task.signatureTraitsPresent && task.productPresent) {
      const missing = task.missingSignatureTraits.filter(Boolean);
      failures.push({
        ...at,
        kind: "signature-trait-missing",
        detail:
          missing.length > 0
            ? `Task ${task.taskId}: the render is missing signature traits of this product — ${missing.join("; ")}.`
            : `Task ${task.taskId}: the render does not show all of this product's signature visual traits.`,
      });
    }
    if (!task.allMaterialsPresent && task.productPresent) {
      failures.push({
        ...at,
        kind: "signature-trait-missing",
        detail: `Task ${task.taskId}: this product combines several materials and at least one is not visible in the render.`,
      });
    }
  }

  // Global contract violations (independent of any single task).
  if (globalChecks) {
    if (!globalChecks.noNewArchitecture) {
      failures.push({
        kind: "architecture-hallucinated",
        taskId: null,
        productId: null,
        detail:
          "A door, window, arch or opening appears that was not in the original room.",
      });
    }
    if (!globalChecks.allOriginalArchitecturePresent) {
      failures.push({
        kind: "architecture-element-missing",
        taskId: null,
        productId: null,
        detail:
          "An original door, window, arch or opening is missing from the generated room.",
      });
    }
    if (!globalChecks.wallStructurePreserved) {
      failures.push({
        kind: "architecture-changed",
        taskId: null,
        productId: null,
        detail: "The wall structure or room envelope was altered.",
      });
    }
    if (!globalChecks.noUnrequestedAdditions) {
      failures.push({
        kind: "unexplained-addition",
        taskId: null,
        productId: null,
        detail:
          "An object appears that no authorised task explains — furniture-scale or decor, large or small. Replace mode may only change what a REPLACE, ADD or REMOVE task named.",
      });
    }
    if (!globalChecks.unselectedSameCategoryUnchanged) {
      failures.push({
        kind: "unselected-same-category-changed",
        taskId: null,
        productId: null,
        detail:
          "An object sharing a category with a planned item was changed even though the plan did not name it.",
      });
    }
  }

  if (
    axes.architecture < criticalThreshold ||
    axes.roomPreservation < criticalThreshold
  ) {
    failures.push({
      kind: "architecture-changed",
      taskId: null,
      productId: null,
      detail: `Room architecture was altered (architecture ${axes.architecture}, roomPreservation ${axes.roomPreservation}).`,
    });
  }
  if (axes.crop < criticalThreshold) {
    failures.push({
      kind: "camera-reframed",
      taskId: null,
      productId: null,
      detail: `The camera was cropped, zoomed or reframed (crop ${axes.crop}).`,
    });
  }

  // Quantity is arithmetic, not judgement, so it is checked in code against
  // the plan's own task counts rather than left to the model's aggregate
  // impression. This is what makes "the UI said ×2 but only one rendered"
  // structurally detectable instead of hoping a low score happens to catch it.
  if (plan) {
    failures.push(
      ...checkProductQuantities(
        deriveProductQuantityExpectations(plan),
        taskResults
      )
    );
  }

  // De-duplicate: the same kind can be reached from both a structured check and
  // an axis threshold.
  const seen = new Set<string>();
  return failures.filter((failure) => {
    const key = `${failure.kind}|${failure.taskId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Final verdict. Contract compliance and quality are evaluated separately: a
 * critical failure regenerates regardless of score, and a compliant image still
 * regenerates if its quality is below threshold.
 */
export function decideRecommendation(
  criticalFailures: CriticalFailure[],
  overall: number,
  threshold = REVIEW_THRESHOLD
): ReviewRecommendation {
  if (criticalFailures.length > 0) return "regenerate";
  return overall < threshold ? "regenerate" : "accept";
}

/** Regenerate when a review exists and recommends it; null → don't block. */
export function reviewRecommendsRegeneration(
  review: QualityReview | null
): boolean {
  return review?.recommendation === "regenerate";
}

/** Adapt a review to the legacy 5-axis QualityScore (for debug display compat). */
export function reviewToQualityScore(review: QualityReview): QualityScore {
  return {
    roomPreservation: review.roomPreservation,
    productSimilarity: review.productAccuracy,
    fullRoomVisible: review.crop,
    furnitureScale: review.scale,
    realism: Math.round((review.perspective + review.lighting) / 2),
    overall: review.overall,
  };
}

/**
 * The concrete, numbered task checklist the reviewer must answer. Giving the
 * model the exact task ids and product names lets it return structured
 * per-task results instead of a general impression.
 */
export function formatPlanForReview(
  plan?: ReplacementPlan,
  architecture?: SceneArchitecture
): string {
  if (!plan) return "";
  const lines: string[] = [];

  for (const task of plan.replacements) {
    const instance = task.existingSharesCategory
      ? `${task.existingInstanceLabel} (NOT any other ${canonicalCategoryLabel(task.existingCanonicalCategory)} in the room)`
      : `the existing ${task.existingCategory}`;
    const box = task.boundingBox;
    const region = box
      ? ` Target region ≈ x ${Math.round(box.x * 100)}–${Math.round((box.x + box.width) * 100)}%, y ${Math.round(box.y * 100)}–${Math.round((box.y + box.height) * 100)}% of the frame.`
      : "";
    lines.push(
      `- Task ${task.taskId} (productId "${task.productId}"): ${instance}${
        task.existingColor ? `, ${task.existingColor}` : ""
      }, ${task.location}, must be REMOVED and REPLACED by the ${task.productTitle}.${region} Placement: ${task.placement}.\n    IDENTITY — ${formatIdentity(task.identity)}.`
    );
  }
  for (const task of plan.additions) {
    lines.push(
      `- Task ${task.taskId} (productId "${task.productId}"): the ${task.productTitle} must be PLACED at ${task.target}. It has no existing counterpart, so nothing should be removed for it.\n    IDENTITY — ${formatIdentity(task.identity)}.`
    );
  }

  // Informational for the model's own judgement: an item on this list is
  // SUPPOSED to be gone, so its absence must not be read as a problem, and
  // nothing should have been put in the space it left.
  const removeLines = plan.removals.map((task) => {
    const instance = task.existingSharesCategory
      ? `${task.existingInstanceLabel} (NOT any other ${canonicalCategoryLabel(task.existingCanonicalCategory)} in the room)`
      : `the existing ${task.existingCategory}`;
    return `- Task ${task.taskId}: ${instance}, ${task.location}, must be REMOVED with nothing put in its place.`;
  });

  const preserveLines = plan.dispositions
    .filter((entry) => entry.disposition === "preserve")
    .map((entry) => {
      const emphasis = entry.sharesCategoryWithOthers
        ? " Another object of this same category IS being replaced — this one must NOT change as a side effect."
        : "";
      return `- ${entry.instanceLabel} must be UNCHANGED: same position, colour, material and shape.${emphasis}`;
    });

  const architectureLines =
    architecture?.counted === true
      ? [
          `The ORIGINAL room contains exactly ${architecture.windowCount} window(s), ${architecture.doorCount} door(s)/doorway(s) and ${architecture.openingCount} open arch(es)/pass-through(s).`,
          architecture.features.length > 0
            ? `Original architectural features: ${architecture.features.join("; ")}.`
            : "",
          "Count these in the generated image. If the counts differ in EITHER direction, the corresponding whole-room check must be false.",
        ].filter(Boolean)
      : [];

  if (
    lines.length === 0 &&
    removeLines.length === 0 &&
    preserveLines.length === 0 &&
    architectureLines.length === 0
  ) {
    return "";
  }

  const sections = [
    lines.length > 0
      ? `REPLACEMENT PLAN — the generated image must execute exactly these tasks:\n${lines.join("\n")}`
      : "",
    removeLines.length > 0
      ? `MUST BE REMOVED (gone, with nothing new in its place):\n${removeLines.join("\n")}`
      : "",
    preserveLines.length > 0
      ? `MUST BE PRESERVED UNCHANGED:\n${preserveLines.join("\n")}`
      : "",
    architectureLines.length > 0
      ? `ARCHITECTURE BASELINE:\n${architectureLines.join("\n")}`
      : "",
  ].filter(Boolean);

  return sections.join("\n\n");
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function fileToInlineData(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return {
    inline_data: {
      mime_type: file.type || "image/jpeg",
      data: buffer.toString("base64"),
    },
  };
}

const REVIEW_PROMPT = `You are a STRICT interior-render compliance reviewer. The FIRST image is the customer's ORIGINAL room. The SECOND image is an AI-generated redesign that was supposed to execute a specific replacement plan while keeping the rest of the room identical.

Your job has THREE parts.

PART A — per-task compliance. For EVERY task listed in the plan below, answer each question by comparing the two images. Answer true only when you can actually SEE that it holds; when uncertain, answer false and explain in "issues".
  productPresent            — is the named new product actually visible in the generated image?
  categoryCorrect           — does it occupy the furniture role the task specified (a sofa task produced a sofa, NOT a TV unit or other category)?
  originalRemovedOrReplaced — for a REPLACE task, is the original object genuinely gone? Answer false if the original item is still visible anywhere in the room.
  genuineReplacement        — is this a real swap rather than the ORIGINAL object merely recoloured, re-textured or restyled? Look at shape, silhouette, proportions, arm/leg design. If the object has the same form as the original and only its colour or material changed, answer FALSE.
  noDuplicate               — does the product appear exactly once (no cloned or repeated copy)?
  placementCorrect          — is it in the TARGET REGION the task specified? Each task states the region as a percentage of the frame. Answer false if the product appears somewhere else, or if a DIFFERENT instance was changed instead of the one named.
  scaleCorrect              — is its physical size plausible relative to the room and other furniture?
  signatureTraitsPresent    — the task's SIGNATURE VISUAL TRAITS list states the non-negotiable features of this product. Answer TRUE only if EVERY listed trait is visible in the render. Answer FALSE if any one has been dropped or simplified — a sculptural loop base rendered as ordinary legs, a floating glass shelf omitted, a two-tier top flattened into one slab. A beautiful, plausible piece that is missing a listed trait is still FALSE.
  missingSignatureTraits    — when signatureTraitsPresent is false, quote the exact traits you could not see, copied from the SIGNATURE VISUAL TRAITS list. Empty array when it is true.
  allMaterialsPresent       — when the task names a MULTI-MATERIAL PRODUCT, answer TRUE only if every material listed is visibly present. A stone-and-glass table rendered entirely in stone is FALSE even if the shape is correct. TRUE when the product is single-material.
  identityMatches           — compare the rendered object against the task's IDENTITY line field by field: configuration (seat count / modular layout / size), material, colour family, base/legs, shape and the listed identifying details. Answer TRUE only if it is recognisably THAT product. Answer FALSE if it is merely a similar item in the same style — for example the right category and colour but the wrong seat count, the wrong base, or missing a stated identifying detail.
  reasoning                 — one or two sentences explaining your verdict for this task, naming what you actually saw.
  issues                    — short strings describing anything wrong with this task.

PART B — whole-room checks. These are about the room itself, not any single product. TRUE always means "correct".
  noNewArchitecture               — TRUE if the generated image contains NO door, doorway, window, arch, opening or pass-through that is absent from the original. Adding any of these is a serious failure: look carefully at every wall.
  allOriginalArchitecturePresent  — TRUE if every door, window, arch and opening visible in the original is still present, in the same place and at the same size.
  wallStructurePreserved          — TRUE if the walls, corners, ceiling line and floor line are unchanged, and no wall was added, removed, moved or turned into an opening.
  unselectedSameCategoryUnchanged — TRUE if objects that share a category with a planned item, but were NOT named in the plan, are completely unchanged. If the plan replaced one sofa and a second sofa also changed, answer FALSE.
  unrelatedFurniturePreserved     — TRUE if all furniture outside the plan is untouched.
  noUnrequestedAdditions          — TRUE if the generated image contains NO object that is absent from the original photo and not authorised by a REPLACE, ADD or REMOVE task above. This applies to furniture at ANY scale, not only small decor: a desk, console, monitor, computer equipment, storage unit or other large piece appearing where nothing was requested is exactly as serious a failure as an unrequested side table, plant, lamp, cushion, throw, vase, artwork or mirror. Look especially at any space left empty by a task above — nothing may fill it. If you see an object you cannot match to a numbered task, answer FALSE.
  reasoning                       — one or two sentences explaining the whole-room verdict.

PART C — global quality axes, each 0-100.

Return ONLY JSON with EXACTLY this shape:
{
  "taskResults": [
    { "taskId": number, "productId": string, "productPresent": boolean, "categoryCorrect": boolean,
      "originalRemovedOrReplaced": boolean, "genuineReplacement": boolean, "noDuplicate": boolean,
      "placementCorrect": boolean, "scaleCorrect": boolean, "identityMatches": boolean,
      "signatureTraitsPresent": boolean, "missingSignatureTraits": string[], "allMaterialsPresent": boolean,
      "reasoning": string, "issues": string[] }
  ],
  "globalChecks": {
    "noNewArchitecture": boolean, "allOriginalArchitecturePresent": boolean,
    "wallStructurePreserved": boolean, "unselectedSameCategoryUnchanged": boolean,
    "unrelatedFurniturePreserved": boolean, "noUnrequestedAdditions": boolean, "reasoning": string
  },
  "roomPreservation": number,      // original walls, floor and ceiling preserved
  "perspective": number,           // same camera angle / vanishing point as the original
  "lighting": number,              // same lighting direction, colour and intensity
  "productAccuracy": number,       // placed products match the intended products (colour, material, shape)
  "placementAccuracy": number,     // products are where the plan said
  "scale": number,                 // realistic furniture proportions and clearances
  "architecture": number,          // windows, doors and structure NOT moved or reshaped (100 = untouched)
  "furnitureReplacement": number,  // planned items actually replaced/placed (100 = all done, 0 = missing)
  "duplication": number,           // NO duplicated or cloned furniture (100 = none)
  "cropping": number               // whole room still visible (100 = no cropping/zoom/reframe)
}

Include one taskResults entry for EVERY task id in the plan, even if the product is missing. Be critical: reserve 85+ for genuinely excellent results.`;

function parseTaskResults(value: unknown): TaskReviewResult[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): TaskReviewResult | null => {
      if (!raw || typeof raw !== "object") return null;
      const item = raw as Record<string, unknown>;
      const taskId = Number(item.taskId);
      if (!Number.isFinite(taskId)) return null;
      return {
        taskId,
        productId: typeof item.productId === "string" ? item.productId : "",
        productPresent: asBool(item.productPresent),
        categoryCorrect: asBool(item.categoryCorrect),
        originalRemovedOrReplaced: asBool(item.originalRemovedOrReplaced),
        genuineReplacement: asBool(item.genuineReplacement),
        noDuplicate: asBool(item.noDuplicate),
        placementCorrect: asBool(item.placementCorrect),
        scaleCorrect: asBool(item.scaleCorrect),
        identityMatches: asBool(item.identityMatches),
        // Fail safe: an absent or unparseable answer counts as NOT present,
        // matching how every other boolean here is treated.
        signatureTraitsPresent: asBool(item.signatureTraitsPresent),
        missingSignatureTraits: Array.isArray(item.missingSignatureTraits)
          ? item.missingSignatureTraits.filter(
              (trait: unknown): trait is string => typeof trait === "string"
            )
          : [],
        allMaterialsPresent: asBool(item.allMaterialsPresent),
        reasoning: typeof item.reasoning === "string" ? item.reasoning.trim() : "",
        issues: asIssueList(item.issues),
      };
    })
    .filter((item): item is TaskReviewResult => item !== null);
}

/**
 * Parse the whole-room checks. A missing block fails safe: every check becomes
 * false, which surfaces as critical failures rather than a silent pass.
 */
function parseGlobalChecks(value: unknown): GlobalReviewChecks {
  const item =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const present = Object.keys(item).length > 0;
  return {
    noNewArchitecture: asBool(item.noNewArchitecture),
    allOriginalArchitecturePresent: asBool(item.allOriginalArchitecturePresent),
    wallStructurePreserved: asBool(item.wallStructurePreserved),
    unselectedSameCategoryUnchanged: asBool(item.unselectedSameCategoryUnchanged),
    unrelatedFurniturePreserved: asBool(item.unrelatedFurniturePreserved),
    noUnrequestedAdditions: asBool(item.noUnrequestedAdditions),
    reasoning:
      typeof item.reasoning === "string" && item.reasoning.trim()
        ? item.reasoning.trim()
        : present
          ? ""
          : "The reviewer did not return the whole-room checks; treated as failing.",
  };
}

/**
 * Reconcile the model's task results against the plan.
 *
 * A task the model omitted must NOT be treated as a pass — it is materialised
 * as an all-false result so the missing answer becomes a critical failure
 * rather than an invisible gap.
 */
function reconcileTaskResults(
  reported: TaskReviewResult[],
  plan?: ReplacementPlan
): TaskReviewResult[] {
  if (!plan) return reported;

  const planTasks = [
    ...plan.replacements.map((task) => ({
      taskId: task.taskId,
      productId: task.productId,
      isReplacement: true,
    })),
    ...plan.additions.map((task) => ({
      taskId: task.taskId,
      productId: task.productId,
      isReplacement: false,
    })),
  ];
  const byTaskId = new Map(reported.map((result) => [result.taskId, result]));

  return planTasks.map(({ taskId, productId, isReplacement }) => {
    const result = byTaskId.get(taskId);
    if (!result) {
      return {
        taskId,
        productId,
        productPresent: false,
        categoryCorrect: false,
        originalRemovedOrReplaced: false,
        genuineReplacement: false,
        noDuplicate: false,
        placementCorrect: false,
        scaleCorrect: false,
        identityMatches: false,
        signatureTraitsPresent: false,
        missingSignatureTraits: [],
        allMaterialsPresent: false,
        reasoning:
          "The reviewer returned no result for this task, so compliance could not be confirmed.",
        issues: ["The reviewer did not report on this task."],
      };
    }
    // Placement tasks have no original to remove, so those two checks are not
    // applicable and must not be counted as failures.
    return {
      ...result,
      productId: result.productId || productId,
      originalRemovedOrReplaced: isReplacement
        ? result.originalRemovedOrReplaced
        : true,
      genuineReplacement: isReplacement ? result.genuineReplacement : true,
    };
  });
}

export async function reviewGeneratedRoom(input: {
  generatedBase64: string;
  generatedMimeType?: string;
  roomImage: File;
  replacementPlan?: ReplacementPlan;
  /** Counted architecture of the ORIGINAL room, for hallucination detection. */
  architecture?: SceneArchitecture;
  apiKey?: string;
}): Promise<ReviewOutcome> {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) {
    return {
      status: "review-unavailable",
      review: null,
      reason: "no API key configured for the quality reviewer",
    };
  }
  if (!input.generatedBase64) {
    return {
      status: "review-unavailable",
      review: null,
      reason: "no generated image to review",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REVIEW_TIMEOUT_MS);

  try {
    const roomPart = await fileToInlineData(input.roomImage);
    const generatedPart = {
      inline_data: {
        mime_type: input.generatedMimeType || "image/png",
        data: input.generatedBase64,
      },
    };
    const planText = formatPlanForReview(
      input.replacementPlan,
      input.architecture
    );
    const promptText = planText
      ? `${REVIEW_PROMPT}\n\n${planText}`
      : REVIEW_PROMPT;

    const response = await fetch(REVIEW_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: promptText }, roomPart, generatedPart],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      return {
        status: "review-unavailable",
        review: null,
        reason: `reviewer request failed with status ${response.status}`,
      };
    }

    const data = (await response.json().catch(() => null)) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    } | null;
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();
    if (!text) {
      return {
        status: "review-unavailable",
        review: null,
        reason: "reviewer returned an empty response",
      };
    }

    const parsed = extractJsonObject(text);
    if (!parsed) {
      return {
        status: "review-unavailable",
        review: null,
        reason: "reviewer response was not parseable JSON",
      };
    }

    const axes: ReviewAxes = {
      roomPreservation: clampScore(parsed.roomPreservation),
      perspective: clampScore(parsed.perspective),
      lighting: clampScore(parsed.lighting),
      productAccuracy: clampScore(parsed.productAccuracy),
      placementAccuracy: clampScore(parsed.placementAccuracy),
      scale: clampScore(parsed.scale),
      architecture: clampScore(parsed.architecture),
      furnitureReplacement: clampScore(parsed.furnitureReplacement),
      duplication: clampScore(parsed.duplication),
      // Accept either "cropping" or "crop" from the model.
      crop: clampScore(parsed.cropping ?? parsed.crop),
    };
    const taskResults = reconcileTaskResults(
      parseTaskResults(parsed.taskResults),
      input.replacementPlan
    );
    const globalChecks = parseGlobalChecks(parsed.globalChecks);
    const criticalFailures = deriveCriticalFailures(
      taskResults,
      axes,
      globalChecks,
      CRITICAL_AXIS_THRESHOLD,
      input.replacementPlan
    );
    const overall = computeReviewOverall(axes);
    const recommendation = decideRecommendation(criticalFailures, overall);
    const status: ReviewStatus =
      recommendation === "accept" ? "reviewed-and-passed" : "reviewed-and-failed";

    return {
      status,
      review: {
        ...axes,
        taskResults,
        globalChecks,
        criticalFailures,
        contractCompliant: criticalFailures.length === 0,
        overall,
        recommendation,
        status,
      },
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      status: "review-unavailable",
      review: null,
      reason: aborted
        ? `reviewer timed out after ${REVIEW_TIMEOUT_MS}ms`
        : `reviewer threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}
