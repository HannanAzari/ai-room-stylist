import { NextResponse } from "next/server";
import { getOpsBrainSnapshot } from "@/lib/ops/brain";

export async function GET() {
  try {
    const snapshot = getOpsBrainSnapshot();

    return NextResponse.json(snapshot);
  } catch (error) {
    console.error("Failed to build ops brain snapshot", error);

    return NextResponse.json(
      { error: "Failed to load ops brain snapshot." },
      { status: 500 }
    );
  }
}
