import shipments from "@/features/ops/data/logistics.json";

export type LogisticsItem = {
  id: string;
  supplier: string;
  product: string;
  origin: string;
  destination: string;
  status: string;
  eta: string;
  risk: string;
  reason: string;
  recommendedAction: string;
};

export function getLogistics(): LogisticsItem[] {
  return shipments as LogisticsItem[];
}

export function getLogisticsSummary() {
  const items = getLogistics();

  return {
    totalShipments: items.length,
    delayed: items.filter((item) => item.status === "delayed"),
    highRisk: items.filter((item) => item.risk === "high"),
    inTransit: items.filter((item) => item.status === "in-transit"),
    arrived: items.filter((item) => item.status === "arrived"),
  };
}

export function getLogisticsSignals() {
  const summary = getLogisticsSummary();

  return [
    {
      module: "Logistics",
      severity: summary.highRisk.length > 0 ? "High" : "Low",
      title: `${summary.highRisk.length} high-risk shipment issues`,
      impact: "May affect stock replenishment, sales availability and customer delivery promises",
    },
    {
      module: "Supplier",
      severity: summary.delayed.length > 0 ? "Medium" : "Low",
      title: `${summary.delayed.length} supplier/container delays`,
      impact: "Requires coordination between warehouse, sales and customer support",
    },
  ];
}
