/**
 * One localized crop edit against Gemini.
 *
 * Deliberately narrow: a prompt, one crop, that product's references, and the
 * crop's own aspect ratio. It knows nothing about rooms, masks or other edits —
 * the orchestrator owns all of that — which is what lets several of these run
 * concurrently without sharing state.
 *
 * Retry policy differs from the single-call few-shot path on purpose. Several
 * of these run in parallel and each one carries real spend, so a fast 429/503
 * on one edit is retried once rather than throwing away the sibling renders
 * that already succeeded. A TIMEOUT is still never retried: the provider is
 * saturated and a second long wait only pushes the whole request past its
 * budget.
 */
import { ProviderBusyError } from "./gemini-few-shot";

const DEFAULT_MODEL = "gemini-3-pro-image";

export type LocalizedEditRequest = {
  /** Stable id for logging and failure reporting, e.g. the task id. */
  id: string;
  prompt: string;
  cropJpeg: Buffer;
  /** The crop's true ratio, so nothing is stretched. */
  aspectRatio: string;
  references: Array<{ mimeType: string; data: Buffer }>;
  apiKey: string;
  /** Hard per-attempt ceiling. */
  timeoutMs: number;
  /** Absolute wall-clock deadline shared by every edit in the request. */
  deadline: number;
  /** One retry on a fast 429/503 when true. Never applies to timeouts. */
  allowRetry: boolean;
};

export type LocalizedEditSuccess = {
  id: string;
  image: Buffer;
  latencyMs: number;
  attempts: number;
};

export function localizedModel(): string {
  return process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_MODEL;
}

const RETRY_BACKOFF_MS = 1_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function generateLocalizedEdit(
  request: LocalizedEditRequest
): Promise<LocalizedEditSuccess> {
  const parts: Array<Record<string, unknown>> = [
    { text: request.prompt },
    { inline_data: { mime_type: "image/jpeg", data: request.cropJpeg.toString("base64") } },
    ...request.references.map((reference) => ({
      inline_data: { mime_type: reference.mimeType, data: reference.data.toString("base64") },
    })),
  ];

  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: request.aspectRatio },
    },
  });

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${localizedModel()}:generateContent`;
  const maxAttempts = request.allowRetry ? 2 : 1;
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remaining = request.deadline - Date.now();
    if (remaining <= 0) {
      throw new ProviderBusyError(
        "provider_timeout",
        `Ran out of time before the ${request.id} edit could complete. Please try again.`
      );
    }
    attempts = attempt;

    const startedAt = Date.now();
    let response: Response;
    let raw: string;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": request.apiKey },
        body,
        signal: AbortSignal.timeout(Math.min(request.timeoutMs, remaining)),
      });
      raw = await response.text();
    } catch (error) {
      const aborted =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      if (aborted) {
        // Saturated provider. Retrying buys another long wait for nobody.
        throw new ProviderBusyError(
          "provider_timeout",
          "The image provider did not respond in time. Please try again in a moment."
        );
      }
      throw error;
    }
    const latencyMs = Date.now() - startedAt;

    if (response.ok) {
      const data = JSON.parse(raw) as {
        candidates?: Array<{
          content?: { parts?: Array<Record<string, { data?: string; mimeType?: string; mime_type?: string }>> };
        }>;
      };
      const part = data.candidates?.[0]?.content?.parts?.find(
        (candidate) => candidate.inlineData || candidate.inline_data
      );
      const inline = part?.inlineData || part?.inline_data;
      if (!inline?.data) {
        throw new Error(`The ${request.id} edit completed without an image.`);
      }
      return { id: request.id, image: Buffer.from(inline.data, "base64"), latencyMs, attempts };
    }

    const transient = response.status === 429 || response.status >= 500;
    if (!transient) {
      const message = (() => {
        try {
          return (JSON.parse(raw) as { error?: { message?: string } }).error?.message;
        } catch {
          return null;
        }
      })();
      throw new Error(message || `The ${request.id} edit failed with status ${response.status}.`);
    }

    if (attempt < maxAttempts && request.deadline - Date.now() > RETRY_BACKOFF_MS) {
      await sleep(RETRY_BACKOFF_MS);
      continue;
    }

    throw new ProviderBusyError(
      "provider_busy",
      response.status === 429
        ? "The image provider is rate limited right now. Please try again in a moment."
        : "The image provider is at capacity right now. Please try again in a moment."
    );
  }

  throw new ProviderBusyError("provider_busy", "The image provider is unavailable right now.");
}
