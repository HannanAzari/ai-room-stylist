/**
 * AI Quality Reviewer V2 (Sprint 4).
 *
 * A strict SECOND-PASS review that compares three things:
 *   1. the customer's original room photo,
 *   2. the deterministic Replacement Plan (what SHOULD have changed), and
 *   3. the generated redesign,
 * and scores the generated image across ten explicit axes. Unlike the earlier
 * 5-axis score, this reviewer knows exactly which items were meant to change and
 * which fixed objects were meant to stay, so it can catch the failures that
 * matter most: duplicated furniture, wrong placement, a missing/unreplaced
 * product, or altered architecture.
 *
 * Any of those hard failures forces `recommendation: "regenerate"` regardless of
 * the weighted overall, which the route uses to auto-regenerate once.
 *
 * Fully fallback-safe: with no API key / network failure / unparseable output it
 * returns null and the route accepts the generated image as-is.
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

export type QualityReview = {
  // Original architecture/envelope preserved (walls, floor, ceiling).
  roomPreservation: number;
  // Camera angle / vanishing point unchanged.
  perspective: number;
  // Lighting direction, colour and intensity unchanged.
  lighting: number;
  // Placed products match the intended Koala products (colour/material/shape).
  productAccuracy: number;
  // Products placed where the plan said (right zone / replacing the right item).
  placementAccuracy: number;
  // Realistic furniture proportions and clearances.
  scale: number;
  // Windows, doors, structural elements not moved/reshaped (100 = untouched).
  architecture: number;
  // The planned items were actually replaced/placed (100 = all done).
  furnitureReplacement: number;
  // No duplicated/cloned furniture (100 = none duplicated).
  duplication: number;
  // Whole room still visible (100 = no cropping/zoom/reframe).
  crop: number;
  overall: number;
  recommendation: ReviewRecommendation;
};

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

type ReviewAxes = Omit<QualityReview, "overall" | "recommendation">;

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
 * The reviewer's verdict. Regenerate if any critical failure occurred —
 * duplicated furniture, wrong placement, a missing/unreplaced product, or
 * changed architecture — or if the weighted overall is below threshold.
 */
export function decideRecommendation(
  axes: ReviewAxes,
  overall: number,
  threshold = REVIEW_THRESHOLD,
  criticalThreshold = CRITICAL_AXIS_THRESHOLD
): ReviewRecommendation {
  const objectDuplicated = axes.duplication < criticalThreshold;
  const wrongPlacement = axes.placementAccuracy < criticalThreshold;
  const productMissing =
    axes.productAccuracy < criticalThreshold ||
    axes.furnitureReplacement < criticalThreshold;
  const architectureChanged =
    axes.architecture < criticalThreshold ||
    axes.roomPreservation < criticalThreshold;

  if (
    objectDuplicated ||
    wrongPlacement ||
    productMissing ||
    architectureChanged ||
    overall < threshold
  ) {
    return "regenerate";
  }
  return "accept";
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

/** Human-readable summary of the plan the generated image must satisfy. */
export function formatPlanForReview(plan?: ReplacementPlan): string {
  if (!plan) return "";
  const lines: string[] = [];
  for (const task of plan.replacements) {
    lines.push(
      `- The existing ${task.existingCategory} should be REPLACED by the ${task.productTitle} (${task.placement}).`
    );
  }
  for (const task of plan.additions) {
    lines.push(
      `- The ${task.productTitle} should be PLACED at ${task.target}.`
    );
  }
  const preserved =
    plan.preserved.length > 0
      ? `\nThese must be UNCHANGED (present, in the same place, not restyled): ${plan.preserved.join(", ")}.`
      : "";
  if (lines.length === 0 && !preserved) return "";
  return `EXPECTED CHANGES (the generated image must show exactly these and nothing else):\n${lines.join("\n")}${preserved}`;
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

const REVIEW_PROMPT = `You are a STRICT interior-render quality reviewer. The FIRST image is the customer's ORIGINAL room. The SECOND image is an AI-generated redesign that was supposed to execute a specific replacement plan while keeping the rest of the room identical.

Compare the two images against the expected changes and rate the generated image 0-100 on EACH axis. Return ONLY JSON with EXACTLY these keys:
{
  "roomPreservation": number,      // original walls, floor and ceiling preserved
  "perspective": number,           // same camera angle / vanishing point as the original
  "lighting": number,              // same lighting direction, colour and intensity
  "productAccuracy": number,       // placed products match the intended products (colour, material, shape)
  "placementAccuracy": number,     // products are where the plan said (correct item replaced / correct zone)
  "scale": number,                 // realistic furniture proportions and clearances
  "architecture": number,          // windows, doors and structure NOT moved or reshaped (100 = untouched)
  "furnitureReplacement": number,  // the planned items were actually replaced/placed (100 = all done, 0 = missing)
  "duplication": number,           // NO duplicated or cloned furniture (100 = none, 0 = obvious duplicates)
  "cropping": number               // whole room still visible (100 = no cropping/zoom/reframe)
}
Be critical. Score an axis LOW (below 60) when: furniture is duplicated (duplication), a product is in the wrong place or the wrong item changed (placementAccuracy), a planned product is missing or was not replaced (furnitureReplacement/productAccuracy), or any wall/window/door/structure changed (architecture/roomPreservation). Reserve 85+ for genuinely excellent results.`;

export async function reviewGeneratedRoom(input: {
  generatedBase64: string;
  generatedMimeType?: string;
  roomImage: File;
  replacementPlan?: ReplacementPlan;
  apiKey?: string;
}): Promise<QualityReview | null> {
  const apiKey = input.apiKey?.trim();
  if (!apiKey || !input.generatedBase64) return null;

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

    if (!response.ok) return null;

    const data = (await response.json().catch(() => null)) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    } | null;
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();
    if (!text) return null;

    const parsed = extractJsonObject(text);
    if (!parsed) return null;

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
    const overall = computeReviewOverall(axes);
    const recommendation = decideRecommendation(axes, overall);

    return { ...axes, overall, recommendation };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
