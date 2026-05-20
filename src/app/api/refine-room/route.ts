import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import { getPrimaryProductImageUrl, getProductsByIds } from "@/lib/products";
import { formatProductForPrompt } from "@/lib/prompts";
import { readFile } from "fs/promises";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const imageBase64 = body.imageBase64 as string;
    const changeRequest = (body.changeRequest as string | undefined) || "";
    const refinementProductIds = Array.isArray(body.refinementProductIds)
      ? (body.refinementProductIds as string[])
      : [];

    if (!imageBase64 || (!changeRequest.trim() && refinementProductIds.length === 0)) {
      return NextResponse.json(
        { error: "Missing image or change request" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(imageBase64, "base64");

    const imageFile = new File([buffer], "selected-concept.png", {
      type: "image/png",
    });

    const products = getProductsByIds(refinementProductIds);
    const productList = products
      .map((product, index) => `${index + 1}. ${formatProductForPrompt(product)}`)
      .join("\n\n");

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

    const prompt = `
Refine this interior design concept based on the user request:

"${changeRequest.trim() || "Swap/add the selected product references naturally."}"

Selected product references for this refinement:
${productList || "None"}

Keep the same room perspective, architecture, lighting, and luxury furniture retail style.
Only change what the user requested.
If product references are provided, incorporate them naturally as swap or add-on furniture pieces.
Keep it photorealistic.
Do not add people.
Do not add text or logos.
`;
    const editImages =
      productImageFiles.length > 0 ? [imageFile, ...productImageFiles] : imageFile;

    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: editImages,
      prompt,
      size: "1024x1024",
      n: 1,
    });

    return NextResponse.json({
      image: result.data?.[0],
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Refinement failed" },
      { status: 500 }
    );
  }
}
