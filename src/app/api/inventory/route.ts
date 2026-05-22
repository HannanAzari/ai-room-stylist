import { NextResponse } from "next/server";
import {
  getInventory,
  getInventorySummary,
  getRecommendations,
  getSalesOpportunities,
  getMarketingCampaigns,
  getExecutiveSignals,
} from "@/lib/ops/inventory";

export async function GET() {
  try {
    return NextResponse.json({
      inventory: getInventory(),
      summary: getInventorySummary(),
      recommendations: getRecommendations(),
      salesOpportunities: getSalesOpportunities(),
      marketingCampaigns: getMarketingCampaigns(),
      signals: getExecutiveSignals(),
    });
  } catch (error) {
    console.error("Failed to load inventory API data", error);

    return NextResponse.json(
      { error: "Failed to load inventory data." },
      { status: 500 }
    );
  }
}
