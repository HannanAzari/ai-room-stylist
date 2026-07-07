/**
 * Lightweight pilot metrics derived from the local analytics event log.
 * Powers the hidden admin panel (?admin=1). Read-only aggregation.
 */
import {
  ANALYTICS_STORAGE_KEY,
  type AnalyticsEvent,
} from "@/lib/analytics";
import { productList } from "./product-helpers";

export function getAnalyticsEvents(): AnalyticsEvent[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(ANALYTICS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export type TopProduct = { id: string; name: string; count: number };

export type PilotMetrics = {
  totalEvents: number;
  generations: number;
  quoteOpens: number;
  quoteSubmissions: number;
  recommendationsAdded: number;
  recommendationsRemoved: number;
  addToCartClicks: number;
  favourites: number;
  topProducts: TopProduct[];
};

function countEvents(events: AnalyticsEvent[], name: string): number {
  return events.filter((event) => event.eventName === name).length;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function computePilotMetrics(): PilotMetrics {
  const events = getAnalyticsEvents();
  const productCounts = new Map<string, number>();

  const tally = (id: string) => {
    productCounts.set(id, (productCounts.get(id) || 0) + 1);
  };

  for (const event of events) {
    if (event.eventName === "generate_started") {
      for (const id of asStringArray(event.payload.selectedProductIds)) tally(id);
    }
    if (event.eventName === "recommendation_added") {
      const id = event.payload.productId;
      if (typeof id === "string") tally(id);
    }
  }

  const topProducts: TopProduct[] = [...productCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => ({
      id,
      name: productList.find((product) => product.id === id)?.name || id,
      count,
    }));

  return {
    totalEvents: events.length,
    generations: countEvents(events, "generate_completed"),
    quoteOpens: countEvents(events, "quote_opened"),
    quoteSubmissions: countEvents(events, "quote_submitted"),
    recommendationsAdded: countEvents(events, "recommendation_added"),
    recommendationsRemoved: countEvents(events, "recommendation_removed"),
    addToCartClicks: countEvents(events, "add_to_cart_clicked"),
    favourites: countEvents(events, "favourite_clicked"),
    topProducts,
  };
}

export function downloadJson(filename: string, data: unknown): void {
  if (typeof window === "undefined") return;

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
