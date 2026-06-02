import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import { getProductsByIds } from "@/lib/products";
import { loadProductReferenceImageFiles } from "@/lib/product-image-references";
import { buildScaleInstructions, formatProductForPrompt } from "@/lib/prompts";

const MISSING_IMAGE_ERROR =
  "Missing selected concept image. Please choose a concept before refining.";
const MISSING_REFINEMENT_ERROR =
  "Add a refinement instruction or select products to swap/add.";
const INVALID_IMAGE_ERROR =
  "Invalid selected concept image. Please choose a generated concept and try again.";
const OPENAI_INVALID_IMAGE_ERROR =
  "OpenAI invalid image file. Please try refining a newly generated concept.";
const SUPPORTED_DATA_URL_PREFIX = /^data:image\/(?:png|jpeg);base64,/i;

function devLog(message: string, details?: unknown) {
  if (process.env.NODE_ENV !== "development") return;

  console.log(message, details);
}

function stripImageDataUrlPrefix(imageBase64: string) {
  return imageBase64.trim().replace(SUPPORTED_DATA_URL_PREFIX, "");
}

function base64ToImageBuffer(imageBase64: unknown) {
  if (typeof imageBase64 !== "string" || !imageBase64.trim()) {
    return null;
  }

  const cleanBase64 = stripImageDataUrlPrefix(imageBase64).replace(/\s/g, "");

  if (
    !cleanBase64 ||
    cleanBase64.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64)
  ) {
    return null;
  }

  const buffer = Buffer.from(cleanBase64, "base64");

  return buffer.length > 0 ? buffer : null;
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
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid refinement request." },
        { status: 400 }
      );
    }

    const refinementRequest = body as {
      imageBase64?: unknown;
      changeRequest?: unknown;
      refinementProductIds?: unknown;
    };
    const imageBase64 = refinementRequest.imageBase64;
    const changeRequest =
      typeof refinementRequest.changeRequest === "string"
        ? refinementRequest.changeRequest
        : "";
    const refinementProductIds = Array.isArray(
      refinementRequest.refinementProductIds
    )
      ? refinementRequest.refinementProductIds.filter(
          (productId): productId is string => typeof productId === "string"
        )
      : [];

    devLog("[refine-room] received request", {
      imageBase64Exists: typeof imageBase64 === "string" && imageBase64.length > 0,
      imageBase64Length: typeof imageBase64 === "string" ? imageBase64.length : 0,
      changeRequestExists: Boolean(changeRequest.trim()),
      changeRequestLength: changeRequest.trim().length,
      refinementProductIds,
    });

    if (!imageBase64) {
      return NextResponse.json(
        { error: MISSING_IMAGE_ERROR },
        { status: 400 }
      );
    }

    if (!changeRequest.trim() && refinementProductIds.length === 0) {
      return NextResponse.json(
        { error: MISSING_REFINEMENT_ERROR },
        { status: 400 }
      );
    }

    const buffer = base64ToImageBuffer(imageBase64);

    if (!buffer) {
      return NextResponse.json(
        { error: INVALID_IMAGE_ERROR },
        { status: 400 }
      );
    }

    const imageFile = new File([buffer], "selected-concept.png", {
      type: "image/png",
    });

    const products = getProductsByIds(refinementProductIds);
    const productList = products
      .map((product, index) => `${index + 1}. ${formatProductForPrompt(product)}`)
      .join("\n\n");

    const productImageFiles = await loadProductReferenceImageFiles(
      products,
      "[refine-room]"
    );

    const prompt = `
Refine this interior design concept based on the user request:

"${changeRequest.trim() || "Swap/add the selected product references naturally."}"

Selected product references for this refinement:
${productList || "None"}

Keep the same room perspective, architecture, lighting, and luxury furniture retail style.
Only change what the user requested.
If product references are provided, incorporate them naturally as swap or add-on furniture pieces.
${buildScaleInstructions()}
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

    const refinedImage = result.data?.[0];

    if (!refinedImage?.b64_json) {
      return NextResponse.json(
        { error: "Refinement completed but no image was returned." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      image: refinedImage,
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
      { error: "Refinement failed. Please try again." },
      { status: 500 }
    );
  }
}
