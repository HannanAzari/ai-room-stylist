import { openai } from "@/lib/openai";
import type {
  GeneratedImageResult,
  ImageProviderInput,
} from "@/features/room-stylist/services/image-providers/types";

export async function generateOpenAIImage({
  prompt,
  roomImage,
  productImages,
}: ImageProviderInput): Promise<GeneratedImageResult> {
  const result = await openai.images.edit({
    model: "gpt-image-1",
    image: [roomImage, ...productImages],
    prompt,
    size: "1024x1024",
    n: 1,
  });
  const imageBase64 = result.data?.[0]?.b64_json;

  if (!imageBase64) {
    throw new Error("OpenAI generation completed without an image.");
  }

  return {
    provider: "openai",
    label: "OpenAI",
    imageBase64,
    mimeType: "image/png",
    b64_json: imageBase64,
  };
}
