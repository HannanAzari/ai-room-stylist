/**
 * Few-shot room edit: one Gemini call, room-matched aspect, no reviewer.
 *
 * Separate from `gemini.ts` on purpose. That provider carries the grounding
 * path's contract — a manifest-sized reference budget, its own prompt preamble,
 * and a deliberate absence of aspect conditioning. This one encodes the
 * opposite choices, all of them measured:
 *
 *  - `imageConfig.aspectRatio` IS sent, matched to the room. Without it a 4:3
 *    room came back 1024x1024, and the model re-framed the shot — panning the
 *    ceiling fan, air conditioner and TV well off their real positions. With it,
 *    untouched regions of the room measured at JPEG-noise level (3-5 mean
 *    absolute difference) against the original.
 *  - No prompt preamble is appended. The caller's prompt is the whole prompt.
 *  - Two references per product, sent verbatim.
 *
 * Retry policy is fail-fast by design — see RETRY POLICY below.
 */
import sharp from "sharp";
import { nearestAspectRatio } from "./gemini";
import type { GeneratedImageResult, LabelledProductImage } from "./types";
import type { TimingsCollector } from "@/lib/generation-timings";

const DEFAULT_MODEL = "gemini-3-pro-image";

/**
 * The renderer id this path reports. Must stay one of the ids the studio
 * client accepts — see `studio-gemini-api.ts`.
 */
export const FEW_SHOT_RENDERER_ID = "gemini";

/**
 * ---------------------------------------------------------------------------
 * RETRY POLICY
 * ---------------------------------------------------------------------------
 * This endpoint fails in two very different ways and the old policy treated
 * them alike:
 *
 *  1. Fast transient rejection — HTTP 429/503, returned in under a second.
 *     Retrying costs almost nothing and often succeeds.
 *  2. Slow capacity stall — the connection is held open. A single call was
 *     measured at 295 s against a route `maxDuration` of 300 s.
 *
 * The previous behaviour (2 retries, 800/1600 ms backoff, no request timeout)
 * adds only ~2.4 s, so it never caused the multi-minute waits. Case 2 did: one
 * call can consume the entire route budget while the customer stares at a
 * spinner with no way out.
 *
 * So the deadline, not the retry count, is the control that matters:
 *  - Every attempt gets a hard per-request timeout.
 *  - At most ONE retry, and only for a fast 429/503. A timeout is NOT retried —
 *    the provider is saturated, and a second long wait helps nobody.
 *  - A total wall-clock budget bounds the whole thing regardless.
 *  - On exhaustion we throw `ProviderBusyError`, which the route turns into a
 *    retryable state so the UI can offer a button instead of hanging.
 *
 * The timeout is set from OUR OWN successful few-shot renders, not from a round
 * number: Kelly completed in 105s and Elva in 94s. A 75s cut-off would have
 * killed both. 120s clears the slowest measured success with headroom, and the
 * 140s total budget still leaves 160s of the 300s route budget for the response.
 *
 * A retry is not squeezed by this: the only failures that reach it are fast
 * ones, so a 429 returned in a second leaves the retry a full 120s slice. A
 * first attempt slow enough to eat the budget is a timeout, which does not
 * retry at all.
 *
 * All three numbers are env-tunable so this can be relaxed without a deploy.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_TOTAL_BUDGET_MS = 140_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 1_000;

/** A capacity failure the customer can usefully retry. Not a bug. */
export class ProviderBusyError extends Error {
  readonly retryable = true;
  readonly reason: "provider_busy" | "provider_timeout";

  constructor(reason: "provider_busy" | "provider_timeout", message: string) {
    super(message);
    this.name = "ProviderBusyError";
    this.reason = reason;
  }
}

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name]?.trim() || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function fewShotModel(): string {
  return process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_MODEL;
}

export type FewShotGenerateInput = {
  /** The complete prompt. Nothing is appended to it. */
  prompt: string;
  roomImage: File;
  /** Label immediately preceding the room image. */
  roomLabel: string;
  /** Two per product, each with its own preceding label. */
  references: LabelledProductImage[];
  apiKey: string;
  timings: TimingsCollector;
};

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

async function toInlineData(file: File): Promise<GeminiPart> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return { inline_data: { mime_type: file.type, data: buffer.toString("base64") } };
}

export async function generateFewShotRoomEdit(
  input: FewShotGenerateInput
): Promise<GeneratedImageResult & { aspectRatio: string; attempts: number }> {
  const { prompt, roomImage, roomLabel, references, apiKey, timings } = input;

  if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");

  // Room preprocessing: measure the photo's real aspect so the output keeps the
  // customer's framing. `.rotate()` applies the EXIF orientation first — a
  // portrait phone photo reports landscape dimensions without it.
  const aspectRatio = await timings.measure("room-preprocess", async () => {
    try {
      const metadata = await sharp(Buffer.from(await roomImage.arrayBuffer()))
        .rotate()
        .metadata();
      return nearestAspectRatio(metadata.width ?? 0, metadata.height ?? 0);
    } catch {
      return "4:3";
    }
  });

  const body = await timings.measure("reference-prepare", async () => {
    const parts: GeminiPart[] = [{ text: prompt }, { text: roomLabel }, await toInlineData(roomImage)];
    for (const reference of references) {
      if (reference.label) parts.push({ text: reference.label });
      parts.push(await toInlineData(reference.file));
    }
    return JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio },
      },
    });
  });

  const requestTimeoutMs = envInt("FEW_SHOT_REQUEST_TIMEOUT_MS", DEFAULT_REQUEST_TIMEOUT_MS);
  const totalBudgetMs = envInt("FEW_SHOT_TOTAL_BUDGET_MS", DEFAULT_TOTAL_BUDGET_MS);
  const maxAttempts = envInt("FEW_SHOT_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS);
  const deadline = Date.now() + totalBudgetMs;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${fewShotModel()}:generateContent`;

  let attempts = 0;
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    attempts = attempt;
    timings.recordProviderAttempt();

    let response: Response;
    let raw: string;
    const requestStartedAt = Date.now();
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
        // Whichever runs out first: this attempt's slice or the total budget.
        signal: AbortSignal.timeout(Math.min(requestTimeoutMs, remaining)),
      });
      raw = await response.text();
    } catch (error) {
      timings.add("provider-request", Date.now() - requestStartedAt);
      // A timeout means the provider is saturated. Retrying buys another long
      // wait, so this ends the attempt loop rather than continuing it.
      const aborted = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      if (aborted) {
        throw new ProviderBusyError(
          "provider_timeout",
          "The image provider did not respond in time. Please try again in a moment."
        );
      }
      throw error;
    }
    timings.add("provider-request", Date.now() - requestStartedAt);

    if (response.ok) {
      const data = JSON.parse(raw) as {
        candidates?: Array<{ content?: { parts?: Array<Record<string, { data?: string; mimeType?: string; mime_type?: string }>> } }>;
      };
      const part = data.candidates?.[0]?.content?.parts?.find(
        (candidate) => candidate.inlineData || candidate.inline_data
      );
      const inline = part?.inlineData || part?.inline_data;
      if (!inline?.data) throw new Error("Gemini generation completed without an image.");

      return {
        /**
         * The RENDERER's id, not the strategy's.
         *
         * This field answers "which image provider produced this", and the
         * answer is Gemini — few-shot is a prompt/reference strategy that runs
         * on top of it. Returning "gemini-few-shot" here made the client's
         * `assertStudioGeminiProvider` allowlist ({gpt-image, gemini}) throw
         * "Unknown studio image provider" AFTER the render had already been
         * paid for, discarding a successful image. The strategy is reported
         * where it belongs, in `aiDebug.strategy`.
         */
        provider: FEW_SHOT_RENDERER_ID,
        label: "Gemini",
        imageBase64: inline.data,
        mimeType: inline.mimeType || inline.mime_type || "image/png",
        b64_json: inline.data,
        aspectRatio,
        attempts,
      };
    }

    lastStatus = response.status;
    const fastTransient = response.status === 429 || response.status >= 500;
    if (!fastTransient) {
      const message = (() => {
        try {
          return (JSON.parse(raw) as { error?: { message?: string } }).error?.message;
        } catch {
          return null;
        }
      })();
      throw new Error(message || `Gemini image generation failed with status ${response.status}.`);
    }

    if (attempt < maxAttempts && deadline - Date.now() > RETRY_BACKOFF_MS) {
      await timings.measure("provider-wait", async () => {
        await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
      });
    }
  }

  throw new ProviderBusyError(
    "provider_busy",
    lastStatus === 429
      ? "The image provider is rate limited right now. Please try again in a moment."
      : "The image provider is at capacity right now. Please try again in a moment."
  );
}
