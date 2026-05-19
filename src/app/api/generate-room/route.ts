import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import { getProductsByIds, getProductsForStyle } from "@/lib/products";
import { buildRoomPrompt } from "@/lib/prompts";
import { readFile } from "fs/promises";

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
        .filter((p) => p.imageUrl)
        .slice(0, 3)
        .map(async (p) => {
          const imagePath = `${process.cwd()}/public${p.imageUrl}`;
          const fileBuffer = await readFile(imagePath);

          return new File([fileBuffer], `${p.id}.jpg`, {
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