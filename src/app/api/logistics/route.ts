import { NextResponse } from "next/server";
import {
  getLogistics,
  getLogisticsSummary,
  getLogisticsSignals,
} from "@/lib/ops/logistics";

export async function GET() {
  try {
    return NextResponse.json({
      logistics: getLogistics(),
      summary: getLogisticsSummary(),
      signals: getLogisticsSignals(),
    });
  } catch (error) {
    console.error("Failed to load logistics API data", error);

    return NextResponse.json(
      { error: "Failed to load logistics data." },
      { status: 500 }
    );
  }
}
