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

export async function fetchStudioGemini(route: string, init: RequestInit) {
  if (route !== STUDIO_GEMINI_ROUTE) {
    throw new Error(STUDIO_ROUTE_ERROR);
  }

  return fetch(route, init);
}
