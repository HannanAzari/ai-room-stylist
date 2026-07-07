export const STUDIO_GEMINI_ROUTE = "/api/studio/generate-gemini";
const STUDIO_PROVIDER = "gemini";
const STUDIO_PROVIDER_ERROR = "Studio is Gemini-only";

export function assertStudioGeminiProvider(provider: unknown) {
  if (provider !== STUDIO_PROVIDER) {
    throw new Error(STUDIO_PROVIDER_ERROR);
  }
}

export async function fetchStudioGemini(
  route: string,
  init: RequestInit
) {
  if (route !== STUDIO_GEMINI_ROUTE) {
    throw new Error(STUDIO_PROVIDER_ERROR);
  }

  return fetch(route, init);
}
