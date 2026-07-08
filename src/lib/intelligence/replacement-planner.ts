/**
 * Replacement Planner (Sprint 2).
 *
 * Turns the structured Scene Graph + the customer's selected Koala products into
 * an explicit, DETERMINISTIC replacement plan BEFORE any prompt is built. For
 * every selected product it decides exactly ONE destination:
 *   - REPLACE a specific existing (replaceable) furniture item, or
 *   - PLACE the product into a named empty zone when nothing in the room plays
 *     its role.
 *
 * This makes generation deterministic about *what changes*, which is the single
 * biggest lever against hallucinated / duplicated / removed furniture.
 *
 * Guarantees (mirrors the sprint's rules):
 *  - Every selected product has EXACTLY ONE destination (replace or place).
 *  - No existing furniture item is targeted twice (never duplicate furniture).
 *  - Fixed architecture and fixed objects (TV, AC, curtains, doors, windows,
 *    ceiling, walls, floor, built-ins) are NEVER replaced — only furniture the
 *    scene graph flagged `replaceable` is eligible.
 *  - When several existing items match a product, the highest-confidence one is
 *    chosen.
 *
 * Pure module — no vision/network calls, so it is fully deterministic and
 * fallback-safe (an empty/low-confidence scene graph degrades to placements).
 */
import type { ProductProfile } from "./product-profile";
import type { BoundingBox, SceneFurniture, SceneGraph } from "./scene-graph";

/** Replace a specific existing item with a selected product. */
export type ReplacementTask = {
  kind: "replace";
  existingItemId: string;
  existingCategory: string;
  existingColor: string;
  productId: string;
  productTitle: string;
  productCategory: string;
  placement: string;
  location: string;
  boundingBox: BoundingBox | null;
  // 0-100, taken from the scene graph's confidence for the matched item.
  confidence: number;
};

/** Place a product into an empty zone (no existing counterpart to replace). */
export type PlacementTask = {
  kind: "place";
  productId: string;
  productTitle: string;
  productCategory: string;
  target: string;
  placement: string;
  // "selected" — a customer-selected product with no existing counterpart to
  // replace. "complementary" — an AI-suggested concept-mode accessory (only
  // added when concept mode is on).
  source: "selected" | "complementary";
  // Whether this product's natural home is a wall (art/mirror) vs the floor.
  onWall: boolean;
};

export type ReplacementPlan = {
  replacements: ReplacementTask[];
  additions: PlacementTask[];
  // Fixed objects + non-replaceable furniture that must be preserved untouched.
  preserved: string[];
  analysed: boolean;
};

export type ReplacementPlanInput = {
  sceneGraph?: SceneGraph;
  profiles: ProductProfile[];
  selectedProductIds?: string[];
  aiConceptMode?: boolean;
};

// Extra category synonyms so a scene-graph category string (free-form, e.g.
// "floor lamp") still matches a product's slug/label (e.g. "lighting"/"light").
const CATEGORY_SYNONYMS: Record<string, string[]> = {
  sofas: ["sofa", "couch", "settee", "loveseat", "sectional", "lounge"],
  "coffee-tables": [
    "coffee table",
    "centre table",
    "center table",
    "cocktail table",
  ],
  "dining-tables": ["dining table", "dining"],
  chairs: ["chair", "armchair", "accent chair", "stool", "seat"],
  lighting: ["lamp", "light", "pendant", "chandelier", "sconce"],
  rugs: ["rug", "carpet", "mat"],
  "tv-units": [
    "tv unit",
    "media unit",
    "entertainment unit",
    "console",
    "sideboard",
  ],
  beds: ["bed"],
  "bed-sides": ["bedside", "nightstand", "bedside table"],
  decor: ["art", "painting", "artwork", "mirror", "vase", "plant", "decor"],
};

// Products whose natural home is a wall/empty-wall zone rather than the floor.
const WALL_CATEGORIES = new Set(["decor"]);

function normalise(value: string): string {
  return (value || "").toLowerCase().trim();
}

/** Does a scene-graph furniture category correspond to this product? */
function categoryMatches(
  sceneCategory: string,
  profile: ProductProfile
): boolean {
  const sc = normalise(sceneCategory);
  if (!sc) return false;
  const label = normalise(profile.categoryLabel);
  if (label && (sc.includes(label) || label.includes(sc))) return true;
  const synonyms = CATEGORY_SYNONYMS[profile.category] || [];
  return synonyms.some((syn) => sc.includes(syn));
}

/** Human-readable position of a bounding box, for prompt grounding. */
export function describeLocation(box: BoundingBox | null): string {
  if (!box) return "in its existing position";
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const horizontal = cx < 0.34 ? "left" : cx > 0.66 ? "right" : "centre";
  const vertical = cy < 0.34 ? "upper" : cy > 0.66 ? "lower" : "middle";
  return `${vertical} ${horizontal} of the room`;
}

function pickTargetZone(
  profile: ProductProfile,
  sceneGraph: SceneGraph | undefined
): string {
  const wallZones = sceneGraph?.emptyWalls ?? [];
  const floorZones = sceneGraph?.emptyFloorAreas ?? [];
  if (WALL_CATEGORIES.has(profile.category)) {
    return wallZones[0] || "the largest empty wall";
  }
  return floorZones[0] || "the main open floor area";
}

function toReplacement(
  profile: ProductProfile,
  item: SceneFurniture
): ReplacementTask {
  const rule = profile.replacementRules[0];
  return {
    kind: "replace",
    existingItemId: item.id,
    existingCategory: item.category,
    existingColor:
      item.dominantColor && item.dominantColor !== "unknown"
        ? item.dominantColor
        : "",
    productId: profile.id,
    productTitle: profile.title,
    productCategory: profile.categoryLabel,
    placement: rule?.placement || "in its natural location for this room",
    location: describeLocation(item.boundingBox),
    boundingBox: item.boundingBox,
    // Scene graph stores confidence 0-1; expose it as 0-100 for the plan.
    confidence: Math.round(Math.max(0, Math.min(1, item.confidence)) * 100),
  };
}

function toPlacement(
  profile: ProductProfile,
  sceneGraph: SceneGraph | undefined,
  source: "selected" | "complementary"
): PlacementTask {
  const rule = profile.replacementRules[0];
  return {
    kind: "place",
    productId: profile.id,
    productTitle: profile.title,
    productCategory: profile.categoryLabel,
    target: pickTargetZone(profile, sceneGraph),
    placement: rule?.placement || "in its natural location for this room",
    source,
    onWall: WALL_CATEGORIES.has(profile.category),
  };
}

/**
 * Build the replacement plan. Deterministic: given identical inputs it always
 * returns an identical plan.
 */
export function buildReplacementPlan(
  input: ReplacementPlanInput
): ReplacementPlan {
  const { sceneGraph, profiles } = input;
  const selectedIds = new Set(input.selectedProductIds || []);

  // Partition exactly like the prompt builder: user-selected products drive
  // replacements; complementary (concept-mode) products are always additions.
  const selectedProfiles = selectedIds.size
    ? profiles.filter((p) => selectedIds.has(p.id))
    : profiles;
  const complementaryProfiles = selectedIds.size
    ? profiles.filter((p) => !selectedIds.has(p.id))
    : [];

  // Only furniture the scene graph flagged replaceable is ever eligible. Fixed
  // objects and non-replaceable furniture are excluded here, so architecture
  // and TV/AC/curtains/etc. can never end up in a replacement task.
  const eligibleItems = (sceneGraph?.furniture ?? []).filter(
    (item) => item.replaceable
  );
  const usedItemIds = new Set<string>();

  const replacements: ReplacementTask[] = [];
  const additions: PlacementTask[] = [];

  // Deterministic greedy assignment in selection order: each product takes the
  // highest-confidence unused matching item; if none is free it is placed.
  for (const profile of selectedProfiles) {
    const candidates = eligibleItems
      .filter(
        (item) =>
          !usedItemIds.has(item.id) && categoryMatches(item.category, profile)
      )
      // Highest confidence first; break ties by id for full determinism.
      .sort(
        (a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id)
      );

    const match = candidates[0];
    if (match) {
      usedItemIds.add(match.id);
      replacements.push(toReplacement(profile, match));
    } else {
      additions.push(toPlacement(profile, sceneGraph, "selected"));
    }
  }

  // Complementary products (only present in concept mode) are pure additions.
  for (const profile of complementaryProfiles) {
    additions.push(toPlacement(profile, sceneGraph, "complementary"));
  }

  // Fixed objects + non-replaceable furniture, deduped case-insensitively so
  // e.g. a "TV" fixed object and a "tv" furniture category collapse to one.
  const preservedSeen = new Set<string>();
  const preserved: string[] = [];
  for (const name of [
    ...(sceneGraph?.fixedObjects ?? []).map((object) => object.name),
    ...(sceneGraph?.furniture ?? [])
      .filter((item) => !item.replaceable)
      .map((item) => item.category),
  ]) {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || preservedSeen.has(key)) continue;
    preservedSeen.add(key);
    preserved.push(trimmed);
  }

  return {
    replacements,
    additions,
    preserved,
    analysed: Boolean(sceneGraph?.analysed),
  };
}

/**
 * Render the plan as an explicit, numbered instruction block for the image
 * prompt. Returns "" when there is nothing to say (fallback-safe).
 */
export function formatReplacementPlan(plan: ReplacementPlan): string {
  const lines: string[] = [];
  let taskNumber = 0;

  for (const task of plan.replacements) {
    taskNumber += 1;
    const existing = [
      task.existingCategory,
      task.existingColor ? `(${task.existingColor})` : null,
      `— ${task.location}`,
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(
      `Task ${taskNumber} — REPLACE the existing ${existing} with the ${task.productTitle} (${task.productCategory}). ${task.placement}. Match confidence: ${task.confidence}.`
    );
  }

  for (const task of plan.additions) {
    taskNumber += 1;
    lines.push(
      `Task ${taskNumber} — PLACE the ${task.productTitle} (${task.productCategory}) at ${task.target}. ${task.placement}.`
    );
  }

  if (taskNumber === 0) return "";

  const header =
    "REPLACEMENT PLAN — perform EXACTLY these changes and nothing else. Do not duplicate furniture; do not touch anything not listed here:";
  const footer =
    plan.preserved.length > 0
      ? `Leave untouched (fixed): ${plan.preserved.join(", ")}.`
      : null;

  return [header, ...lines, footer].filter(Boolean).join("\n");
}
