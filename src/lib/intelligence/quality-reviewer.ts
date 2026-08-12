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
import type { QualityScore } from "./quality-score";
import type { ReplacementPlan } from "./replacement-planner";

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
  | "architecture-changed"
  | "camera-reframed";

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
  /** Free-text observations from the model. */
  issues: string[];
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
  criticalThreshold = CRITICAL_AXIS_THRESHOLD
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
  }

  // Global contract violations (independent of any single task).
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

  return failures;
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
export function formatPlanForReview(plan?: ReplacementPlan): string {
  if (!plan) return "";
  const lines: string[] = [];

  for (const task of plan.replacements) {
    lines.push(
      `- Task ${task.taskId} (productId "${task.productId}"): the existing ${task.existingCategory}${
        task.existingColor ? ` (${task.existingColor})` : ""
      }, ${task.location}, must be REMOVED and REPLACED by the ${task.productTitle} — a ${task.productCategory}. Placement: ${task.placement}.`
    );
  }
  for (const task of plan.additions) {
    lines.push(
      `- Task ${task.taskId} (productId "${task.productId}"): the ${task.productTitle} — a ${task.productCategory} — must be PLACED at ${task.target}. It has no existing counterpart, so nothing should be removed for it.`
    );
  }

  const preserveLines = plan.dispositions
    .filter((entry) => entry.disposition === "preserve")
    .map(
      (entry) =>
        `- The existing ${entry.rawCategory} must be UNCHANGED: same position, colour, material and shape.`
    );

  if (lines.length === 0 && preserveLines.length === 0) return "";

  const sections = [
    lines.length > 0
      ? `REPLACEMENT PLAN — the generated image must execute exactly these tasks:\n${lines.join("\n")}`
      : "",
    preserveLines.length > 0
      ? `MUST BE PRESERVED UNCHANGED:\n${preserveLines.join("\n")}`
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

Your job has TWO parts.

PART A — per-task compliance. For EVERY task listed in the plan below, answer each question by comparing the two images. Answer true only when you can actually SEE that it holds; when uncertain, answer false and explain in "issues".
  productPresent            — is the named new product actually visible in the generated image?
  categoryCorrect           — does it occupy the furniture role the task specified (a sofa task produced a sofa, NOT a TV unit or other category)?
  originalRemovedOrReplaced — for a REPLACE task, is the original object genuinely gone? Answer false if the original item is still visible anywhere in the room.
  genuineReplacement        — is this a real swap rather than the ORIGINAL object merely recoloured, re-textured or restyled? Look at shape, silhouette, proportions, arm/leg design. If the object has the same form as the original and only its colour or material changed, answer FALSE.
  noDuplicate               — does the product appear exactly once (no cloned or repeated copy)?
  placementCorrect          — is it in the location/zone the task specified?
  scaleCorrect              — is its physical size plausible relative to the room and other furniture?
  issues                    — short strings describing anything wrong with this task.

PART B — global quality axes, each 0-100.

Return ONLY JSON with EXACTLY this shape:
{
  "taskResults": [
    { "taskId": number, "productId": string, "productPresent": boolean, "categoryCorrect": boolean,
      "originalRemovedOrReplaced": boolean, "genuineReplacement": boolean, "noDuplicate": boolean,
      "placementCorrect": boolean, "scaleCorrect": boolean, "issues": string[] }
  ],
  "roomPreservation": number,      // original walls, floor and ceiling preserved
  "perspective": number,           // same camera angle / vanishing point as the original
  "lighting": number,              // same lighting direction, colour and intensity
  "productAccuracy": number,       // placed products match the intended products (colour, material, shape)
  "placementAccuracy": number,     // products are where the plan said
  "scale": number,                 // realistic furniture proportions and clearances
  "architecture": number,          // windows, doors and structure NOT moved or reshaped (100 = untouched)
  "furnitureReplacement": number,  // planned items actually replaced/placed (100 = all done, 0 = missing)
  "duplication": number,           // NO duplicated or cloned furniture (100 = none)
  "cropping": number,              // whole room still visible (100 = no cropping/zoom/reframe)
  "unrelatedFurniturePreserved": number, // furniture NOT in the plan is untouched (100 = untouched)
  "noUnexplainedAdditions": number       // no large furniture appears that the plan did not request
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
        issues: asIssueList(item.issues),
      };
    })
    .filter((item): item is TaskReviewResult => item !== null);
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
    const planText = formatPlanForReview(input.replacementPlan);
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
    const criticalFailures = deriveCriticalFailures(taskResults, axes);
    const overall = computeReviewOverall(axes);
    const recommendation = decideRecommendation(criticalFailures, overall);
    const status: ReviewStatus =
      recommendation === "accept" ? "reviewed-and-passed" : "reviewed-and-failed";

    return {
      status,
      review: {
        ...axes,
        taskResults,
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
