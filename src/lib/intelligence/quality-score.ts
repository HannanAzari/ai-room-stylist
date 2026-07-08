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
  // Walls, windows, doors, ceiling, floor and camera preserved from the photo.
  roomPreservation: number;
  // Placed products match the intended Koala products.
  productSimilarity: number;
  // Whole room visible — not cropped, zoomed or reframed.
  fullRoomVisible: number;
  // Realistic furniture proportions and clearances.
  furnitureScale: number;
  // Overall photorealism (no distortion/artefacts, believable lighting).
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
  // Room fidelity and full-room framing are the tuning priorities, so they
  // carry the most weight.
  const weighted =
    partial.roomPreservation * 0.3 +
    partial.fullRoomVisible * 0.22 +
    partial.realism * 0.2 +
    partial.furnitureScale * 0.16 +
    partial.productSimilarity * 0.12;
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
  "roomPreservation": number,   // are the ORIGINAL walls, windows, doors, ceiling, floor and camera angle preserved? penalise any architectural change
  "productSimilarity": number,  // do the placed products match the intended products (colour, material, shape)?
  "fullRoomVisible": number,    // is the WHOLE room still visible? penalise cropping, zooming or reframing vs the original
  "furnitureScale": number,     // realistic furniture proportions and clearances
  "realism": number             // overall photorealism, believable lighting, no distortion/artefacts
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
      roomPreservation: clampScore(parsed.roomPreservation),
      productSimilarity: clampScore(parsed.productSimilarity),
      fullRoomVisible: clampScore(parsed.fullRoomVisible),
      furnitureScale: clampScore(parsed.furnitureScale),
      realism: clampScore(parsed.realism),
    };

    return { ...partial, overall: computeOverall(partial) };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
