/**
 * Dev-only AI evaluation log (Phase 1 of AI-quality tuning).
 *
 * For each generation we persist an evaluation record locally (never sent
 * externally) so the hidden admin view can review room analysis, prompts and
 * quality scores across real test cases. Only populated when AI debug is on.
 */
import type { RoomAnalysis } from "@/lib/intelligence/room-analysis";
import type { QualityScore } from "@/lib/intelligence/quality-score";

export const AI_EVAL_STORAGE_KEY = "koala-ai-studio:ai-eval-log";
const MAX_RECORDS = 10;

export type AiEvalProductRef = { id: string; name: string; category: string };

export type AiEvalRecord = {
  timestamp: string;
  roomType: string;
  style: string;
  roomHash: string;
  roomThumbnail: string | null;
  selectedProducts: AiEvalProductRef[];
  provider: string | null;
  roomAnalysis: RoomAnalysis | null;
  prompt: string | null;
  imageHash: string | null;
  qualityScore: QualityScore | null;
  generationAttempts: number;
  autoRegenerated: boolean;
  referenceViewCount: number;
  failureReason: string | null;
};

// Small, stable hash for identifying a room photo / generated image without
// storing the payload.
export function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return `${(hash >>> 0).toString(16)}_${value.length}`;
}

/**
 * Downscales an image File to a tiny JPEG thumbnail and derives a hash from it.
 * Client-only (uses canvas). Returns nulls on failure.
 */
export async function fingerprintRoomImage(
  file: File | null
): Promise<{ hash: string; thumbnail: string | null }> {
  if (!file || typeof document === "undefined") {
    return { hash: "unknown", thumbnail: null };
  }

  try {
    const bitmapUrl = URL.createObjectURL(file);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = bitmapUrl;
    });

    const maxSize = 96;
    const scale = Math.min(maxSize / image.width, maxSize / image.height, 1);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.drawImage(image, 0, 0, width, height);
    URL.revokeObjectURL(bitmapUrl);

    const thumbnail = canvas.toDataURL("image/jpeg", 0.6);
    return { hash: hashString(thumbnail), thumbnail };
  } catch {
    return { hash: `size_${file.size}`, thumbnail: null };
  }
}

export function getAiEvalRecords(): AiEvalRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(AI_EVAL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAiEvalRecord(record: AiEvalRecord): void {
  if (typeof window === "undefined") return;
  try {
    const next = [record, ...getAiEvalRecords()].slice(0, MAX_RECORDS);
    window.localStorage.setItem(AI_EVAL_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Never let debug logging interrupt generation.
  }
}

export function clearAiEvalRecords(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(AI_EVAL_STORAGE_KEY);
  } catch {
    // ignore
  }
}
