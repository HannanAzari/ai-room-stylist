/**
 * The studio's single generation endpoint.
 *
 * The guard here has always been about ROUTING, not about the vendor: the
 * studio must talk to exactly one endpoint, so a stray call to a legacy route
 * fails loudly instead of quietly producing a differently-shaped result.
 *
 * The renderer behind that endpoint is now chosen server-side
 * (`room-edit-provider.ts`), so the provider check accepts any renderer the
 * studio route is allowed to use rather than pinning the vendor name. Pinning
 * it here would mean a server-side provider swap surfaced to the customer as
 * "Studio is Gemini-only" — a client-side error about a server-side setting.
 *
 * The route path still says "gemini" for compatibility with saved results and
 * existing links; it is the studio's generation endpoint whatever renders it.
 */
export const STUDIO_GEMINI_ROUTE = "/api/studio/generate-gemini";

/** Renderers the studio route may legitimately return results from. */
const STUDIO_PROVIDERS = new Set(["gpt-image", "gemini"]);
const STUDIO_ROUTE_ERROR = "Studio uses a single generation route";
const STUDIO_PROVIDER_ERROR = "Unknown studio image provider";

export function assertStudioGeminiProvider(provider: unknown) {
  if (typeof provider !== "string" || !STUDIO_PROVIDERS.has(provider)) {
    throw new Error(STUDIO_PROVIDER_ERROR);
  }
}

/**
 * The route's PATH, ignoring any query string.
 *
 * The guard compares this rather than the whole string. Its job is to stop the
 * studio calling a DIFFERENT endpoint; a query parameter on the studio's own
 * endpoint is still the studio's own endpoint. Exact string equality conflated
 * the two, so `?async=1` — the same route, asking it to run as a background
 * job — was rejected as if it were a stray legacy call, and Generate failed
 * before any request left the browser.
 */
function routePath(route: string): string {
  return route.split(/[?#]/)[0];
}

export async function fetchStudioGemini(route: string, init: RequestInit) {
  if (routePath(route) !== STUDIO_GEMINI_ROUTE) {
    throw new Error(STUDIO_ROUTE_ERROR);
  }

  return fetch(route, init);
}
