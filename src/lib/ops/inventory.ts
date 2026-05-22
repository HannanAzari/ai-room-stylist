import inventory from "@/data/inventory.json";

export type InventoryItem = {
  sku: string;
  name: string;
  category: string;
  warehouse: string;
  stock: number;
  monthlySales: number;
  status: string;
  margin: number;
  supplier: string;
  notes: string;
};

export function getInventory(): InventoryItem[] {
  return inventory as InventoryItem[];
}

export function getInventorySummary() {
  const items = getInventory();

  const lowStock = items.filter(item => item.status === "low-stock");
  const overstock = items.filter(item => item.status === "overstock");
  const slowMoving = items.filter(item => item.status === "slow-moving");
  const highMargin = items.filter(item => item.margin >= 35);

  const slowMovingValue = slowMoving.reduce(
    (sum, item) => sum + item.stock * 1200,
    0
  );

  return {
    totalProducts: items.length,
    lowStock,
    overstock,
    slowMoving,
    highMargin,
    slowMovingValue,
    warehouses: [...new Set(items.map(item => item.warehouse))],
  };
}

export function searchInventory(query: string) {
  const q = query.toLowerCase();

  return getInventory().filter(item =>
    item.name.toLowerCase().includes(q) ||
    item.category.toLowerCase().includes(q) ||
    item.warehouse.toLowerCase().includes(q) ||
    item.status.toLowerCase().includes(q) ||
    item.notes.toLowerCase().includes(q) ||
    item.supplier.toLowerCase().includes(q)
  );
}

export function getRecommendations() {
  const summary = getInventorySummary();

  return [
    ...summary.lowStock.map(item => ({
      type: "Stock Risk",
      title: `${item.name} may run out soon`,
      action: `Review replenishment or transfer stock to ${item.warehouse}.`,
    })),
    ...summary.overstock.map(item => ({
      type: "Overstock",
      title: `${item.name} has excess inventory`,
      action: "Create bundle campaign or promotion to improve movement.",
    })),
    ...summary.slowMoving.map(item => ({
      type: "Slow Moving",
      title: `${item.name} is moving slowly`,
      action: "Bundle with high-demand products or feature in showroom campaign.",
    })),
  ];
}

export function getExecutiveSignals() {
  const summary = getInventorySummary();

  return [
    {
      module: "Inventory",
      severity: "High",
      title: `${summary.lowStock.length} stockout risks detected`,
      impact: "Potential lost sales if replenishment is delayed",
    },
    {
      module: "Commercial",
      severity: "Medium",
      title: `${summary.overstock.length} overstock opportunities`,
      impact: "Cash tied in slow-moving products",
    },
    {
      module: "Warehouse",
      severity: "Medium",
      title: `${summary.warehouses.length} locations monitored`,
      impact: "AI can compare stock pressure across stores and DCs",
    },
  ];
}

export function getSalesOpportunities() {
  const items = getInventory();

  const overstock = items.filter((item) => item.status === "overstock");
  const highMargin = items.filter((item) => item.margin >= 35);
  const lowStock = items.filter((item) => item.status === "low-stock");

  return [
    ...overstock.map((item) => ({
      type: "Bundle Opportunity",
      product: item.name,
      reason: `${item.stock} units in stock with slower movement`,
      action: "Create bundle offer with complementary products",
      expectedImpact: "Increase sales velocity and reduce tied inventory",
    })),
    ...highMargin.slice(0, 3).map((item) => ({
      type: "High Margin Push",
      product: item.name,
      reason: `${item.margin}% margin`,
      action: "Prioritise in showroom recommendations and online campaigns",
      expectedImpact: "Improve gross profit per sale",
    })),
    ...lowStock.map((item) => ({
      type: "Substitution Risk",
      product: item.name,
      reason: `Only ${item.stock} units available`,
      action: "Prepare alternative product suggestions for sales staff",
      expectedImpact: "Reduce lost sales when product is unavailable",
    })),
  ];
}
export function getMarketingCampaigns() {
  const salesOpportunities = getSalesOpportunities();
  const balancedOpportunities = [
    ...salesOpportunities
      .filter((item) => item.type === "Bundle Opportunity")
      .slice(0, 3),
    ...salesOpportunities
      .filter((item) => item.type === "High Margin Push")
      .slice(0, 3),
    ...salesOpportunities
      .filter((item) => item.type === "Substitution Risk")
      .slice(0, 3),
  ];

  return balancedOpportunities.map((item) => {
    if (item.type === "Bundle Opportunity") {
      return {
        campaignType: "Bundle Campaign",
        title: `Move ${item.product} with a curated room package`,
        sourceSignal: item.reason,
        targetAudience: "Customers looking for complete living room solutions",
        channel: "Website homepage, email, Instagram, showroom displays",
        message: "Complete the look with a premium Koala Living bundle.",
      };
    }

    if (item.type === "High Margin Push") {
      return {
        campaignType: "Premium Product Push",
        title: `Feature ${item.product} as a premium hero item`,
        sourceSignal: item.reason,
        targetAudience: "Luxury furniture buyers",
        channel: "Paid ads, showroom hero display, product landing page",
        message: "Bring luxury hotel-style comfort into your home.",
      };
    }

    return {
      campaignType: "Alternative Product Campaign",
      title: `Prepare alternatives for ${item.product}`,
      sourceSignal: item.reason,
      targetAudience: "Customers browsing low-stock products",
      channel: "Product page recommendations and sales staff scripts",
      message: "Similar styles available now with faster availability.",
    };
  });
}
