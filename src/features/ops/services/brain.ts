import {
  getInventory,
  getInventorySummary,
  getRecommendations,
  getSalesOpportunities,
  getMarketingCampaigns,
} from "./inventory";

import { getSupportSummary, getSupportTickets } from "./support";
import { getLogisticsSummary, getLogistics } from "./logistics";

function calculatePriorityScore(input: {
  stock?: number;
  monthlySales?: number;
  risk?: string;
  priority?: string;
  sentiment?: string;
}) {
  let score = 0;

  if (input.stock !== undefined) {
    if (input.stock <= 2) score += 40;
    else if (input.stock <= 5) score += 25;
    else if (input.stock <= 10) score += 10;
  }

  if (input.monthlySales !== undefined) {
    if (input.monthlySales >= 10) score += 30;
    else if (input.monthlySales >= 5) score += 15;
  }

  if (input.risk === "high") score += 30;
  else if (input.risk === "medium") score += 15;

  if (input.priority === "high") score += 25;
  if (input.sentiment === "negative") score += 15;

  return Math.min(score, 100);
}

function severityFromScore(score: number) {
  if (score >= 70) return "Critical";
  if (score >= 45) return "High";
  return "Medium";
}

function formatCurrency(value: number) {
  return `$${Math.round(value).toLocaleString()}`;
}

export function getEnterpriseMetrics() {
  const inventory = getInventory();
  const inventorySummary = getInventorySummary();
  const estimatedRetailPrice = 1800;

  const totalStockUnits = inventory.reduce((sum, item) => sum + item.stock, 0);
  const monthlyUnitsSold = inventory.reduce(
    (sum, item) => sum + item.monthlySales,
    0
  );
  const inventoryCost = inventory.reduce(
    (sum, item) =>
      sum + item.stock * estimatedRetailPrice * (1 - item.margin / 100),
    0
  );
  const annualGrossMargin = inventory.reduce(
    (sum, item) =>
      sum + item.monthlySales * 12 * estimatedRetailPrice * (item.margin / 100),
    0
  );
  const annualCogs = inventory.reduce(
    (sum, item) =>
      sum +
      item.monthlySales * 12 * estimatedRetailPrice * (1 - item.margin / 100),
    0
  );
  const revenueAtRisk = inventorySummary.lowStock.reduce(
    (sum, item) => sum + item.monthlySales * estimatedRetailPrice,
    0
  );
  const tiedInventory = [
    ...inventorySummary.slowMoving,
    ...inventorySummary.overstock,
  ].reduce(
    (sum, item) =>
      sum + item.stock * estimatedRetailPrice * (1 - item.margin / 100),
    0
  );

  const gmroi = inventoryCost > 0 ? annualGrossMargin / inventoryCost : 0;
  const dailyCogs = annualCogs / 365;
  const daysInventoryOutstanding =
    dailyCogs > 0 ? inventoryCost / dailyCogs : 0;
  const sellThroughRate =
    totalStockUnits + monthlyUnitsSold > 0
      ? (monthlyUnitsSold / (totalStockUnits + monthlyUnitsSold)) * 100
      : 0;

  return [
    {
      id: "gmroi",
      label: "GMROI Estimate",
      value: `${gmroi.toFixed(1)}x`,
      detail: "Mock annual gross margin divided by inventory cost",
    },
    {
      id: "dio",
      label: "Days Inventory Outstanding",
      value: `${Math.round(daysInventoryOutstanding)} days`,
      detail: "Estimated days to turn current inventory",
    },
    {
      id: "sell-through",
      label: "Sell-through Rate",
      value: `${Math.round(sellThroughRate)}%`,
      detail: "Monthly unit sales vs stock plus sales",
    },
    {
      id: "revenue-risk",
      label: "Revenue at Risk",
      value: formatCurrency(revenueAtRisk),
      detail: "Low-stock monthly demand at mock retail value",
    },
    {
      id: "tied-capital",
      label: "Capital Tied Up",
      value: formatCurrency(tiedInventory),
      detail: "Slow-moving and overstock inventory cost estimate",
    },
  ];
}

export function getOpsBrainSnapshot() {
  const inventory = getInventory();
  const inventorySummary = getInventorySummary();
  const inventoryRecommendations = getRecommendations();
  const salesOpportunities = getSalesOpportunities();
  const marketingCampaigns = getMarketingCampaigns();

  const supportTickets = getSupportTickets();
  const supportSummary = getSupportSummary();

  const logistics = getLogistics();
  const logisticsSummary = getLogisticsSummary();
  const enterpriseMetrics = getEnterpriseMetrics();

  const criticalRisks = [
    ...inventorySummary.lowStock.map((item) => {
      const priorityScore = calculatePriorityScore({
        stock: item.stock,
        monthlySales: item.monthlySales,
      });

      return {
        source: "Inventory",
        severity: severityFromScore(priorityScore),
        priorityScore,
        title: `${item.name} is at stockout risk`,
        evidence: `${item.stock} units available, ${item.monthlySales} monthly sales`,
        action: `Prioritise replenishment or prepare substitutes for ${item.warehouse}`,
        departmentHandoff: "Inventory → Sales → Support",
      };
    }),

    ...logisticsSummary.highRisk.map((item) => {
      const priorityScore = calculatePriorityScore({ risk: item.risk });

      return {
        source: "Logistics",
        severity: severityFromScore(priorityScore),
        priorityScore,
        title: `${item.product} shipment risk detected`,
        evidence: `${item.status}, ETA ${item.eta}, route ${item.origin} to ${item.destination}`,
        action: item.recommendedAction,
        departmentHandoff: "Logistics → Inventory → Sales",
      };
    }),

    ...supportSummary.highPriority.map((item) => {
      const priorityScore = calculatePriorityScore({
        priority: item.priority,
        sentiment: item.sentiment,
      });

      return {
        source: "Support",
        severity: severityFromScore(priorityScore),
        priorityScore,
        title: `${item.product} has high-priority customer issue`,
        evidence: item.summary,
        action: item.recommendedAction,
        departmentHandoff: "Support → Logistics → Inventory",
      };
    }),
  ].sort((a, b) => b.priorityScore - a.priorityScore);

  const actionTickets = criticalRisks.slice(0, 6).map((risk, index) => ({
    id: `ACTION-${String(index + 1).padStart(3, "0")}`,
    owner: risk.source,
    priority: risk.severity,
    score: risk.priorityScore,
    task: risk.action,
    reason: risk.evidence,
    handoff: risk.departmentHandoff,
    status: "recommended",
  }));

  const commercialActions = [
    ...salesOpportunities.slice(0, 6).map((item) => ({
      source: "Sales",
      title: item.product,
      action: item.action,
      expectedImpact: item.expectedImpact,
      reason: item.reason,
    })),

    ...marketingCampaigns.slice(0, 4).map((item) => ({
      source: "Marketing",
      title: item.title,
      action: item.message,
      expectedImpact: `Campaign via ${item.channel}`,
      reason: item.sourceSignal,
    })),
  ];

  const executiveBrief = {
    totalRisks: criticalRisks.length,
    criticalRisks: criticalRisks.filter((r) => r.severity === "Critical").length,
    highRisks: criticalRisks.filter((r) => r.severity === "High").length,
    criticalStockRisks: inventorySummary.lowStock.length,
    highRiskShipments: logisticsSummary.highRisk.length,
    highPriorityCustomerIssues: supportSummary.highPriority.length,
    commercialActions: commercialActions.length,
    actionTickets: actionTickets.length,
    monitoredDepartments: [
      "Inventory",
      "Sales",
      "Marketing",
      "Support",
      "Logistics",
    ],
  };

  return {
    executiveBrief,
    criticalRisks,
    actionTickets,
    enterpriseMetrics,
    commercialActions,
    inventory,
    supportTickets,
    logistics,
    inventoryRecommendations,
    salesOpportunities,
    marketingCampaigns,
  };
}

export function getAgentExecutionPlan(userQuestion: string) {
  return [
    {
      agent: "Executive Orchestrator",
      task: `Interpreted the request: "${userQuestion}" and selected relevant specialist agents`,
      status: "completed",
    },
    {
      agent: "Inventory Agent",
      task: "Scored stockout risk using stock level and monthly sales velocity",
      status: "completed",
    },
    {
      agent: "Logistics Agent",
      task: "Checked inbound shipments, supplier delays and replenishment risk",
      status: "completed",
    },
    {
      agent: "Support Agent",
      task: "Checked priority tickets, customer sentiment and escalation risk",
      status: "completed",
    },
    {
      agent: "Sales Agent",
      task: "Converted stock pressure into bundle, upsell and substitution actions",
      status: "completed",
    },
    {
      agent: "Marketing Agent",
      task: "Converted commercial actions into campaign directions",
      status: "completed",
    },
    {
      agent: "Priority Engine",
      task: "Ranked risks by urgency and business impact",
      status: "completed",
    },
  ];
}
