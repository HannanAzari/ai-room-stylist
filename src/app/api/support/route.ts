import { NextResponse } from "next/server";
import {
  getSupportTickets,
  getSupportSummary,
  getSupportSignals,
} from "@/features/ops/services/support";

export async function GET() {
  try {
    return NextResponse.json({
      tickets: getSupportTickets(),
      summary: getSupportSummary(),
      signals: getSupportSignals(),
    });
  } catch (error) {
    console.error("Failed to load support API data", error);

    return NextResponse.json(
      { error: "Failed to load support data." },
      { status: 500 }
    );
  }
}
