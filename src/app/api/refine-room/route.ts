import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const imageBase64 = body.imageBase64 as string;
    const changeRequest = body.changeRequest as string;

    if (!imageBase64 || !changeRequest) {
      return NextResponse.json(
        { error: "Missing image or change request" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(imageBase64, "base64");

    const imageFile = new File([buffer], "selected-concept.png", {
      type: "image/png",
    });

    const prompt = `
Refine this interior design concept based on the user request:

"${changeRequest}"

Keep the same room perspective, architecture, lighting, and luxury furniture retail style.
Only change what the user requested.
Keep it photorealistic.
Do not add people.
Do not add text or logos.
`;

    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: imageFile,
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