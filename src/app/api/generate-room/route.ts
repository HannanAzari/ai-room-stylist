import { NextResponse } from "next/server";
import {
  getProductsByIds,
  getProductsForStyle,
} from "@/lib/products";
import { loadProductReferenceImageFiles } from "@/lib/product-image-references";
import { buildRoomPrompt, type RoomMeasurements } from "@/lib/prompts";
import {
  generateGeminiImage,
  getGeminiImageConfiguration,
} from "@/features/room-stylist/services/image-providers/gemini";
import { generateOpenAIImage } from "@/lib/openai-image-provider";
import type { GeneratedImageResult } from "@/features/room-stylist/services/image-providers/types";

const SUPPORTED_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const HEIC_UPLOAD_ERROR =
  "This iPhone photo format is not supported yet. Please convert to JPG or select a JPG/PNG image.";
const UNSUPPORTED_UPLOAD_ERROR =
  "Unsupported room image type. Please upload JPG, PNG, or WebP.";
const MISSING_ROOM_IMAGE_ERROR =
  "Missing room image. Please upload a JPG, PNG, or WebP image.";
const OPENAI_INVALID_IMAGE_ERROR =
  "OpenAI invalid image file. Please upload a clear JPG, PNG, or WebP room photo.";
const HEIC_EXTENSIONS = [".heic", ".heif"];

function getFileExtension(fileName: string) {
  const cleanFileName = fileName.split(/[?#]/)[0];
  const extensionIndex = cleanFileName.lastIndexOf(".");

  return extensionIndex === -1
    ? ""
    : cleanFileName.slice(extensionIndex).toLowerCase();
}

function devLog(message: string, details?: unknown) {
  if (process.env.NODE_ENV !== "development") return;

  console.log(message, details);
}

function parseSelectedProductIds(rawProductIds: string | null) {
  if (!rawProductIds) return [];

  const parsed = JSON.parse(rawProductIds);

  return Array.isArray(parsed)
    ? parsed.filter((productId): productId is string => typeof productId === "string")
    : [];
}

function parseOptionalPositiveNumber(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim() === "") return null;

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseRoomMeasurements(formData: FormData): RoomMeasurements {
  return {
    widthM: parseOptionalPositiveNumber(formData.get("roomWidthM")),
    lengthM: parseOptionalPositiveNumber(formData.get("roomLengthM")),
    ceilingHeightM: parseOptionalPositiveNumber(
      formData.get("ceilingHeightM")
    ),
  };
}

function mergeProductsById(
  primaryProducts: ReturnType<typeof getProductsByIds>,
  complementaryProducts: ReturnType<typeof getProductsForStyle>,
  limit = 6
) {
  const seenProductIds = new Set<string>();

  return [...primaryProducts, ...complementaryProducts]
    .filter((product) => {
      if (seenProductIds.has(product.id)) return false;

      seenProductIds.add(product.id);
      return true;
    })
    .slice(0, limit);
}

function getErrorText(error: unknown) {
  if (error instanceof Error) return error.message;

  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message || "");
  }

  return String(error);
}

function isOpenAIInvalidImageError(error: unknown) {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: number }).status
      : undefined;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  const errorText = `${getErrorText(error)} ${code}`.toLowerCase();

  return (
    status === 400 &&
    /image|file|format|unsupported|invalid/.test(errorText)
  );
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const image = formData.get("image");
    const style = formData.get("style") as string | null;
    const roomType = formData.get("roomType") as string | null;
    const selectedProductIdsRaw = formData.get("selectedProductIds") as string | null;
    const aiConceptModeRaw = formData.get("aiConceptMode");
    const providerStrategy = formData.get("providerStrategy");
    const aiConceptMode =
      typeof aiConceptModeRaw === "string"
        ? aiConceptModeRaw === "true"
        : undefined;
    const roomMeasurements = parseRoomMeasurements(formData);

    if (!(image instanceof File) || image.size === 0) {
      return NextResponse.json(
        { error: MISSING_ROOM_IMAGE_ERROR },
        { status: 400 }
      );
    }

    if (!style || !roomType) {
      return NextResponse.json(
        { error: "Missing style or room type." },
        { status: 400 }
      );
    }

    const imageType = image.type.toLowerCase();
    const imageExtension = getFileExtension(image.name);

    devLog("[generate-room] uploaded image", {
      name: image.name,
      type: image.type,
      size: image.size,
    });

    let selectedProductIds: string[];

    try {
      selectedProductIds = parseSelectedProductIds(selectedProductIdsRaw);
    } catch {
      return NextResponse.json(
        { error: "Invalid selected product IDs." },
        { status: 400 }
      );
    }

    devLog("[generate-room] selected product IDs", selectedProductIds);
    devLog("[generate-room] AI concept mode", aiConceptMode);
    devLog("[generate-room] provider strategy", providerStrategy);
    devLog("[generate-room] room measurements", roomMeasurements);

    if (
      imageType === "image/heic" ||
      imageType === "image/heif" ||
      HEIC_EXTENSIONS.includes(imageExtension)
    ) {
      return NextResponse.json(
        { error: HEIC_UPLOAD_ERROR },
        { status: 415 }
      );
    }

    if (!SUPPORTED_UPLOAD_TYPES.has(imageType)) {
      return NextResponse.json(
        { error: UNSUPPORTED_UPLOAD_ERROR },
        { status: 415 }
      );
    }

    const selectedProducts = getProductsByIds(selectedProductIds);
    const styleProducts = getProductsForStyle(style);
    const products =
      aiConceptMode === true
        ? mergeProductsById(selectedProducts, styleProducts)
        : aiConceptMode === false
          ? selectedProducts
          : selectedProductIds.length > 0
            ? selectedProducts
            : styleProducts;

    const prompt = buildRoomPrompt({
      style,
      roomType,
      products,
      roomMeasurements,
      aiConceptMode: aiConceptMode ?? true,
    });

    const productImageFiles = await loadProductReferenceImageFiles(
      products,
      "[generate-room]"
    );

    const geminiConfiguration = getGeminiImageConfiguration();
    const providerWarnings: string[] = [];

    if (providerStrategy === "gemini-first") {
      if (geminiConfiguration.available) {
        try {
          const geminiImage = await generateGeminiImage({
            prompt,
            roomImage: image,
            productImages: productImageFiles,
          });

          return NextResponse.json({
            images: [geminiImage],
            imageBase64: geminiImage.imageBase64,
            products,
            providerWarnings,
          });
        } catch (error) {
          console.error("[generate-room] Gemini provider failed", error);
          providerWarnings.push(
            `Gemini image generation failed: ${getErrorText(error) || "unknown provider error"}. Showing an OpenAI fallback.`
          );
        }
      } else {
        providerWarnings.push(
          geminiConfiguration.enabled
            ? "Gemini image generation is enabled but GEMINI_API_KEY is missing. Showing an OpenAI fallback."
            : "Gemini image generation is disabled. Showing an OpenAI fallback."
        );
      }

      const openAIFallback = await generateOpenAIImage({
        prompt,
        roomImage: image,
        productImages: productImageFiles,
      });

      return NextResponse.json({
        images: [openAIFallback],
        imageBase64: openAIFallback.imageBase64,
        products,
        providerWarnings,
      });
    }

    const openAIImage = await generateOpenAIImage({
      prompt,
      roomImage: image,
      productImages: productImageFiles,
    });
    const images: GeneratedImageResult[] = [openAIImage];

    if (geminiConfiguration.enabled && !geminiConfiguration.apiKey) {
      providerWarnings.push(
        "Gemini image generation is enabled but GEMINI_API_KEY is missing."
      );
    }

    if (geminiConfiguration.available) {
      try {
        const geminiImage = await generateGeminiImage({
          prompt,
          roomImage: image,
          productImages: productImageFiles,
        });

        images.push(geminiImage);
      } catch (error) {
        console.error("[generate-room] Gemini provider failed", error);
        providerWarnings.push(
          `Gemini image generation failed: ${getErrorText(error) || "unknown provider error"}. The OpenAI concept is still available.`
        );
      }
    }

    return NextResponse.json({
      images,
      imageBase64: images[0].imageBase64,
      products,
      providerWarnings,
    });
  } catch (error) {
    console.error(error);

    if (isOpenAIInvalidImageError(error)) {
      return NextResponse.json(
        { error: OPENAI_INVALID_IMAGE_ERROR },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Generation failed. Please try again." },
      { status: 500 }
    );
  }
}
