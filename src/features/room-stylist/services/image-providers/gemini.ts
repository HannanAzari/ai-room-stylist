import type {
  GeneratedImageResult,
  ImageProviderInput,
  LabelledProductImage,
} from "./types";

const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const GEMINI_IMAGE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;
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
    response = await fetch(GEMINI_IMAGE_ENDPOINT, {
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

  return {
    provider: "gemini",
    label: "Gemini",
    imageBase64,
    mimeType: inlineData.mimeType || inlineData.mime_type || "image/png",
    b64_json: imageBase64,
  };
}
