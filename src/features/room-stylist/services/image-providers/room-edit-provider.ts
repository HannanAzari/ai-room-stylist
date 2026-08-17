/**
 * Which renderer performs the room edit.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS INDIRECTION EXISTS
 * ---------------------------------------------------------------------------
 * The room-edit call is the ONLY provider-specific step in the pipeline.
 * Everything before it — scene graph, replacement contract, plan, prompt,
 * reference manifest — is provider-agnostic and produces identical inputs
 * whichever renderer runs. Putting the choice behind one tiny interface means
 * the two can be compared on genuinely identical inputs by changing one
 * environment variable, rather than by editing a call site and hoping nothing
 * else drifted.
 *
 * It is deliberately small: one function with the shape both providers already
 * had. There is no plugin system here, and there should not be.
 *
 * Note that the QUALITY REVIEWER and the SCENE ANALYSIS are separate concerns
 * and still run on Gemini regardless of this setting — they read images, they
 * do not render them, and swapping the renderer must not silently change the
 * thing that judges it.
 */
import {
  generateGeminiImage,
  getGeminiImageConfiguration,
} from "./gemini";
import { generateGptImage, getGptImageConfiguration } from "./gpt-image";
import type { GeneratedImageResult, ImageProviderInput } from "./types";

export type RoomEditProviderId = "gpt-image" | "gemini";

export type RoomEditProvider = {
  id: RoomEditProviderId;
  label: string;
  /** True when this provider has everything it needs to run. */
  available: boolean;
  /** Why it cannot run, when `available` is false. */
  unavailableReason: string | null;
  /**
   * The API key to pass through, when the provider takes one explicitly.
   * Undefined means "use the provider's own configured key".
   */
  apiKey: string | undefined;
  generate: (input: ImageProviderInput) => Promise<GeneratedImageResult>;
};

/**
 * GPT Image 2 is the default renderer. Set `ROOM_EDIT_PROVIDER=gemini` to run
 * the previous one for comparison — the flag exists for that comparison, not
 * as a supported production fallback.
 */
export const DEFAULT_ROOM_EDIT_PROVIDER: RoomEditProviderId = "gpt-image";

function readConfiguredProviderId(): RoomEditProviderId {
  const raw = process.env.ROOM_EDIT_PROVIDER?.trim().toLowerCase();
  if (raw === "gemini") return "gemini";
  if (raw === "gpt-image" || raw === "gpt-image-2" || raw === "openai") {
    return "gpt-image";
  }
  // An unset or unrecognised value takes the default rather than failing the
  // request — a typo in an env var should not take the product down.
  return DEFAULT_ROOM_EDIT_PROVIDER;
}

/** The renderer this deployment uses for the room-edit path. */
export function getRoomEditProvider(): RoomEditProvider {
  const id = readConfiguredProviderId();

  if (id === "gemini") {
    const configuration = getGeminiImageConfiguration();
    return {
      id: "gemini",
      label: "Gemini",
      available: Boolean(configuration.apiKey),
      unavailableReason: configuration.apiKey
        ? null
        : "ROOM_EDIT_PROVIDER=gemini but GEMINI_API_KEY is not set.",
      apiKey: configuration.apiKey || undefined,
      generate: generateGeminiImage,
    };
  }

  const configuration = getGptImageConfiguration();
  return {
    id: "gpt-image",
    label: "GPT Image 2",
    available: configuration.available,
    unavailableReason: configuration.available
      ? null
      : "OPENAI_API_KEY is not set, so the GPT Image renderer cannot run.",
    // The provider resolves OPENAI_API_KEY itself; passing it again here would
    // duplicate that knowledge in two places.
    apiKey: undefined,
    generate: generateGptImage,
  };
}
