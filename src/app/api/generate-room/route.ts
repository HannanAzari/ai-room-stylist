import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import {
  getProductsByIds,
  getProductsForStyle,
} from "@/lib/products";
import { loadProductReferenceImageFiles } from "@/lib/product-image-references";
import { buildRoomPrompt, type RoomMeasurements } from "@/lib/prompts";

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

    const products =
      selectedProductIds.length > 0
        ? getProductsByIds(selectedProductIds)
        : getProductsForStyle(style);

    const prompt = buildRoomPrompt({
      style,
      roomType,
      products,
      roomMeasurements,
    });

    const productImageFiles = await loadProductReferenceImageFiles(
      products,
      "[generate-room]"
    );

    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: [image, ...productImageFiles],
      prompt,
      size: "1024x1024",
      n: 1,
    });

    return NextResponse.json({
      images: result.data,
      products,
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
