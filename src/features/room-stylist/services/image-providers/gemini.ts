import sharp from "sharp";
import type {
  GeneratedImageResult,
  ImageProviderInput,
  LabelledProductImage,
} from "./types";

/**
 * The Gemini image model.
 *
 * Env-configurable, matching how the GPT provider already works. It was pinned
 * to gemini-2.5-flash-image, but this key can reach gemini-3-pro-image and the
 * 3.1 flash family — so benchmarking the best available model required a code
 * change rather than a setting, which is the wrong way round.
 *
 * The default stays 2.5-flash-image so this change alters no existing
 * behaviour; set GEMINI_IMAGE_MODEL to opt into another.
 */
export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3-pro-image";

/**
 * Aspect ratios the image API accepts, with their decimal value.
 *
 * The room's own ratio is mapped to the nearest of these and sent as
 * `imageConfig.aspectRatio`. Without it the model infers an aspect from the
 * inputs — and because every product reference is a 1000x1000 studio square,
 * a request carrying the room plus nine references came back 1024x1024, i.e.
 * the customer's 4:3 room cropped to a square. Measured directly: the same
 * prompt with `aspectRatio: "4:3"` returns 1200x896.
 */
const SUPPORTED_ASPECT_RATIOS: Array<{ label: string; value: number }> = [
  { label: "1:1", value: 1 },
  { label: "2:3", value: 2 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "3:4", value: 3 / 4 },
  { label: "4:3", value: 4 / 3 },
  { label: "4:5", value: 4 / 5 },
  { label: "5:4", value: 5 / 4 },
  { label: "9:16", value: 9 / 16 },
  { label: "16:9", value: 16 / 9 },
  { label: "21:9", value: 21 / 9 },
];

/** Nearest supported ratio to the room photo's own. */
export function nearestAspectRatio(width: number, height: number): string {
  if (!width || !height) return "4:3";
  const actual = width / height;
  return SUPPORTED_ASPECT_RATIOS.reduce((best, candidate) =>
    Math.abs(candidate.value - actual) < Math.abs(best.value - actual)
      ? candidate
      : best
  ).label;
}

function geminiImageModel(): string {
  return process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_GEMINI_IMAGE_MODEL;
}

function geminiImageEndpoint(): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${geminiImageModel()}:generateContent`;
}
/**
 * Cap applied ONLY to unlabelled `productImages` from the legacy routes. The
 * studio path passes `labelledProductImages`, whose budget is decided by the
 * reference manifest — this constant must never truncate those, or selected
 * products silently lose their reference again.
 */
const MAX_GEMINI_PRODUCT_IMAGES = 2;
/** Extra attempts for transient provider failures (5xx / 429). */
const MAX_TRANSIENT_RETRIES = 2;
const TRANSIENT_RETRY_BASE_MS = 800;

type GeminiInlineData = {
  data?: string;
  mimeType?: string;
  mime_type?: string;
};

type GeminiResponsePart = {
  inlineData?: GeminiInlineData;
  inline_data?: GeminiInlineData;
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiResponsePart[];
    };
  }>;
  error?: {
    message?: string;
  };
};

async function fileToInlineData(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());

  return {
    inline_data: {
      mime_type: file.type,
      data: buffer.toString("base64"),
    },
  };
}

export function getGeminiImageConfiguration() {
  const enabled = process.env.ENABLE_GEMINI_IMAGE?.toLowerCase() === "true";
  const apiKey = process.env.GEMINI_API_KEY?.trim() || "";

  return {
    enabled,
    apiKey,
    available: enabled && Boolean(apiKey),
  };
}

export async function generateGeminiImage({
  prompt,
  roomImage,
  productImages,
  labelledProductImages,
  apiKey: suppliedApiKey,
}: ImageProviderInput): Promise<GeneratedImageResult> {
  const configuration = getGeminiImageConfiguration();
  const apiKey = suppliedApiKey?.trim() || configuration.apiKey;
  const available = suppliedApiKey
    ? Boolean(apiKey)
    : configuration.available;

  if (!available) {
    throw new Error("Gemini image provider is not configured.");
  }

  // The studio path supplies labelled references from the reference manifest,
  // which has already applied the count/byte budget — so they are sent in full
  // rather than re-truncated here. Legacy routes still pass plain files, which
  // keep the historical cap.
  const references: LabelledProductImage[] =
    labelledProductImages && labelledProductImages.length > 0
      ? labelledProductImages
      : productImages
          .slice(0, MAX_GEMINI_PRODUCT_IMAGES)
          .map((file) => ({ label: "", file }));

  // Each product image is preceded by its own text part naming the product and
  // its plan task, so the model is never left guessing which image is which.
  /**
   * The room's own aspect ratio, read from its pixels rather than assumed.
   * Falls back to 4:3 if the image cannot be measured — never to square, which
   * is the one outcome that always crops a landscape room.
   */
  let aspectRatio = "4:3";
  try {
    const metadata = await sharp(
      Buffer.from(await roomImage.arrayBuffer())
    ).rotate().metadata();
    aspectRatio = nearestAspectRatio(metadata.width ?? 0, metadata.height ?? 0);
  } catch {
    // Keep the default.
  }

  const roomPart = await fileToInlineData(roomImage);
  const referenceParts: Array<
    { text: string } | { inline_data: { mime_type: string; data: string } }
  > = [];
  for (const reference of references) {
    if (reference.label) referenceParts.push({ text: reference.label });
    referenceParts.push(await fileToInlineData(reference.file));
  }

  const imageParts = [
    {
      text: "ROOM REFERENCE — the customer's real room. Preserve this camera, framing, lighting and architecture exactly.",
    },
    roomPart,
    ...referenceParts,
  ];
  const geminiPrompt = `${prompt}

Gemini image editing priorities:
- The image that follows the "ROOM REFERENCE" line is the fixed room and camera reference.
- Every later image is preceded by a line naming its product and its task number. Use each product image ONLY for the task named in the line directly above it; never swap a product between tasks.
- Preserve the full visible room, camera angle, walls, ceiling, floor, windows, TV location, and room proportions.
- Do not crop closer, zoom in, or change the camera perspective.
- Keep the whole room visible in the finished image.
- Prioritise photorealistic interior photography with natural lighting, believable materials, and realistic furniture scale.
- Make supplied product references visually clear, recognisable, and naturally placed.
- Follow the AI concept mode instructions exactly; do not make unrelated changes when that mode is OFF.

NOTHING MAY BE ADDED TO THIS ROOM.
- Do NOT add plants, pots or greenery of any kind. This is the single most common unrequested addition; a plant that was not in the original photo is a failed render.
- Do NOT add decor, vases, bowls, trays, books, candles, cushions, throws or ornaments.
- Do NOT add any furniture beyond the numbered tasks — no side tables, stools, benches, lamps, shelves or rugs.
- Do NOT add wall art, mirrors or window dressing.
- Do NOT tidy, restyle or "improve" the room. Clutter, objects on surfaces and personal items that are in the photo must remain exactly where they are.
- The ONLY differences between the input photo and your output are the numbered tasks. Every other pixel of content should depict the same objects as the original.
`;
  const body = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: geminiPrompt }, ...imageParts],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      // Preserve the customer's framing — see SUPPORTED_ASPECT_RATIOS.
      imageConfig: { aspectRatio },
    },
  });

  /**
   * Retry transient server errors.
   *
   * This endpoint returns intermittent 500 "Internal error encountered" for
   * requests that succeed on a retry with byte-identical input — observed
   * directly while testing multi-product rooms. Without this, one unlucky call
   * fails an entire generation the customer has already waited a minute for.
   * Only 5xx and 429 are retried; a 4xx is our own mistake and repeating it
   * would just waste time and money.
   */
  let response: Response | null = null;
  let data: GeminiGenerateResponse = {};

  for (let attempt = 0; attempt < MAX_TRANSIENT_RETRIES + 1; attempt += 1) {
    response = await fetch(geminiImageEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body,
    });
    data = (await response.json().catch(() => ({}))) as GeminiGenerateResponse;

    const isTransient = response.status >= 500 || response.status === 429;
    if (response.ok || !isTransient || attempt === MAX_TRANSIENT_RETRIES) break;

    // Brief backoff; the provider usually recovers immediately.
    await new Promise((resolve) =>
      setTimeout(resolve, TRANSIENT_RETRY_BASE_MS * (attempt + 1))
    );
  }

  if (!response || !response.ok) {
    throw new Error(
      data.error?.message ||
        `Gemini image generation failed with status ${response?.status}.`
    );
  }

  const parts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((part) => part.inlineData || part.inline_data);
  const inlineData = imagePart?.inlineData || imagePart?.inline_data;
  const imageBase64 = inlineData?.data;

  if (!imageBase64) {
    throw new Error("Gemini generation completed without an image.");
  }

  /**
   * Metadata-only render log. The output dimensions are measured from the
   * returned pixels rather than assumed, because "did it come back square?" is
   * exactly the regression the aspect-ratio request exists to prevent.
   */
  if (process.env.ENABLE_AI_DEBUG?.toLowerCase() === "true") {
    let outputSize = "unknown";
    try {
      const meta = await sharp(Buffer.from(imageBase64, "base64")).metadata();
      outputSize = `${meta.width}x${meta.height}`;
    } catch {
      // Leave it unknown; never fail a good render over a log line.
    }
    console.log("[gemini-render]", {
      model: geminiImageModel(),
      requestedAspectRatio: aspectRatio,
      outputSize,
      referenceImages: references.length,
      referenceLabels: references.map((reference) =>
        reference.label.slice(0, 60)
      ),
      outputBytes: Math.round((imageBase64.length * 3) / 4),
    });
  }

  return {
    provider: "gemini",
    label: "Gemini",
    imageBase64,
    mimeType: inlineData.mimeType || inlineData.mime_type || "image/png",
    b64_json: imageBase64,
  };
}
