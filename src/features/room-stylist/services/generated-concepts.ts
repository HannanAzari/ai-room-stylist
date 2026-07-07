import type {
  GeneratedConcept,
  ImageProviderId,
} from "../types";

function getProvider(value: unknown): ImageProviderId {
  return typeof value === "string" && value.trim() ? value.trim() : "legacy";
}

function getDefaultLabel(provider: ImageProviderId) {
  return provider === "gemini" ? "Gemini" : "Generated concept";
}

function normalizeConcept(value: unknown): GeneratedConcept | null {
  if (typeof value === "string" && value) {
    return {
      provider: "legacy",
      label: "Generated concept",
      imageBase64: value,
      mimeType: "image/png",
    };
  }

  if (!value || typeof value !== "object") return null;

  const candidate = value as {
    provider?: unknown;
    label?: unknown;
    imageBase64?: unknown;
    b64_json?: unknown;
    mimeType?: unknown;
  };
  const imageBase64 =
    typeof candidate.imageBase64 === "string"
      ? candidate.imageBase64
      : typeof candidate.b64_json === "string"
        ? candidate.b64_json
        : "";

  if (!imageBase64) return null;

  const provider = getProvider(candidate.provider);

  return {
    provider,
    label:
      typeof candidate.label === "string" && candidate.label.trim()
        ? candidate.label.trim()
        : getDefaultLabel(provider),
    imageBase64,
    mimeType:
      typeof candidate.mimeType === "string" && candidate.mimeType
        ? candidate.mimeType
        : "image/png",
  };
}

export function normalizeGeneratedConcepts(
  values: unknown,
  fallbackImageBase64?: unknown
) {
  const concepts = Array.isArray(values)
    ? values
        .map(normalizeConcept)
        .filter((concept): concept is GeneratedConcept => Boolean(concept))
    : [];

  if (concepts.length > 0) return concepts;

  const fallbackConcept = normalizeConcept(fallbackImageBase64);

  return fallbackConcept ? [fallbackConcept] : [];
}
