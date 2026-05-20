import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import {
  getPrimaryProductImageUrl,
  getProductsByIds,
  getProductsForStyle,
  type Product,
} from "@/lib/products";
import { buildRoomPrompt } from "@/lib/prompts";
import { readFile } from "fs/promises";

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
const PRODUCT_IMAGE_TYPES_BY_EXTENSION = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

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

function isProductImageBufferValid(buffer: Buffer, imageType: string) {
  if (imageType === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (imageType === "image/png") {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }

  if (imageType === "image/webp") {
    return (
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    );
  }

  return false;
}

async function loadProductImageFiles(products: Product[]) {
  const productImageFiles: File[] = [];

  for (const product of products.slice(0, 3)) {
    const imageUrl = getPrimaryProductImageUrl(product)?.trim();

    if (!imageUrl) {
      devLog("[generate-room] skipped product image", {
        productId: product.id,
        reason: "missing image URL",
      });
      continue;
    }

    if (!imageUrl.startsWith("/")) {
      devLog("[generate-room] skipped product image", {
        productId: product.id,
        imageUrl,
        reason: "not a local public image path",
      });
      continue;
    }

    const imageExtension = getFileExtension(imageUrl);
    const imageType = PRODUCT_IMAGE_TYPES_BY_EXTENSION.get(imageExtension);

    if (!imageType) {
      devLog("[generate-room] skipped product image", {
        productId: product.id,
        imageUrl,
        reason: "unsupported product image type",
      });
      continue;
    }

    const imagePath = `${process.cwd()}/public${imageUrl.split(/[?#]/)[0]}`;

    devLog("[generate-room] loading product image", {
      productId: product.id,
      imagePath,
    });

    try {
      const fileBuffer = await readFile(imagePath);

      if (!isProductImageBufferValid(fileBuffer, imageType)) {
        devLog("[generate-room] skipped product image", {
          productId: product.id,
          imagePath,
          reason: "image file signature did not match extension",
        });
        continue;
      }

      productImageFiles.push(
        new File([fileBuffer], `${product.id}${imageExtension}`, {
          type: imageType,
        })
      );
    } catch (error) {
      devLog("[generate-room] skipped product image", {
        productId: product.id,
        imagePath,
        reason: error instanceof Error ? error.message : "read failed",
      });
    }
  }

  return productImageFiles;
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
    });

    const productImageFiles = await loadProductImageFiles(products);

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
