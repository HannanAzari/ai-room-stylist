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
import {
  buildProductGroundingPackets,
  formatProductGroundingSection,
  formatSlotSummary,
} from "./product-grounding";
import type { GenerationStage, ReplacementPlan } from "./replacement-planner";
import type { BoundingBox } from "./scene-graph";
import { canonicalCategoryLabel, type CanonicalCategory } from "./scene-taxonomy";
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
  "adding a desk, console, monitor, computer equipment or storage unit that is not in the plan",
  "filling a space left by a removal with any new object",
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
    // Labels arrive both ways — some already carry "the" (ALWAYS_PROTECTED,
    // scene instance labels like "the television"), some are bare category
    // nouns. Stripping any leading "the" before re-adding it once is what
    // keeps this "Never move or alter the television." rather than
    // "the the television." for every already-prefixed label.
    const name = raw.trim().replace(/^the\s+/i, "");
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

  /**
   * What happens to the OTHER objects of a task's category.
   *
   * When more than one object of a category is in play the prompt has to say
   * something about the siblings, and there is exactly one correct thing to
   * say — which depends on what is actually happening to them. The old wording
   * assumed siblings were always being preserved ("every other sofa must remain
   * exactly as photographed"), which is right when one of two sofas is
   * replaced and flatly contradicts the plan when BOTH are: it told the model
   * to leave alone the very sofa the next task orders it to replace. Faced
   * with two contradictory instructions about the same object, doing nothing
   * to it is a perfectly reasonable resolution — and "only one sofa changed"
   * is what that looks like in the render.
   */
  function siblingClause(task: {
    taskId: number;
    existingCanonicalCategory: CanonicalCategory;
    existingInstanceLabel: string;
  }): string {
    const category = task.existingCanonicalCategory;
    const sharedNoun = canonicalCategoryLabel(category);
    const siblingReplacements = plan.replacements.filter(
      (other) =>
        other.existingCanonicalCategory === category &&
        other.taskId !== task.taskId
    );
    const siblingRemovals = plan.removals.filter(
      (other) =>
        other.existingCanonicalCategory === category &&
        other.taskId !== task.taskId
    );
    const preservedSiblings = plan.dispositions.filter(
      (entry) =>
        entry.canonicalCategory === category && entry.disposition === "preserve"
    );

    const handled = [...siblingReplacements, ...siblingRemovals];
    if (handled.length === 0 && preservedSiblings.length === 0) return "";

    const parts: string[] = [
      ` This room contains more than one ${sharedNoun}. THIS task changes ONLY ${task.existingInstanceLabel}.`,
    ];

    if (handled.length > 0) {
      const list = handled
        .map((other) => `${other.existingInstanceLabel} (task ${other.taskId})`)
        .join(", ");
      // Naming the sibling tasks turns "don't touch the others" into "the
      // others have their own tasks — do those too", which is the instruction
      // a multi-sofa replacement actually needs.
      parts.push(
        `The other ${sharedNoun}(s) in this room are NOT to be left alone: ${list} ${handled.length === 1 ? "has its own numbered task" : "have their own numbered tasks"}, which you must also carry out. Every ${sharedNoun} named in a task must end up changed — do not carry out one and skip the others.`
      );
    }

    if (preservedSiblings.length > 0) {
      parts.push(
        `Any ${sharedNoun} NOT named in a numbered task must remain exactly as photographed.`
      );
    }

    return parts.join(" ");
  }

  for (const task of plan.replacements) {
    const colour = task.existingColor ? ` (${task.existingColor})` : "";
    const where = task.location ? `, currently ${task.location}` : "";
    // Target the specific instance. When the room holds more than one object of
    // this category, name it spatially and say explicitly what happens to the
    // others — which is not always "they stay".
    const region = formatRegion(task.boundingBox);
    const regionClause = region ? ` [${region}]` : "";
    const target = task.existingSharesCategory
      ? `${task.existingInstanceLabel}${colour}${where}${regionClause} — and ONLY that one — completely`
      : `the existing ${task.existingCategory}${colour}${where}${regionClause} completely`;
    const othersWarning = task.existingSharesCategory
      ? siblingClause(task)
      : "";
    numbered.push({
      taskId: task.taskId,
      line: `Task ${task.taskId} — Remove ${target}, then replace it with the ${task.productTitle}. Place it ${task.placement}.${othersWarning}\n    IDENTITY (must match the reference image labelled for task ${task.taskId}) — ${formatIdentity(task.identity)}.\n    This must be a genuine replacement: the new product's shape and silhouette must differ from the removed item wherever the reference image differs. Recolouring or restyling the original object is NOT acceptable.`,
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

  // A removal is a real, authorised change with no product attached to it —
  // it must be as explicit as a replacement, or the region it leaves behind
  // is exactly the kind of undocumented gap a model fills with invented
  // furniture.
  for (const task of plan.removals) {
    const where = task.location ? `, currently ${task.location}` : "";
    const target = task.existingSharesCategory
      ? `${task.existingInstanceLabel}${where} — and ONLY that one`
      : `the existing ${task.existingCategory}${where}`;
    const othersWarning = task.existingSharesCategory
      ? siblingClause(task)
      : "";
    numbered.push({
      taskId: task.taskId,
      line: `Task ${task.taskId} — REMOVE ${target} completely. ${task.reason}. Do NOT put any replacement furniture, decor or object in the space it leaves — that area becomes open floor, or is absorbed by the seating placed in another task.${othersWarning}`,
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
 * "This one product must appear N times, as N separate pieces."
 *
 * A room getting two matching 3-seaters produces two tasks bound to the SAME
 * product, sharing ONE reference image. Everything else in the prompt is
 * per-task, so nothing stated the multiplicity outright — and "here is a sofa,
 * here are two tasks that mention it" is easy to satisfy with one sofa. The
 * count is stated as a fact about the finished room, which is the form the
 * reviewer's `product-instance-count-mismatch` check also measures, so the
 * prompt and the gate are asking the same question.
 *
 * Silent for the ordinary case where every product appears once.
 */
function formatDuplicateProductTasks(plan: ReplacementPlan): string[] {
  const byProduct = new Map<
    string,
    { title: string; taskIds: number[] }
  >();

  const record = (productId: string, title: string, taskId: number) => {
    const existing = byProduct.get(productId);
    if (existing) existing.taskIds.push(taskId);
    else byProduct.set(productId, { title, taskIds: [taskId] });
  };

  for (const task of plan.replacements) {
    record(task.productId, task.productTitle, task.taskId);
  }
  for (const task of plan.additions.filter((a) => a.source === "selected")) {
    record(task.productId, task.productTitle, task.taskId);
  }

  return [...byProduct.values()]
    .filter((entry) => entry.taskIds.length > 1)
    .map((entry) => {
      const sorted = [...entry.taskIds].sort((a, b) => a - b);
      const list = `${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
      return `- The ${entry.title} is used ${sorted.length} times, by tasks ${list}. The finished room must contain ${sorted.length} SEPARATE, physically distinct ${entry.title} pieces — one per task, each in its own position. They share one reference image because they are the same model; that is NOT permission to render only one of them. Rendering ${sorted.length - 1} fewer than asked for is a failure.`;
    });
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
    // REPLACE MODE. The customer named the pieces they want changed; anything
    // else appearing is a defect, not a bonus. Renders were coming back with an
    // extra side table nobody asked for, so the allowlist is stated explicitly
    // and the ban is repeated in the model's own vocabulary.
    const allowed = plan
      ? [
          ...new Set(
            [
              ...plan.replacements.map((task) => task.productCategory),
              ...plan.additions
                .filter((task) => task.source === "selected")
                .map((task) => task.productCategory),
              ...plan.removals.map((task) => task.existingCategory),
            ].filter(Boolean)
          ),
        ]
      : [];
    const hasWork = Boolean(
      plan &&
        (plan.replacements.length > 0 ||
          plan.additions.length > 0 ||
          plan.removals.length > 0)
    );

    return [
      "SCOPE — THIS IS A REPLACEMENT, NOT A REDESIGN:",
      allowed.length > 0
        ? `- The ONLY things that may change are: ${allowed.join(", ")}.`
        : hasWork
          ? "- Only the numbered tasks above may change."
          : "- Nothing in this room may change.",
      "- Execute ONLY the numbered tasks above.",
      "- Do NOT add ANY object that is not in those tasks — no side tables, no plants, no lamps, no mirrors, no artwork, no rugs, no cushions, no shelving, no desks, no consoles, no monitors, no computer equipment, no storage units, no decor of any kind.",
      "- Do not introduce any new object that does not correspond to an authorised task. This applies to furniture as much as decor — a desk, a monitor or a console you were not asked for is exactly as much a violation as an unrequested side table.",
      "- Do NOT add an object just because the room looks like it needs one. An empty corner stays empty, and a space left by a REMOVE task stays empty unless another task fills it.",
      "- Do NOT tidy, restyle, relight or improve anything outside those tasks.",
      "- Every other object, and all empty space, must appear EXACTLY as in the uploaded photo.",
      "- If you are unsure whether something may change, leave it alone.",
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
          `REPLACEMENT PLAN — execute EXACTLY these ${count} task(s), in order, and NOTHING else. ALL ${count} must be carried out; completing some and skipping others is a failure, even if the result looks plausible:`,
          ...tasks,
        ].join("\n")
      : "No product changes were requested — keep the room exactly as it appears in the uploaded photo, changing nothing.";

  /**
   * Structured grounding, one block per task.
   *
   * Sits directly after the numbered plan and before the reference note, so the
   * renderer reads "here is what to do", then "here is exactly what each
   * product is and which slot it fills", then "here are the images".
   */
  const groundingPackets = plan ? buildProductGroundingPackets(plan) : [];
  const groundingSection = formatProductGroundingSection(groundingPackets);

  /**
   * Slot counts, including the case the prompt never covered: two DIFFERENT
   * models chosen for two slots. "Same model twice" was stated; "two different
   * models" was not, so two identical sofas satisfied every instruction given.
   */
  const slotSummaryLines = formatSlotSummary(groundingPackets);
  const slotSummarySection =
    slotSummaryLines.length > 0
      ? ["EXACT COUNTS — the finished room:", ...slotSummaryLines.map((line) => `- ${line}`)].join("\n")
      : "";

  const duplicateTasks = plan ? formatDuplicateProductTasks(plan) : [];
  const duplicateSection =
    duplicateTasks.length > 0
      ? [
          "REPEATED PRODUCTS — the same model is required more than once:",
          ...duplicateTasks,
        ].join("\n")
      : "";

  // `referenceViewCount` MUST be the number of images actually transmitted (the
  // reference manifest's transmitted count), never the number loaded from disk.
  // Claiming more references than were sent taught the model to expect images
  // that never arrived.
  const referenceSection = input.referenceViewCount
    ? `PRODUCT REFERENCES — you are given ${input.referenceViewCount} product reference image(s). Each one is introduced by a text line naming its task and product. Treat the image as the EXACT appearance of that product: reproduce its shape, colour, material, finish and proportions faithfully. Do not reinterpret or restyle it, and do not swap products between tasks. These reference images are the REQUIRED OUTCOME, not loose inspiration — a piece that is merely "in the same style" as the reference is a failed render.`
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
    "- Never leave a REMOVE task's item in place — it must be genuinely gone, not recoloured or pushed aside.",
    "- Never fill a REMOVE task's space with a new object of any kind.",
    // The failure this whole sprint exists for, stated as a prohibition as
    // well as an instruction: partial execution is not a safe fallback.
    "- Never carry out only some of the numbered tasks. If two tasks replace two different pieces of furniture, BOTH pieces must change; leaving one of them as photographed is a failure, not a conservative choice.",
    "- Never merge two tasks into one object. Two tasks means two separate pieces of furniture in the finished room, even when they use the same product.",
    "- Never draw two identical pieces where the plan names two DIFFERENT products. If the grounding blocks give two tasks different product names, the finished room must show two visibly different pieces.",
    "- Never treat a selected product as a style hint. The finished piece must be recognisably the product in its reference image, not something in the same genre.",
    "- Generate ONLY the requested replacements, placements and removals.",
  ].join("\n");

  // Sections are joined with blank lines; empty sections drop out entirely so
  // the prompt never contains dangling blank blocks.
  const prompt = [
    `You are re-photographing the customer's real ${roomType} to show ${style} Koala Living furniture. The ${sourceImage} is the ground truth. Produce ONE photorealistic, full-room interior photograph — the whole room visible and uncropped.`,
    lockSection,
    buildArchitectureLock(input.sceneGraph),
    secondPassSection,
    planSection,
    groundingSection,
    slotSummarySection,
    duplicateSection,
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
