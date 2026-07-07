export const ANALYTICS_STORAGE_KEY = "ai-room-stylist:events";

export type AnalyticsEventName =
  | "generate_started"
  | "generate_completed"
  | "concept_selected"
  | "concept_deselected"
  | "refine_started"
  | "refine_completed"
  | "download_clicked"
  | "share_clicked"
  | "favourite_clicked"
  | "add_to_cart_clicked"
  | "bundle_add_to_cart_clicked"
  | "generated_provider_count"
  | "result_provider_viewed"
  | "result_provider_swiped"
  | "fullscreen_provider_viewed"
  | "provider_warning";

export type AnalyticsEvent = {
  eventName: AnalyticsEventName;
  timestamp: string;
  payload: Record<string, unknown>;
};

function readStoredEvents(): AnalyticsEvent[] {
  if (typeof window === "undefined") return [];

  try {
    const rawEvents = window.localStorage.getItem(ANALYTICS_STORAGE_KEY);
    if (!rawEvents) return [];

    const parsed = JSON.parse(rawEvents);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function trackEvent(
  eventName: AnalyticsEventName,
  payload: Record<string, unknown> = {}
) {
  if (typeof window === "undefined") return;

  const event: AnalyticsEvent = {
    eventName,
    timestamp: new Date().toISOString(),
    payload,
  };

  try {
    window.localStorage.setItem(
      ANALYTICS_STORAGE_KEY,
      JSON.stringify([...readStoredEvents(), event])
    );
  } catch {
    // Analytics should never interrupt the shopping/demo experience.
  }
}
