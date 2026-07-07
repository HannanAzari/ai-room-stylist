import type {
  GeneratedImageResult,
  ImageProviderInput,
} from "./types";

const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const GEMINI_IMAGE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;
const MAX_GEMINI_PRODUCT_IMAGES = 2;

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

  // Gemini 2.5 Flash Image performs best with up to three input images.
  const imageParts = await Promise.all(
    [roomImage, ...productImages.slice(0, MAX_GEMINI_PRODUCT_IMAGES)].map(
      fileToInlineData
    )
  );
  const geminiPrompt = `${prompt}

Gemini image editing priorities:
- Treat the first supplied image as the fixed room and camera reference.
- Preserve the full visible room, camera angle, walls, ceiling, floor, windows, TV location, and room proportions.
- Do not crop closer, zoom in, or change the camera perspective.
- Keep the whole room visible in the finished image.
- Prioritise photorealistic interior photography with natural lighting, believable materials, and realistic furniture scale.
- Make supplied product references visually clear, recognisable, and naturally placed.
- Follow the AI concept mode instructions exactly; do not make unrelated changes when that mode is OFF.
`;
  const response = await fetch(GEMINI_IMAGE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: geminiPrompt }, ...imageParts],
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
      },
    }),
  });
  const data = (await response.json().catch(() => ({}))) as GeminiGenerateResponse;

  if (!response.ok) {
    throw new Error(
      data.error?.message ||
        `Gemini image generation failed with status ${response.status}.`
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
