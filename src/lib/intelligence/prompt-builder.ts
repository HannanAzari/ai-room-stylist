/**
 * Dynamic Prompt Builder (Phase 4).
 *
 * Builds a per-request image prompt from the room analysis, the selected Koala
 * products and their intelligence profiles, camera/lighting/perspective, and
 * product-specific negative prompts and placement rules. No generic one-size
 * prompt — every field adapts to the actual room and products.
 */
import type { RoomMeasurements } from "@/lib/prompts";
import {
  buildRoomPreservationInstructions,
  buildScaleInstructions,
} from "@/lib/prompts";
import type { ProductProfile } from "./product-profile";
import type { RoomAnalysis } from "./room-analysis";

export type IntelligentPromptInput = {
  roomAnalysis: RoomAnalysis;
  profiles: ProductProfile[];
  style: string;
  roomType: string;
  aiConceptMode: boolean;
  measurements?: RoomMeasurements;
  referenceViewCount?: number;
};

export type IntelligentPrompt = {
  prompt: string;
  negativePrompt: string[];
};

const GLOBAL_NEGATIVE = [
  "people or pets",
  "text, captions, watermarks, logos",
  "distorted, warped or duplicated furniture",
  "impossible perspective or floating objects",
  "changing the room's walls, windows, doors, ceiling or camera angle",
  "cartoonish, CGI or low-quality rendering",
];

function formatMeasurements(measurements?: RoomMeasurements): string {
  if (!measurements) return "";
  const parts = [
    measurements.widthM ? `width ${measurements.widthM}m` : null,
    measurements.lengthM ? `length ${measurements.lengthM}m` : null,
    measurements.ceilingHeightM
      ? `ceiling height ${measurements.ceilingHeightM}m`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? `\nRoom measurements: ${parts.join(", ")}.` : "";
}

function formatRoomSection(analysis: RoomAnalysis): string {
  return [
    "PRESERVE THE CUSTOMER'S ROOM EXACTLY (from analysis of the uploaded photo):",
    `- Room type: ${analysis.roomType}`,
    `- Camera: ${analysis.cameraAngle}; vanishing point ${analysis.vanishingPoint}`,
    `- Floor: ${analysis.floor}`,
    `- Walls: ${analysis.walls}`,
    `- Windows: ${analysis.windows}`,
    `- Doors: ${analysis.doors}`,
    `- Ceiling: ${analysis.ceiling}`,
    `- Lighting: ${analysis.lighting}`,
    analysis.existingFurniture.length > 0
      ? `- Existing furniture to work around/replace: ${analysis.existingFurniture.join(", ")}`
      : null,
    analysis.emptyAreas.length > 0
      ? `- Empty areas: ${analysis.emptyAreas.join(", ")}`
      : null,
    analysis.placementZones.length > 0
      ? `- Natural placement zones: ${analysis.placementZones.join(", ")}`
      : null,
    analysis.colourPalette.length > 0
      ? `- Existing palette: ${analysis.colourPalette.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatProductSection(profiles: ProductProfile[]): string {
  if (profiles.length === 0) {
    return "No specific products supplied — style the room cohesively for the target style.";
  }

  return profiles
    .map((profile, index) => {
      const rule = profile.replacementRules[0];
      return [
        `${index + 1}. ${profile.title}`,
        `   - ${profile.promptFragment}`,
        `   - Materials/texture: ${profile.materials.join(", ") || "premium"} · ${profile.texture}`,
        rule ? `   - Placement: replace ${rule.target}; ${rule.placement}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function conceptModeInstructions(aiConceptMode: boolean): string {
  if (aiConceptMode) {
    return [
      "CONCEPT MODE — ON:",
      "- Keep the supplied products fixed and recognisable, then complete the rest of the room cohesively with matching Koala pieces and styling.",
      "- Coordinate colours, materials and lighting into one curated, shoppable room package.",
    ].join("\n");
  }
  return [
    "CONCEPT MODE — OFF:",
    "- Replace or add ONLY the supplied products. Leave all other furniture, decor and styling untouched.",
  ].join("\n");
}

export function buildIntelligentRoomPrompt(
  input: IntelligentPromptInput
): IntelligentPrompt {
  const { roomAnalysis, profiles, style, roomType, aiConceptMode } = input;

  const productNegatives = profiles.flatMap((profile) => profile.negativePrompt);
  const negativePrompt = [...new Set([...productNegatives, ...GLOBAL_NEGATIVE])];

  const prompt = [
    `You are producing ONE photorealistic ${style} interior photograph of a real ${roomType}.`,
    "",
    formatRoomSection(roomAnalysis) + formatMeasurements(input.measurements),
    "",
    buildRoomPreservationInstructions(),
    "",
    "REAL KOALA PRODUCTS TO PLACE (match each product's visible colour, material, finish, shape, silhouette and base precisely):",
    formatProductSection(profiles),
    input.referenceViewCount
      ? `\nYou are given ${input.referenceViewCount} product reference image(s) — treat them as the source of truth for the products' appearance.`
      : "",
    "",
    conceptModeInstructions(aiConceptMode),
    "",
    "PLACEMENT & SCALE:",
    buildScaleInstructions(roomType),
    "- Respect real clearances, circulation paths and sightlines. Anchor rugs under furniture; centre coffee tables; place lighting at believable heights.",
    "",
    "MATERIAL, LIGHTING & PERSPECTIVE FIDELITY:",
    "- Match the room's existing lighting direction and warmth; render believable shadows and reflections.",
    "- Keep fabric softness, leather sheen, wood grain, stone texture, glass reflection and metal highlights photorealistic.",
    "- Do not change the camera angle, perspective or architecture.",
    "",
    `AVOID: ${negativePrompt.join("; ")}.`,
    "",
    "Output: a single, photorealistic, full-room interior photograph suitable for furniture ecommerce.",
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n");

  return { prompt, negativePrompt };
}
