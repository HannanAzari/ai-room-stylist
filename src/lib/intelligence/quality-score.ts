/**
 * Consistency / quality score (Phase 5).
 *
 * Scores a generated room against the original photo and the selected products
 * on perspective, lighting, scale, product similarity and realism. The route
 * uses `meetsQualityThreshold` to auto-regenerate low-quality results and keep
 * the best attempt.
 *
 * Fully fallback-safe: if scoring is unavailable it returns null and the route
 * accepts the generated image as-is.
 */
const SCORING_MODEL = "gemini-2.5-flash";
const SCORING_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${SCORING_MODEL}:generateContent`;
const SCORING_TIMEOUT_MS = 12_000;

// Overall score (0–100) at/above which a result is accepted without retrying.
export const QUALITY_THRESHOLD = 70;

export type QualityScore = {
  perspective: number;
  lighting: number;
  scale: number;
  productSimilarity: number;
  realism: number;
  overall: number;
};

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function computeOverall(
  partial: Omit<QualityScore, "overall">
): number {
  // Weight room fidelity (perspective) and realism most heavily.
  const weighted =
    partial.perspective * 0.28 +
    partial.realism * 0.24 +
    partial.scale * 0.18 +
    partial.productSimilarity * 0.18 +
    partial.lighting * 0.12;
  return Math.round(weighted);
}

export function meetsQualityThreshold(
  score: QualityScore | null,
  threshold = QUALITY_THRESHOLD
): boolean {
  // No score available (scoring disabled/failed) → do not block generation.
  if (!score) return true;
  return score.overall >= threshold;
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

const SCORING_PROMPT = `You are a strict interior-render quality auditor. The FIRST image is the customer's original room; the SECOND image is an AI-generated redesign that should place the listed products while preserving the original room.

Rate the generated image 0-100 on each axis and return ONLY JSON:
{
  "perspective": number,        // how well the original camera/room geometry is preserved
  "lighting": number,           // believable, consistent lighting
  "scale": number,              // realistic furniture proportions & clearances
  "productSimilarity": number,  // how well placed products match the intended products
  "realism": number             // overall photorealism (no distortion/artefacts)
}
Be critical; reserve 85+ for genuinely excellent results.`;

export async function scoreRoomImage(input: {
  generatedBase64: string;
  generatedMimeType?: string;
  roomImage: File;
  productSummary?: string;
  apiKey?: string;
}): Promise<QualityScore | null> {
  const apiKey = input.apiKey?.trim();
  if (!apiKey || !input.generatedBase64) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCORING_TIMEOUT_MS);

  try {
    const roomPart = await fileToInlineData(input.roomImage);
    const generatedPart = {
      inline_data: {
        mime_type: input.generatedMimeType || "image/png",
        data: input.generatedBase64,
      },
    };
    const promptText = input.productSummary
      ? `${SCORING_PROMPT}\n\nIntended products: ${input.productSummary}`
      : SCORING_PROMPT;

    const response = await fetch(SCORING_ENDPOINT, {
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

    const partial = {
      perspective: clampScore(parsed.perspective),
      lighting: clampScore(parsed.lighting),
      scale: clampScore(parsed.scale),
      productSimilarity: clampScore(parsed.productSimilarity),
      realism: clampScore(parsed.realism),
    };

    return { ...partial, overall: computeOverall(partial) };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
