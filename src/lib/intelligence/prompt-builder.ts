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
import { formatIdentity, type ProductProfile } from "./product-profile";
import type { GenerationStage, ReplacementPlan } from "./replacement-planner";
import type { BoundingBox } from "./scene-graph";
import { canonicalCategoryLabel } from "./scene-taxonomy";
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
  /**
   * Which pass of a two-stage generation this prompt drives. On the secondary
   * pass the supplied image is the FIRST PASS OUTPUT, not the customer's photo,
   * so the wording changes to protect what pass 1 already placed.
   */
  stage?: GenerationStage;
  /** True when this is the second pass of a two-stage generation. */
  isSecondPass?: boolean;
};

export type IntelligentPrompt = {
  prompt: string;
  negativePrompt: string[];
};

const GLOBAL_NEGATIVE = [
  "cropping, zooming or reframing the room",
  "changing the camera angle or perspective",
  "altering walls, windows, doors, ceiling or floor",
  "adding a door, doorway, window, arch, opening or pass-through that is not in the original",
  "removing or relocating an existing door, window, arch or opening",
  "inventing a view, corridor or adjoining room",
  "changing an object the plan did not name, including another item of the same category",
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
  const numbered: { taskId: number; line: string }[] = [];

  for (const task of plan.replacements) {
    const colour = task.existingColor ? ` (${task.existingColor})` : "";
    const where = task.location ? `, currently ${task.location}` : "";
    // Target the specific instance. When the room holds more than one object of
    // this category, name it spatially and say explicitly that the others stay.
    const sharedNoun = canonicalCategoryLabel(task.existingCanonicalCategory);
    const region = formatRegion(task.boundingBox);
    const regionClause = region ? ` [${region}]` : "";
    const target = task.existingSharesCategory
      ? `${task.existingInstanceLabel}${colour}${where}${regionClause} — and ONLY that one — completely`
      : `the existing ${task.existingCategory}${colour}${where}${regionClause} completely`;
    const othersWarning = task.existingSharesCategory
      ? ` This room contains more than one ${sharedNoun}: change ONLY ${task.existingInstanceLabel}. Every other ${sharedNoun} must remain exactly as photographed.`
      : "";
    numbered.push({
      taskId: task.taskId,
      line: `Task ${task.taskId} — Remove ${target}, then replace it with the ${task.productTitle}. Place it ${task.placement}.${othersWarning}\n    IDENTITY (must match the reference image for task ${task.taskId}) — ${formatIdentity(task.identity)}.\n    This must be a genuine replacement: the new product's shape and silhouette must differ from the removed item wherever the reference image differs. Recolouring or restyling the original object is NOT acceptable.`,
    });
  }

  // Only customer-selected products with no counterpart are part of the core
  // plan; complementary items are handled by the concept-mode section.
  for (const task of plan.additions.filter((a) => a.source === "selected")) {
    const placement = task.onWall
      ? `Place the ${task.productTitle} centred on ${task.target}`
      : `Place the ${task.productTitle} in ${task.target}`;
    numbered.push({
      taskId: task.taskId,
      line: `Task ${task.taskId} — ${placement}, ${task.placement}.\n    IDENTITY (must match the reference image for task ${task.taskId}) — ${formatIdentity(task.identity)}.`,
    });
  }

  // Render in task-number order — the prompt tells the model to execute them
  // "in order", so the listing must actually be ordered. Task numbering comes
  // from the plan, so the prompt, the reference-image labels and the reviewer
  // all refer to the same task by the same number.
  numbered.sort((a, b) => a.taskId - b.taskId);

  return { tasks: numbered.map((entry) => entry.line), count: numbered.length };
}

/**
 * Explicit "leave this alone" instructions for furniture that COULD have been
 * replaced but that no selected product targets.
 *
 * This closes the bug where such an item appeared in neither the replacement
 * list nor the preserved list: the prompt said nothing about it, and the image
 * model resolved that silence by recolouring it instead of leaving it be.
 */
function formatPreservationTasks(plan: ReplacementPlan): string[] {
  return plan.dispositions
    .filter(
      (entry) =>
        entry.disposition === "preserve" &&
        entry.canonicalCategory !== "unknown" &&
        // Fixed objects are already covered by the "never move" section.
        entry.reason.startsWith("Replaceable furniture")
    )
    .map((entry) => {
      const emphasis = entry.sharesCategoryWithOthers
        ? ` A different ${canonicalCategoryLabel(entry.canonicalCategory)} in this room IS being replaced — do not let that change spill onto this one.`
        : "";
      return `- Keep ${entry.instanceLabel} exactly as photographed — same position, same colour, same material, same shape. Do NOT restyle, recolour, resize or replace it.${emphasis}`;
    });
}

/**
 * Region grounding for an explicit replacement contract.
 *
 * There is no masking available on this provider (no image model on the API
 * key advertises an edit/inpaint/mask method), so the region is STATED rather
 * than applied: the object is named, located in words, and pinned to a
 * normalised rectangle of the frame. That is the strongest grounding the
 * provider actually supports, and it is described honestly.
 */
function formatRegion(box: BoundingBox | null): string {
  if (!box) return "";
  const pct = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 100);
  return `region ≈ x ${pct(box.x)}–${pct(box.x + box.width)}%, y ${pct(box.y)}–${pct(box.y + box.height)}% of the frame`;
}

/**
 * Hard architecture lock.
 *
 * Invented doors, windows, arches and openings were the most damaging remaining
 * failure: they make the render stop being a photo of the customer's room. The
 * counted inventory from the scene graph is stated back to the model so the
 * constraint is concrete ("exactly 2 windows and 1 door") rather than a vague
 * instruction to preserve architecture.
 */
function buildArchitectureLock(sceneGraph?: SceneGraph): string {
  const architecture = sceneGraph?.architecture;
  const lines = [
    "ARCHITECTURE LOCK — the room's shell is FIXED and must be reproduced exactly:",
    "- Do NOT add any door, doorway, window, arch, opening, pass-through or alcove that is not in the uploaded photo.",
    "- Do NOT remove, resize, reposition or reshape any existing door, window, arch or opening.",
    "- Do NOT add or remove walls, and do NOT change where walls meet the floor or ceiling.",
    "- Do NOT convert a solid wall into an opening, or an opening into a solid wall.",
    "- Do NOT invent a view, corridor or adjoining room beyond an existing window or doorway.",
  ];

  if (architecture?.counted) {
    lines.push(
      `- The finished image must contain EXACTLY ${architecture.windowCount} window(s), ${architecture.doorCount} door(s)/doorway(s) and ${architecture.openingCount} open arch(es)/pass-through(s) — the same as the uploaded photo, in the same positions.`
    );
    if (architecture.features.length > 0) {
      lines.push(
        `- Preserve these architectural features unchanged: ${architecture.features.join("; ")}.`
      );
    }
  }

  return lines.join("\n");
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
              `  - Task ${task.taskId}: ${task.productTitle} (${task.productCategory}) — ${task.onWall ? `on ${task.target}` : `in ${task.target}`}`
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

  const sourceImage = input.isSecondPass
    ? "supplied image (the result of the previous pass)"
    : "uploaded photo";

  const lockSection = [
    `LOCK THE ROOM — these must stay identical to the ${sourceImage}:`,
    "- Keep the camera exactly identical — same angle, height, focal length and framing.",
    "- Keep the perspective and vanishing point identical.",
    "- Keep the lighting identical — same direction, colour and intensity.",
    "- Keep the architecture identical — walls, windows, doors, ceiling and floor.",
    "- Keep the room dimensions and proportions identical.",
    formatMeasurements(input.measurements),
  ]
    .filter(Boolean)
    .join("\n");

  // On the second pass the anchor furniture is already in place and is now as
  // untouchable as the architecture.
  const secondPassSection = input.isSecondPass
    ? [
        "THIS IS A SECOND EDITING PASS:",
        "- The supplied image already contains the correct large furniture from the previous pass.",
        "- Keep ALL furniture already present exactly as it is — same products, same positions, same colours, same scale.",
        "- Add or replace ONLY the smaller items listed below. Change nothing else.",
      ].join("\n")
    : "";

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

  // `referenceViewCount` MUST be the number of images actually transmitted (the
  // reference manifest's transmitted count), never the number loaded from disk.
  // Claiming more references than were sent taught the model to expect images
  // that never arrived.
  const referenceSection = input.referenceViewCount
    ? `PRODUCT REFERENCES — you are given ${input.referenceViewCount} product reference image(s). Each one is introduced by a text line naming its task and product. Treat the image as the EXACT appearance of that product: reproduce its shape, colour, material, finish and proportions faithfully. Do not reinterpret or restyle it, and do not swap products between tasks.`
    : "";

  const preservationTasks = plan ? formatPreservationTasks(plan) : [];
  const preservationSection =
    preservationTasks.length > 0
      ? ["PRESERVE EXACTLY — existing furniture that is NOT being replaced:", ...preservationTasks].join(
          "\n"
        )
      : "";

  const neverSection = [
    "DO NOT:",
    "- Never overlay new furniture on top of existing furniture.",
    "- Never duplicate furniture.",
    "- Never crop the room.",
    "- Never zoom or reframe.",
    "- Never add a door, window, arch or opening that is not already there.",
    "- Never change an object of the same category as a planned item unless that exact object is named in the plan.",
    ...buildNeverMoveLines(plan?.preserved ?? []),
    "- Never invent furniture that is not in the plan.",
    "- Generate ONLY the requested replacements and placements.",
  ].join("\n");

  // Sections are joined with blank lines; empty sections drop out entirely so
  // the prompt never contains dangling blank blocks.
  const prompt = [
    `You are re-photographing the customer's real ${roomType} to show ${style} Koala Living furniture. The ${sourceImage} is the ground truth. Produce ONE photorealistic, full-room interior photograph — the whole room visible and uncropped.`,
    lockSection,
    buildArchitectureLock(input.sceneGraph),
    secondPassSection,
    planSection,
    preservationSection,
    referenceSection,
    buildConceptSection(aiConceptMode, plan),
    neverSection,
    [
      "PLACEMENT & SCALE:",
      buildScaleInstructions(roomType),
      "- Seat replacement furniture exactly where the removed item stood; anchor rugs under furniture; centre coffee tables; hang wall art centred at believable height.",
    ].join("\n"),
    `AVOID: ${negativePrompt.join("; ")}.`,
    "Output: a single photorealistic, full-room interior photograph — whole room visible, uncropped, with the camera, perspective, lighting and architecture unchanged from the uploaded photo.",
  ]
    .filter((section) => typeof section === "string" && section.trim() !== "")
    .join("\n\n");

  return { prompt, negativePrompt };
}
