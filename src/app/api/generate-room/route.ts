import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import {
  getPrimaryProductImageUrl,
  getProductsByIds,
  getProductsForStyle,
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
  "Unsupported image type. Please upload JPG, PNG, or WebP.";
const HEIC_EXTENSIONS = [".heic", ".heif"];

function getFileExtension(fileName: string) {
  const extensionIndex = fileName.lastIndexOf(".");

  return extensionIndex === -1
    ? ""
    : fileName.slice(extensionIndex).toLowerCase();
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const image = formData.get("image") as File | null;
    const style = formData.get("style") as string | null;
    const roomType = formData.get("roomType") as string | null;
    const selectedProductIdsRaw = formData.get("selectedProductIds") as string | null;

    if (!image || !style || !roomType) {
      return NextResponse.json(
        { error: "Missing image, style, or room type" },
        { status: 400 }
      );
    }

    const imageType = image.type.toLowerCase();
    const imageExtension = getFileExtension(image.name);

    if (process.env.NODE_ENV === "development") {
      console.log("[generate-room] uploaded image", {
        name: image.name,
        type: image.type,
        size: image.size,
      });
    }

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

    const selectedProductIds = selectedProductIdsRaw
      ? JSON.parse(selectedProductIdsRaw)
      : [];

    const products =
      selectedProductIds.length > 0
        ? getProductsByIds(selectedProductIds)
        : getProductsForStyle(style);

    const prompt = buildRoomPrompt({
      style,
      roomType,
      products,
    });

    const productImageFiles = await Promise.all(
      products
        .map((product) => ({
          product,
          imageUrl: getPrimaryProductImageUrl(product),
        }))
        .filter((item): item is { product: typeof item.product; imageUrl: string } =>
          Boolean(item.imageUrl)
        )
        .slice(0, 3)
        .map(async ({ product, imageUrl }) => {
          const imagePath = `${process.cwd()}/public${imageUrl}`;
          const fileBuffer = await readFile(imagePath);

          return new File([fileBuffer], `${product.id}.jpg`, {
            type: "image/jpeg",
          });
        })
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

    return NextResponse.json(
      { error: "Generation failed" },
      { status: 500 }
    );
  }
}
