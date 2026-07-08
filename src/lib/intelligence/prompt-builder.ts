/**
 * Dynamic Prompt Builder (Phase 4, tuned).
 *
 * Builds a per-request image prompt from the room analysis, the selected Koala
 * products and their intelligence profiles, camera/lighting/perspective, and
 * product-specific negative prompts and placement rules.
 *
 * Tuning priorities:
 *  - preserve the FULL visible room (no cropping / reframing / zoom)
 *  - keep camera angle, walls, windows, doors, ceiling and floor
 *  - replace only the categories of the user-selected products
 *  - concept mode ON  → add only complementary Koala items to complete the room
 *  - concept mode OFF → change only the selected products, add nothing else
 *  - never alter architecture
 */
import type { RoomMeasurements } from "@/lib/prompts";
import {
  buildRoomPreservationInstructions,
  buildScaleInstructions,
} from "@/lib/prompts";
import type { ProductProfile } from "./product-profile";
import type { RoomAnalysis } from "./room-analysis";
import type { SceneGraph } from "./scene-graph";

export type IntelligentPromptInput = {
  roomAnalysis: RoomAnalysis;
  profiles: ProductProfile[];
  style: string;
  roomType: string;
  aiConceptMode: boolean;
  // Ids the customer explicitly selected — their categories are the ones we
  // replace; everything else stays as the original room.
  selectedProductIds?: string[];
  measurements?: RoomMeasurements;
  referenceViewCount?: number;
  // Structured scene understanding — used to protect fixed objects and target
  // replaceable furniture precisely.
  sceneGraph?: SceneGraph;
};

export type IntelligentPrompt = {
  prompt: string;
  negativePrompt: string[];
};

const GLOBAL_NEGATIVE = [
  "cropping, zooming or reframing the room",
  "changing the camera angle or perspective",
  "altering walls, windows, doors, ceiling or floor",
  "people or pets",
  "text, captions, watermarks, logos",
  "distorted, warped or duplicated furniture",
  "furniture at an unrealistic scale",
  "impossible perspective or floating objects",
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
    `- Camera: ${analysis.cameraAngle}; vanishing point ${analysis.vanishingPoint} — DO NOT change the camera or crop the frame.`,
    `- Floor: ${analysis.floor} (keep unchanged)`,
    `- Walls: ${analysis.walls} (keep unchanged)`,
    `- Windows: ${analysis.windows} (keep exactly, including light direction)`,
    `- Doors: ${analysis.doors} (keep exactly)`,
    `- Ceiling: ${analysis.ceiling} (keep unchanged)`,
    `- Lighting: ${analysis.lighting}`,
    analysis.existingFurniture.length > 0
      ? `- Existing furniture: ${analysis.existingFurniture.join(", ")}`
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

function formatSceneGraphSection(sceneGraph?: SceneGraph): string {
  if (!sceneGraph) return "";

  const fixedNames = [
    ...sceneGraph.fixedObjects.map((object) => object.name),
    ...sceneGraph.furniture
      .filter((item) => !item.replaceable)
      .map((item) => item.category),
  ];
  const replaceable = sceneGraph.furniture
    .filter((item) => item.replaceable)
    .map(
      (item) =>
        `${item.category}${item.dominantColor && item.dominantColor !== "unknown" ? ` (${item.dominantColor})` : ""}`
    );

  const lines: string[] = [];
  if (fixedNames.length > 0) {
    lines.push(
      `KEEP THESE FIXED OBJECTS EXACTLY — do not move, remove, restyle or cover them: ${[...new Set(fixedNames)].join(", ")}.`
    );
  }
  if (replaceable.length > 0) {
    lines.push(
      `You may replace these existing pieces where a supplied product matches their role: ${[...new Set(replaceable)].join(", ")}.`
    );
  }
  if (sceneGraph.emptyWalls.length > 0) {
    lines.push(`Empty wall areas: ${sceneGraph.emptyWalls.join(", ")}.`);
  }
  return lines.length > 0 ? lines.join("\n") : "";
}

function formatProductLine(profile: ProductProfile, index: number): string {
  const rule = profile.replacementRules[0];
  return [
    `${index + 1}. ${profile.title}`,
    `   - ${profile.promptFragment}`,
    `   - Materials/texture: ${profile.materials.join(", ") || "premium"} · ${profile.texture}`,
    rule ? `   - Placement: replace ${rule.target}; ${rule.placement}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildIntelligentRoomPrompt(
  input: IntelligentPromptInput
): IntelligentPrompt {
  const { roomAnalysis, profiles, style, roomType, aiConceptMode } = input;
  const selectedIds = new Set(input.selectedProductIds || []);

  // Partition into user-selected vs AI-complementary (only meaningful when
  // concept mode added extra products).
  const selectedProfiles = selectedIds.size
    ? profiles.filter((p) => selectedIds.has(p.id))
    : profiles;
  const complementaryProfiles = selectedIds.size
    ? profiles.filter((p) => !selectedIds.has(p.id))
    : [];

  const selectedCategories = [
    ...new Set(selectedProfiles.map((p) => p.categoryLabel)),
  ];

  const productNegatives = profiles.flatMap((profile) => profile.negativePrompt);
  const negativePrompt = [...new Set([...productNegatives, ...GLOBAL_NEGATIVE])];

  const selectedSection =
    selectedProfiles.length > 0
      ? [
          "SELECTED KOALA PRODUCTS — place these, matching each product's visible colour, material, finish, shape, silhouette and base precisely:",
          selectedProfiles.map(formatProductLine).join("\n\n"),
        ].join("\n")
      : "No specific products selected — style the room cohesively for the target style.";

  const replacementScope =
    selectedCategories.length > 0
      ? `Replace ONLY these categories from the original room: ${selectedCategories.join(", ")}. Leave every other category exactly as it appears in the uploaded photo${aiConceptMode ? " unless a complementary item below is added" : ""}.`
      : "Restyle cohesively while keeping the room's architecture and framing.";

  const conceptSection = aiConceptMode
    ? [
        "CONCEPT MODE — ON:",
        "- Keep the selected products fixed and recognisable.",
        complementaryProfiles.length > 0
          ? `- You MAY add ONLY these complementary Koala items to complete the room (do not invent any other furniture):\n${complementaryProfiles.map(formatProductLine).join("\n\n")}`
          : "- You may add a few complementary Koala-style pieces only where the room clearly needs them; do not overfill.",
        "- Coordinate colours, materials and lighting into one curated, shoppable room package.",
      ].join("\n")
    : [
        "CONCEPT MODE — OFF:",
        "- Change ONLY the selected products. Do NOT add any extra furniture, decor or lighting.",
        "- Leave all other furniture, styling and empty space exactly as in the uploaded photo.",
      ].join("\n");

  const prompt = [
    `You are producing ONE photorealistic ${style} interior photograph of the customer's real ${roomType}.`,
    "The uploaded photo is the ground truth for the room. Keep the ENTIRE visible room in frame — do not crop, zoom, pan or reframe.",
    "",
    formatRoomSection(roomAnalysis) + formatMeasurements(input.measurements),
    "",
    buildRoomPreservationInstructions(),
    "",
    formatSceneGraphSection(input.sceneGraph),
    "",
    replacementScope,
    "",
    selectedSection,
    input.referenceViewCount
      ? `\nYou are given ${input.referenceViewCount} product reference image(s) — treat them as the source of truth for the products' appearance.`
      : "",
    "",
    conceptSection,
    "",
    "PLACEMENT & SCALE:",
    buildScaleInstructions(roomType),
    "- Respect real clearances, circulation paths and sightlines. Anchor rugs under furniture; centre coffee tables; place lighting at believable heights.",
    "",
    "MATERIAL, LIGHTING & PERSPECTIVE FIDELITY:",
    "- Match the room's existing lighting direction and warmth; render believable shadows and reflections.",
    "- Keep fabric softness, leather sheen, wood grain, stone texture, glass reflection and metal highlights photorealistic.",
    "- Do not change the camera angle, perspective or architecture, and do not crop the frame.",
    "",
    `AVOID: ${negativePrompt.join("; ")}.`,
    "",
    "Output: a single, photorealistic, full-room interior photograph (whole room visible, uncropped) suitable for furniture ecommerce.",
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n");

  return { prompt, negativePrompt };
}
