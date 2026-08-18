/**
 * GPT Image 2 — the room-editing renderer.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS ALONGSIDE THE GEMINI PROVIDER
 * ---------------------------------------------------------------------------
 * This is a straight provider swap for the room-edit path, not a rewrite of the
 * pipeline. Everything upstream — the scene graph, the replacement contract, the
 * plan, the prompt and the reference manifest — is provider-agnostic and
 * unchanged. Only the call that turns "prompt + room photo + product
 * references" into pixels moves, so the two providers can be compared on
 * identical inputs by flipping one environment variable.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS GENUINELY DIFFERENT ABOUT THIS PROVIDER
 * ---------------------------------------------------------------------------
 * 1. It is a real EDIT endpoint (`images.edit`), not a text-to-image call with
 *    pictures attached. The room photo is the first element of `image`, which
 *    the API treats as the canvas being edited — much stronger grounding than
 *    the Gemini path could get, where the room was one inline blob among
 *    several and had to be identified in prose.
 *
 * 2. There are NO interleaved text parts. Gemini's payload alternates
 *    text/image/text/image, so each reference could be introduced by a line
 *    naming its task. `images.edit` takes a flat array of images and ONE
 *    prompt, so the labels the reference manifest produces have to be carried
 *    inside the prompt as a numbered index instead. Losing that binding
 *    silently is exactly how a product ends up in the wrong task, so the index
 *    is built from the same manifest labels and states the ordering explicitly.
 *
 * 3. High-fidelity treatment of the input images is what keeps the customer's
 *    room recognisable — the whole product depends on the output still being a
 *    photo of THEIR room. On gpt-image-1/1.5 that had to be asked for with
 *    `input_fidelity: "high"`. GPT Image 2 does it automatically and REJECTS
 *    the parameter outright (400: "does not support the 'input_fidelity'
 *    parameter"), so it is sent only to the models that document it — see
 *    MODELS_SUPPORTING_INPUT_FIDELITY.
 *
 * The room photo counts toward the 16-image limit, so references are capped at
 * 15; in practice the reference manifest's own budget (5) binds first.
 */
import { openai } from "@/lib/openai";
import { supportsInputFidelity } from "./gpt-image-capabilities";
import type {
  GeneratedImageResult,
  ImageProviderInput,
  LabelledProductImage,
} from "./types";

/**
 * The model id. `gpt-image-2` tracks the latest snapshot; pin the dated id via
 * `GPT_IMAGE_MODEL` if a render regression ever needs to be bisected.
 */
export const DEFAULT_GPT_IMAGE_MODEL = "gpt-image-2";

/**
 * Cap applied ONLY to unlabelled `productImages` from the legacy routes, which
 * carry no manifest budget of their own. The studio path sends
 * `labelledProductImages`, already budgeted by the reference manifest, and
 * those must never be re-truncated here — that silently drops a selected
 * product's only reference.
 */
const MAX_LEGACY_PRODUCT_IMAGES = 4;

/** The API accepts 16 images; the room photo occupies one of them. */
const MAX_TOTAL_IMAGES = 16;

/** Extra attempts for transient provider failures (5xx / 429). */
const MAX_TRANSIENT_RETRIES = 2;
const TRANSIENT_RETRY_BASE_MS = 800;

export function getGptImageConfiguration() {
  const apiKey = process.env.OPENAI_API_KEY?.trim() || "";
  const model = process.env.GPT_IMAGE_MODEL?.trim() || DEFAULT_GPT_IMAGE_MODEL;
  /**
   * Landscape by default: rooms are photographed wide, and a square output
   * would either crop the room or letterbox it — both of which break the
   * "this is still your room" promise the whole flow rests on.
   */
  const size = process.env.GPT_IMAGE_SIZE?.trim() || "1536x1024";
  const quality = process.env.GPT_IMAGE_QUALITY?.trim() || "high";

  return {
    apiKey,
    model,
    size,
    quality,
    available: Boolean(apiKey),
  };
}

/**
 * The reference index.
 *
 * `images.edit` has one prompt and one flat image array, so the only way to
 * bind image N to task N is to describe the ordering in words. The labels come
 * from the reference manifest verbatim — the same strings the Gemini path used
 * as inline text parts — so both providers make the same claims about which
 * image serves which task, including the "one image, two separate pieces" case.
 */
function buildImageIndex(references: LabelledProductImage[]): string {
  if (references.length === 0) {
    return [
      "IMAGE INPUTS:",
      "- Image 1 is the customer's real room. It is the canvas you are editing and the ground truth for camera, framing, lighting and architecture.",
      "- No product reference images were supplied.",
    ].join("\n");
  }

  const lines = references.map((reference, index) => {
    // Position is 2-based: image 1 is always the room.
    const label = reference.label || "product reference (unlabelled)";
    return `- Image ${index + 2}: ${label}`;
  });

  return [
    "IMAGE INPUTS — the images are supplied in this exact order:",
    "- Image 1: the customer's real room. It is the canvas you are editing and the ground truth for camera, framing, lighting and architecture. It is NOT a product reference.",
    ...lines,
    `Use each product image ONLY for the task(s) its line names above. Never swap a product between tasks, and never treat image 1 as a product. Where one image is named for more than one task, that image must produce a separate piece of furniture for EACH of those tasks.`,
  ].join("\n");
}

/** Provider-specific framing appended to the shared, provider-agnostic prompt. */
function buildGptImagePrompt(
  prompt: string,
  references: LabelledProductImage[]
): string {
  return `${prompt}

${buildImageIndex(references)}

EDITING PRIORITIES:
- You are EDITING image 1, not generating a new room. Everything the plan does not name must survive the edit pixel-for-pixel.
- Preserve the camera, framing, perspective, lighting, walls, ceiling, floor, windows, doors and room proportions of image 1 exactly.
- Do not crop, zoom, pan, straighten or re-frame. The finished image shows the same extent of the room as image 1.
- Reproduce each supplied product faithfully from its reference image: same shape, colour, material, finish and proportions.
- Photorealistic interior photography — natural light, believable materials, correct furniture scale and contact with the floor.
- Carry out EVERY numbered task. Partial completion is a failure even if the result looks plausible.`;
}

/** Is this an error the provider is likely to recover from on a retry? */
function isTransientError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return typeof status === "number" && (status >= 500 || status === 429);
}

export async function generateGptImage({
  prompt,
  roomImage,
  productImages,
  labelledProductImages,
  apiKey: suppliedApiKey,
}: ImageProviderInput): Promise<GeneratedImageResult> {
  const configuration = getGptImageConfiguration();
  const apiKey = suppliedApiKey?.trim() || configuration.apiKey;

  if (!apiKey) {
    throw new Error(
      "GPT Image provider is not configured. Set OPENAI_API_KEY."
    );
  }

  // See MAX_LEGACY_PRODUCT_IMAGES: manifest-budgeted references are sent in
  // full; only the unlabelled legacy path is capped here.
  const references: LabelledProductImage[] =
    labelledProductImages && labelledProductImages.length > 0
      ? labelledProductImages.slice(0, MAX_TOTAL_IMAGES - 1)
      : productImages
          .slice(0, MAX_LEGACY_PRODUCT_IMAGES)
          .map((file) => ({ label: "", file }));

  const client = suppliedApiKey ? openai.withOptions({ apiKey }) : openai;

  /**
   * Retry transient server errors.
   *
   * A 5xx or a rate limit fails a generation the customer has already waited
   * a minute for, and usually succeeds on an immediate retry. A 4xx is our own
   * malformed request; repeating it would only waste time and money.
   */
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_TRANSIENT_RETRIES + 1; attempt += 1) {
    try {
      const result = await client.images.edit({
        model: configuration.model,
        // Image 1 is the room being edited; the references follow, in the
        // order the prompt's index describes.
        image: [roomImage, ...references.map((reference) => reference.file)],
        prompt: buildGptImagePrompt(prompt, references),
        size: configuration.size as "1024x1024",
        quality: configuration.quality as "high",
        // Spread, not a literal: the key must be ABSENT for GPT Image 2, which
        // 400s on its mere presence. `input_fidelity: undefined` would still
        // serialise the field on some transports, so the property is never
        // created in the first place.
        ...(supportsInputFidelity(configuration.model)
          ? { input_fidelity: "high" as const }
          : {}),
        n: 1,
      });

      const imageBase64 = result.data?.[0]?.b64_json;
      if (!imageBase64) {
        throw new Error("GPT Image generation completed without an image.");
      }

      return {
        provider: "gpt-image",
        label: "GPT Image 2",
        imageBase64,
        mimeType: "image/png",
        b64_json: imageBase64,
      };
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt === MAX_TRANSIENT_RETRIES) break;
      await new Promise((resolve) =>
        setTimeout(resolve, TRANSIENT_RETRY_BASE_MS * (attempt + 1))
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("GPT Image generation failed.");
}

export { supportsInputFidelity } from "./gpt-image-capabilities";
