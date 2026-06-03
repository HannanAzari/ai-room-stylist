import tickets from "@/features/ops/data/support-tickets.json";

export type SupportTicket = {
  id: string;
  customer: string;
  category: string;
  product: string;
  status: string;
  priority: string;
  sentiment: string;
  summary: string;
  recommendedAction: string;
};

export function getSupportTickets(): SupportTicket[] {
  return tickets as SupportTicket[];
}

export function getSupportSummary() {
  const items = getSupportTickets();

  return {
    totalTickets: items.length,
    openTickets: items.filter((item) => item.status === "open"),
    highPriority: items.filter((item) => item.priority === "high"),
    negativeSentiment: items.filter((item) => item.sentiment === "negative"),
    deliveryIssues: items.filter((item) => item.category === "delivery"),
  };
}

export function getSupportSignals() {
  const summary = getSupportSummary();

  return [
    {
      module: "Support",
      severity: summary.highPriority.length > 0 ? "High" : "Low",
      title: `${summary.highPriority.length} high-priority customer issues`,
      impact: "May affect customer satisfaction and store follow-up workload",
    },
    {
      module: "Customer Experience",
      severity: summary.negativeSentiment.length > 0 ? "Medium" : "Low",
      title: `${summary.negativeSentiment.length} negative sentiment tickets`,
      impact: "Requires proactive communication and issue resolution",
    },
  ];
}
