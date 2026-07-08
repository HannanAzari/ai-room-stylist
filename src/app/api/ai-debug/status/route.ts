import { NextResponse } from "next/server";

/**
 * Reports whether AI debug tooling is enabled (ENABLE_AI_DEBUG=true).
 * The hidden admin view (?admin=1) uses this to decide whether to show the
 * AI evaluation panel. Exposes only a boolean — no secrets, no data.
 */
export async function GET() {
  return NextResponse.json({
    enabled: process.env.ENABLE_AI_DEBUG?.toLowerCase() === "true",
  });
}
