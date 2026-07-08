/**
 * Prompt Builder — Generation Pipeline V2 (Sprint 3).
 *
 * The prompt no longer *describes* products. Instead it *executes* the
 * deterministic Replacement Plan: an ordered list of imperative tasks — remove
 * an existing item and replace it with a named Koala product, or place a
 * product in a specific empty zone — wrapped in hard "lock the room" and
 * "never do this" rules.
 *
 * Product appearance comes from the supplied reference images (ground truth),
 * not from prose, which removes a whole class of "the model reimagined the
 * product" drift. The plan already guarantees one destination per product, no
 * duplicated furniture, and no fixed object ever touched — so the prompt can be
 * a faithful executor of that plan.
 *
 * Concept mode OFF → execute the plan and nothing else.
 * Concept mode ON  → execute the plan, then add ONLY tasteful complementary
 *                    Koala accessories.
 *
 * Fully fallback-safe: with an empty/unanalysed plan it degrades to a
 * room-preserving "keep everything as-is" instruction.
 */
import type { RoomMeasurements } from "@/lib/prompts";
import { buildScaleInstructions } from "@/lib/prompts";
import type { ProductProfile } from "./product-profile";
import type { ReplacementPlan } from "./replacement-planner";
import type { RoomAnalysis } from "./room-analysis";
import type { SceneGraph } from "./scene-graph";

export type IntelligentPromptInput = {
  roomAnalysis: RoomAnalysis;
  profiles: ProductProfile[];
  style: string;
  roomType: string;
  aiConceptMode: boolean;
  // Ids the customer explicitly selected. The plan already encodes these; kept
  // here for backward compatibility with callers.
  selectedProductIds?: string[];
  measurements?: RoomMeasurements;
  referenceViewCount?: number;
  // Structured scene understanding (kept for callers / future use).
  sceneGraph?: SceneGraph;
  // The deterministic item→product swap plan this prompt executes.
  replacementPlan?: ReplacementPlan;
};

export type IntelligentPrompt = {
  prompt: string;
  negativePrompt: string[];
};

const GLOBAL_NEGATIVE = [
  "cropping, zooming or reframing the room",
  "changing the camera angle or perspective",
  "altering walls, windows, doors, ceiling or floor",
  "moving or removing the TV, air conditioner, curtains, windows or doors",
  "overlaying new furniture on top of existing furniture",
  "duplicated, cloned or repeated furniture",
  "inventing furniture that is not in the replacement plan",
  "people, pets, text, captions, watermarks or logos",
  "distorted, warped or floating furniture",
  "furniture at an unrealistic scale",
  "cartoonish, CGI or low-quality rendering",
];

// The fixed elements that must never move, always stated explicitly.
const CANONICAL_FIXED = [
  "the windows",
  "the doors",
  "the TV",
  "the air conditioner",
  "the curtains",
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
  return parts.length > 0
    ? `- Keep the room dimensions exactly: ${parts.join(", ")}.`
    : "";
}

/** "Never move ..." lines: the canonical fixed set + any extra preserved items. */
function buildNeverMoveLines(preserved: string[]): string[] {
  const seen = CANONICAL_FIXED.map((item) =>
    item.replace(/^the\s+/i, "").toLowerCase()
  );
  const lines = CANONICAL_FIXED.map((item) => `- Never move or alter ${item}.`);
  for (const raw of preserved) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name) continue;
    // Skip anything already covered by the canonical set.
    if (seen.some((s) => key.includes(s) || s.includes(key))) continue;
    seen.push(key);
    lines.push(`- Never move or alter the ${name}.`);
  }
  return lines;
}

function formatReplacementTasks(plan: ReplacementPlan): {
  tasks: string[];
  count: number;
} {
  const tasks: string[] = [];
  let n = 0;

  for (const task of plan.replacements) {
    n += 1;
    const colour = task.existingColor ? ` (${task.existingColor})` : "";
    const where = task.location ? `, currently ${task.location}` : "";
    tasks.push(
      `Task ${n} — Remove the existing ${task.existingCategory}${colour} completely${where}, then replace it with the ${task.productTitle}. ${task.placement}.`
    );
  }

  // Only customer-selected products with no counterpart are part of the core
  // plan; complementary items are handled by the concept-mode section.
  for (const task of plan.additions.filter((a) => a.source === "selected")) {
    n += 1;
    const placement = task.onWall
      ? `Place the ${task.productTitle} centred on ${task.target}`
      : `Place the ${task.productTitle} in ${task.target}`;
    tasks.push(`Task ${n} — ${placement}. ${task.placement}.`);
  }

  return { tasks, count: n };
}

function buildConceptSection(
  aiConceptMode: boolean,
  plan?: ReplacementPlan
): string {
  if (!aiConceptMode) {
    return [
      "CONCEPT MODE — OFF:",
      "- Execute ONLY the replacement plan above.",
      "- Do NOT add any other furniture, decor, lighting or accessories.",
      "- Leave every unlisted item and all empty space exactly as in the uploaded photo.",
    ].join("\n");
  }

  const complementary = (plan?.additions ?? []).filter(
    (a) => a.source === "complementary"
  );
  const items =
    complementary.length > 0
      ? complementary
          .map(
            (task) =>
              `  - ${task.productTitle} (${task.productCategory}) — ${task.onWall ? `on ${task.target}` : `in ${task.target}`}`
          )
          .join("\n")
      : "  - a few subtle Koala-style accessories (cushions, throws, small decor) only where the room clearly needs them";

  return [
    "CONCEPT MODE — ON:",
    "- First execute the replacement plan above, then add ONLY tasteful complementary Koala accessories to complete the room:",
    items,
    "- Keep additions subtle and secondary; do NOT add large furniture or anything that competes with the planned products.",
    "- Coordinate colours, materials and lighting into one curated, shoppable room package.",
  ].join("\n");
}

export function buildIntelligentRoomPrompt(
  input: IntelligentPromptInput
): IntelligentPrompt {
  const { style, roomType, aiConceptMode } = input;
  const plan = input.replacementPlan;

  const negativePrompt = [...GLOBAL_NEGATIVE];

  const lockSection = [
    "LOCK THE ROOM — these must stay identical to the uploaded photo:",
    "- Keep the camera exactly identical — same angle, height, focal length and framing.",
    "- Keep the perspective and vanishing point identical.",
    "- Keep the lighting identical — same direction, colour and intensity.",
    "- Keep the architecture identical — walls, windows, doors, ceiling and floor.",
    "- Keep the room dimensions and proportions identical.",
    formatMeasurements(input.measurements),
  ]
    .filter(Boolean)
    .join("\n");

  const { tasks, count } = plan
    ? formatReplacementTasks(plan)
    : { tasks: [], count: 0 };

  const planSection =
    count > 0
      ? [
          "REPLACEMENT PLAN — execute EXACTLY these tasks, in order, and NOTHING else:",
          ...tasks,
        ].join("\n")
      : "No product changes were requested — keep the room exactly as it appears in the uploaded photo, changing nothing.";

  const referenceSection = input.referenceViewCount
    ? `PRODUCT REFERENCES — you are given ${input.referenceViewCount} product reference image(s). Treat them as the EXACT appearance of the named products: reproduce their shape, colour, material, finish and proportions faithfully. Do not reinterpret or restyle them.`
    : "";

  const neverSection = [
    "DO NOT:",
    "- Never overlay new furniture on top of existing furniture.",
    "- Never duplicate furniture.",
    "- Never crop the room.",
    "- Never zoom or reframe.",
    ...buildNeverMoveLines(plan?.preserved ?? []),
    "- Never invent furniture that is not in the plan.",
    "- Generate ONLY the requested replacements and placements.",
  ].join("\n");

  const prompt = [
    `You are re-photographing the customer's real ${roomType} to show ${style} Koala Living furniture. The uploaded photo is the ground truth. Produce ONE photorealistic, full-room interior photograph — the whole room visible and uncropped.`,
    "",
    lockSection,
    "",
    planSection,
    "",
    referenceSection,
    "",
    buildConceptSection(aiConceptMode, plan),
    "",
    neverSection,
    "",
    "PLACEMENT & SCALE:",
    buildScaleInstructions(roomType),
    "- Seat replacement furniture exactly where the removed item stood; anchor rugs under furniture; centre coffee tables; hang wall art centred at believable height.",
    "",
    `AVOID: ${negativePrompt.join("; ")}.`,
    "",
    "Output: a single photorealistic, full-room interior photograph — whole room visible, uncropped, with the camera, perspective, lighting and architecture unchanged from the uploaded photo.",
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n");

  return { prompt, negativePrompt };
}
