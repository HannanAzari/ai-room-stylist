/**
 * Replacement Planner (Sprint 2, hardened by the Replacement Accuracy sprint).
 *
 * Turns the structured Scene Graph + the customer's selected Koala products into
 * an explicit, DETERMINISTIC replacement plan BEFORE any prompt is built. For
 * every selected product it decides exactly ONE destination:
 *   - REPLACE a specific existing (replaceable) furniture item, or
 *   - PLACE the product into a named empty zone when nothing in the room plays
 *     its role.
 *
 * Guarantees (enforced, and covered by the planner invariant tests):
 *  - Every selected product has EXACTLY ONE destination (replace or place).
 *  - Every DETECTED furniture item receives EXACTLY ONE disposition. There is no
 *    silent planner state: an item is REPLACE, PRESERVE, REMOVE or IGNORE, and
 *    IGNORE always carries a documented safe reason. Previously an item that was
 *    replaceable but matched no product appeared in neither `replacements` nor
 *    `preserved`, so the prompt said nothing about it at all — the image model
 *    then tended to recolour it instead of leaving it alone.
 *  - No existing furniture item is targeted twice (never duplicate furniture).
 *  - Fixed architecture and fixed objects (TV, AC, curtains, doors, windows,
 *    built-ins) are NEVER replaced — replaceability comes from the canonical
 *    taxonomy, not raw substring matching.
 *  - Products only ever match scene items whose CANONICAL category their own
 *    category is declared to target, so cross-category swaps are structurally
 *    impossible.
 *  - Task numbering is assigned here, once, and reused verbatim by the prompt
 *    builder, the reference manifest and the reviewer, so the three can never
 *    disagree about which task is which.
 *
 * Pure module — no vision/network calls, so it is fully deterministic and
 * fallback-safe (an empty/low-confidence scene graph degrades to placements).
 */
import type { ProductIdentity, ProductProfile } from "./product-profile";
import type { BoundingBox, SceneFurniture, SceneGraph } from "./scene-graph";
import {
  canonicalTargetsForProductCategory,
  isAnchorCategory,
  isAnchorProductCategory,
  isWallMountedProductCategory,
  productCategoryMatchScore,
  type CanonicalCategory,
} from "./scene-taxonomy";

/**
 * Which generation pass a task belongs to.
 *
 * Large anchor furniture defines the room's composition, so it is generated
 * first against the original photo; smaller secondary pieces are added in a
 * second pass on top of that result. Asking for everything at once measurably
 * degrades fidelity as the task count rises.
 */
export type GenerationStage = "anchor" | "secondary";

/**
 * Detections at or below this confidence are not asserted in the prompt. Telling
 * the image model to "preserve" something the vision model is unsure exists can
 * make it hallucinate that object into the render, so low-confidence unmatched
 * detections are explicitly IGNOREd instead.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.35;

/** Replace a specific existing item with a selected product. */
export type ReplacementTask = {
  kind: "replace";
  taskId: number;
  stage: GenerationStage;
  existingItemId: string;
  existingCategory: string;
  existingCanonicalCategory: CanonicalCategory;
  /** Spatially unambiguous name, e.g. "the left sofa". */
  existingInstanceLabel: string;
  /** True when the room holds other objects of the same category. */
  existingSharesCategory: boolean;
  existingColor: string;
  productId: string;
  productTitle: string;
  /** Structured identity for grounding and verification. */
  identity: ProductIdentity;
  /** Human-readable label, e.g. "entertainment unit". */
  productCategory: string;
  /** Catalogue category slug, e.g. "tv-units" — used for taxonomy checks. */
  productCategorySlug: string;
  placement: string;
  location: string;
  boundingBox: BoundingBox | null;
  // 0-100, taken from the scene graph's confidence for the matched item.
  confidence: number;
};

/**
 * Remove an existing item entirely, with nothing replacing it.
 *
 * The desired-final-layout model needs this as a first-class outcome: "2
 * sofas → 1 L-shape" replaces one and REMOVES the other, and that removed
 * item must be exactly as documented in the prompt as a replaced one — the
 * alternative is a region the prompt says nothing about, which is what let
 * the model invent a desk and monitor in an earlier version of this flow.
 */
export type RemovalTask = {
  kind: "remove";
  taskId: number;
  stage: GenerationStage;
  existingItemId: string;
  existingCategory: string;
  existingCanonicalCategory: CanonicalCategory;
  existingInstanceLabel: string;
  existingSharesCategory: boolean;
  location: string;
  boundingBox: BoundingBox | null;
  /** Why this item is being removed, e.g. "consolidated into task 2". */
  reason: string;
};

/** Place a product into an empty zone (no existing counterpart to replace). */
export type PlacementTask = {
  kind: "place";
  taskId: number;
  stage: GenerationStage;
  productId: string;
  productTitle: string;
  /** Structured identity for grounding and verification. */
  identity: ProductIdentity;
  /** Human-readable label, e.g. "entertainment unit". */
  productCategory: string;
  /** Catalogue category slug, e.g. "tv-units" — used for taxonomy checks. */
  productCategorySlug: string;
  target: string;
  placement: string;
  // "selected" — a customer-selected product with no existing counterpart to
  // replace. "complementary" — an AI-suggested concept-mode accessory (only
  // added when concept mode is on).
  source: "selected" | "complementary";
  // Whether this product's natural home is a wall (art/mirror) vs the floor.
  onWall: boolean;
};

/** What generation must do with a detected room object. */
export type DispositionKind = "replace" | "preserve" | "remove" | "ignore";

/**
 * The explicit fate of one detected furniture item. Every detected item gets
 * exactly one of these — that is the planner's core invariant.
 */
export type FurnitureDisposition = {
  itemId: string;
  rawCategory: string;
  canonicalCategory: CanonicalCategory;
  /** Spatially unambiguous name, e.g. "the right sofa". */
  instanceLabel: string;
  /** True when other detected objects share this canonical category. */
  sharesCategoryWithOthers: boolean;
  disposition: DispositionKind;
  /** Why this disposition was chosen. Always populated. */
  reason: string;
  /** Set only for `replace`. */
  productId: string | null;
  /** Set only for `replace`; matches the prompt's task numbering. */
  taskId: number | null;
};

export type ReplacementPlan = {
  replacements: ReplacementTask[];
  additions: PlacementTask[];
  /** Existing items deleted outright, with nothing replacing them. */
  removals: RemovalTask[];
  // Fixed objects + non-replaceable furniture that must be preserved untouched.
  // Retained for prompt/reviewer compatibility; `dispositions` is authoritative.
  preserved: string[];
  /** Exactly one entry per detected furniture item. */
  dispositions: FurnitureDisposition[];
  analysed: boolean;
};

export type ReplacementPlanInput = {
  sceneGraph?: SceneGraph;
  profiles: ProductProfile[];
  selectedProductIds?: string[];
  aiConceptMode?: boolean;
};

/** Human-readable position of a bounding box, for prompt grounding. */
export function describeLocation(box: BoundingBox | null): string {
  if (!box) return "in its existing position";
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const horizontal = cx < 0.34 ? "left" : cx > 0.66 ? "right" : "centre";
  const vertical = cy < 0.34 ? "upper" : cy > 0.66 ? "lower" : "middle";
  return `${vertical} ${horizontal} of the room`;
}

/**
 * Deterministic, non-repeating placement-zone allocator.
 *
 * Additions used to all read `emptyWalls[0]` / `emptyFloorAreas[0]`, so two
 * unmatched products were told to occupy the identical spot. This hands out
 * each detected zone at most once, preferring category-appropriate zones, and
 * only falls back to the product's own category placement rule (which is far
 * more specific than "the main open floor area") once the pool is exhausted.
 */
class ZoneAllocator {
  private readonly wallZones: string[];
  private readonly floorZones: string[];
  private wallIndex = 0;
  private floorIndex = 0;

  constructor(sceneGraph?: SceneGraph) {
    this.wallZones = [...(sceneGraph?.emptyWalls ?? [])];
    this.floorZones = [...(sceneGraph?.emptyFloorAreas ?? [])];
  }

  allocate(profile: ProductProfile): string {
    const onWall = isWallMountedProductCategory(profile.category);
    const pool = onWall ? this.wallZones : this.floorZones;
    const index = onWall ? this.wallIndex : this.floorIndex;

    if (index < pool.length) {
      if (onWall) this.wallIndex += 1;
      else this.floorIndex += 1;
      return pool[index];
    }

    // Pool exhausted — use the product category's own placement rule, which is
    // specific ("centred in front of the sofa...") rather than a vague zone.
    const rule = profile.replacementRules[0];
    if (rule?.placement) return rule.placement;
    return onWall ? "the largest empty wall" : "the main open floor area";
  }
}

function toReplacement(
  profile: ProductProfile,
  item: SceneFurniture,
  taskId: number
): ReplacementTask {
  const rule = profile.replacementRules[0];
  return {
    kind: "replace",
    taskId,
    // Stage follows the EXISTING object's role in the room: replacing a sofa is
    // an anchor edit regardless of how the product is catalogued.
    stage: isAnchorCategory(item.canonicalCategory) ? "anchor" : "secondary",
    existingItemId: item.id,
    existingCategory: item.category,
    existingCanonicalCategory: item.canonicalCategory,
    existingInstanceLabel: item.instanceLabel,
    existingSharesCategory: item.sharesCategoryWithOthers,
    identity: profile.identity,
    existingColor:
      item.dominantColor && item.dominantColor !== "unknown"
        ? item.dominantColor
        : "",
    productId: profile.id,
    productTitle: profile.title,
    productCategory: profile.categoryLabel,
    productCategorySlug: profile.category,
    placement: rule?.placement || "in its natural location for this room",
    location: describeLocation(item.boundingBox),
    boundingBox: item.boundingBox,
    // Scene graph stores confidence 0-1; expose it as 0-100 for the plan.
    confidence: Math.round(Math.max(0, Math.min(1, item.confidence)) * 100),
  };
}

function toPlacement(
  profile: ProductProfile,
  target: string,
  source: "selected" | "complementary",
  taskId: number
): PlacementTask {
  const rule = profile.replacementRules[0];
  return {
    kind: "place",
    taskId,
    stage: isAnchorProductCategory(profile.category) ? "anchor" : "secondary",
    productId: profile.id,
    productTitle: profile.title,
    identity: profile.identity,
    productCategory: profile.categoryLabel,
    productCategorySlug: profile.category,
    target,
    placement: rule?.placement || "in its natural location for this room",
    source,
    onWall: isWallMountedProductCategory(profile.category),
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
  // Selection order is preserved by ordering from `selectedProductIds` rather
  // than from the (catalogue-ordered) profiles array.
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const selectedProfiles = selectedIds.size
    ? (input.selectedProductIds || [])
        .map((id) => profilesById.get(id))
        .filter((profile): profile is ProductProfile => Boolean(profile))
    : profiles;
  const selectedProfileIds = new Set(selectedProfiles.map((p) => p.id));
  const complementaryProfiles = selectedIds.size
    ? profiles.filter((profile) => !selectedProfileIds.has(profile.id))
    : [];

  const allFurniture = sceneGraph?.furniture ?? [];
  // Only furniture the scene graph flagged replaceable is ever eligible. Fixed
  // objects and non-replaceable furniture are excluded here, so architecture
  // and TV/AC/curtains/etc. can never end up in a replacement task.
  const eligibleItems = allFurniture.filter((item) => item.replaceable);
  const usedItemIds = new Set<string>();

  const replacements: ReplacementTask[] = [];
  const additions: PlacementTask[] = [];
  const zones = new ZoneAllocator(sceneGraph);
  let nextTaskId = 1;

  // Deterministic greedy assignment in CUSTOMER SELECTION order: each product
  // takes the best-matching, highest-confidence unused item; if none is free it
  // is placed into an allocated zone.
  for (const profile of selectedProfiles) {
    const candidates = eligibleItems
      .filter((item) => !usedItemIds.has(item.id))
      .map((item) => ({
        item,
        score: productCategoryMatchScore(profile.category, item.canonicalCategory),
      }))
      // Score 0 means this product category may never replace this canonical
      // category — the structural guard against cross-category swaps.
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.item.confidence - a.item.confidence ||
          a.item.id.localeCompare(b.item.id)
      );

    const match = candidates[0]?.item;
    if (match) {
      usedItemIds.add(match.id);
      replacements.push(toReplacement(profile, match, nextTaskId));
    } else {
      additions.push(
        toPlacement(profile, zones.allocate(profile), "selected", nextTaskId)
      );
    }
    nextTaskId += 1;
  }

  // Complementary products (only present in concept mode) are pure additions.
  for (const profile of complementaryProfiles) {
    additions.push(
      toPlacement(profile, zones.allocate(profile), "complementary", nextTaskId)
    );
    nextTaskId += 1;
  }

  // ---- Dispositions: every detected furniture item, exactly once -----------
  const replacementByItemId = new Map(
    replacements.map((task) => [task.existingItemId, task])
  );
  const dispositions: FurnitureDisposition[] = allFurniture.map((item) => {
    const base = {
      itemId: item.id,
      rawCategory: item.category,
      canonicalCategory: item.canonicalCategory,
      instanceLabel: item.instanceLabel,
      sharesCategoryWithOthers: item.sharesCategoryWithOthers,
    };
    const replacement = replacementByItemId.get(item.id);

    if (replacement) {
      return {
        ...base,
        disposition: "replace" as const,
        reason: `Replaced by the customer-selected ${replacement.productTitle} (task ${replacement.taskId}).`,
        productId: replacement.productId,
        taskId: replacement.taskId,
      };
    }

    if (!item.replaceable) {
      return {
        ...base,
        disposition: "preserve" as const,
        reason:
          item.canonicalCategory === "unknown"
            ? "Unrecognised object category — preserved unchanged rather than risking an unintended edit."
            : "Fixed object or architecture — must never be altered.",
        productId: null,
        taskId: null,
      };
    }

    if (item.confidence <= LOW_CONFIDENCE_THRESHOLD) {
      return {
        ...base,
        disposition: "ignore" as const,
        reason: `Detection confidence ${Math.round(item.confidence * 100)}% is at or below the ${Math.round(
          LOW_CONFIDENCE_THRESHOLD * 100
        )}% threshold — not asserted in the prompt, because instructing the model to preserve an object that may not exist can cause it to invent one.`,
        productId: null,
        taskId: null,
      };
    }

    return {
      ...base,
      disposition: "preserve" as const,
      reason: item.sharesCategoryWithOthers
        ? `Replaceable furniture that no selected product targets. Another object of the same category IS being replaced, so ${item.instanceLabel} must be left untouched to avoid changing both.`
        : "Replaceable furniture that no selected product targets — preserved exactly as photographed.",
      productId: null,
      taskId: null,
    };
  });

  // `preserved` (legacy, string-based) now derives from the authoritative
  // dispositions plus fixed objects, so the two can never disagree.
  const preservedSeen = new Set<string>();
  const preserved: string[] = [];
  for (const name of [
    ...(sceneGraph?.fixedObjects ?? []).map((object) => object.name),
    ...dispositions
      .filter((entry) => entry.disposition === "preserve")
      .map((entry) => entry.rawCategory),
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
    // This detection-driven planner never removes anything outright — it only
    // ever replaces a matched item or places an unmatched product. Removal is
    // a desired-final-layout concept, produced by the category-intent
    // resolver when a seating plan asks for fewer pieces than exist.
    removals: [],
    preserved,
    dispositions,
    analysed: Boolean(sceneGraph?.analysed),
  };
}

/**
 * Split a plan into per-stage sub-plans for two-pass generation.
 *
 * Pass 1 executes the anchor tasks against the customer's original photo; pass
 * 2 executes the secondary tasks against pass 1's output. Each sub-plan keeps
 * the FULL disposition and preservation context, so the second pass still knows
 * which objects must stay untouched — and anchor products already placed are
 * added to the preserved set so pass 2 cannot undo them.
 *
 * Returns a single-stage list when splitting would not help (see
 * `shouldUseTwoStageGeneration`), so simple edits keep their one-pass cost.
 */
export function splitPlanByStage(
  plan: ReplacementPlan
): { stage: GenerationStage; plan: ReplacementPlan }[] {
  const anchorReplacements = plan.replacements.filter((t) => t.stage === "anchor");
  const anchorAdditions = plan.additions.filter((t) => t.stage === "anchor");
  const anchorRemovals = plan.removals.filter((t) => t.stage === "anchor");
  const secondaryReplacements = plan.replacements.filter(
    (t) => t.stage === "secondary"
  );
  const secondaryAdditions = plan.additions.filter(
    (t) => t.stage === "secondary"
  );
  const secondaryRemovals = plan.removals.filter((t) => t.stage === "secondary");

  const anchorPlan: ReplacementPlan = {
    ...plan,
    replacements: anchorReplacements,
    additions: anchorAdditions,
    removals: anchorRemovals,
  };
  // Everything placed OR removed in pass 1 becomes untouchable in pass 2 — a
  // removed item must not be treated as still-present furniture pass 2 could
  // change, so its label joins the preserved-from-pass-1 set exactly like a
  // newly placed product would.
  const anchorProductTitles = [
    ...anchorReplacements.map((t) => t.productTitle),
    ...anchorAdditions.map((t) => t.productTitle),
  ];
  const secondaryPlan: ReplacementPlan = {
    ...plan,
    replacements: secondaryReplacements,
    additions: secondaryAdditions,
    removals: secondaryRemovals,
    preserved: [...plan.preserved, ...anchorProductTitles],
  };

  const stages: { stage: GenerationStage; plan: ReplacementPlan }[] = [];
  if (anchorReplacements.length + anchorAdditions.length + anchorRemovals.length > 0) {
    stages.push({ stage: "anchor", plan: anchorPlan });
  }
  if (
    secondaryReplacements.length +
      secondaryAdditions.length +
      secondaryRemovals.length >
    0
  ) {
    stages.push({ stage: "secondary", plan: secondaryPlan });
  }
  return stages;
}

/**
 * Minimum total tasks before a two-pass generation is worth its extra cost and
 * latency. Below this a single pass is both cheaper and reliable enough.
 */
export const TWO_STAGE_TASK_THRESHOLD = 3;

/**
 * Two passes only pay off when the plan is genuinely mixed: enough tasks to
 * strain a single pass, AND work in both stages. A four-sofa plan gains
 * nothing from splitting.
 */
export function shouldUseTwoStageGeneration(plan: ReplacementPlan): boolean {
  const all = [...plan.replacements, ...plan.additions, ...plan.removals];
  if (all.length < TWO_STAGE_TASK_THRESHOLD) return false;
  const hasAnchor = all.some((task) => task.stage === "anchor");
  const hasSecondary = all.some((task) => task.stage === "secondary");
  return hasAnchor && hasSecondary;
}

/**
 * Planner invariant check. Returns a list of violations (empty when the plan is
 * valid). Exported so tests — and any future runtime assertion — can prove the
 * guarantees rather than trusting them.
 */
export function checkPlanInvariants(
  plan: ReplacementPlan,
  input: { sceneGraph?: SceneGraph; selectedProductIds?: string[] }
): string[] {
  const violations: string[] = [];
  const furniture = input.sceneGraph?.furniture ?? [];

  // 1. Every detected item has exactly one disposition.
  const dispositionCounts = new Map<string, number>();
  for (const entry of plan.dispositions) {
    dispositionCounts.set(
      entry.itemId,
      (dispositionCounts.get(entry.itemId) || 0) + 1
    );
  }
  for (const item of furniture) {
    const count = dispositionCounts.get(item.id) || 0;
    if (count !== 1) {
      violations.push(
        `furniture "${item.id}" has ${count} dispositions (expected exactly 1)`
      );
    }
  }
  for (const entry of plan.dispositions) {
    if (!furniture.some((item) => item.id === entry.itemId)) {
      violations.push(
        `disposition references unknown furniture id "${entry.itemId}"`
      );
    }
  }

  // 2. No fixed object is ever replaced.
  for (const task of plan.replacements) {
    const item = furniture.find((f) => f.id === task.existingItemId);
    if (item && !item.replaceable) {
      violations.push(
        `replacement targets non-replaceable item "${item.id}" (${item.canonicalCategory})`
      );
    }
  }

  // 3. No existing item is targeted twice — by two replacements, two
  //    removals, or one of each. A REPLACE and a REMOVE both claiming the
  //    same footprint is exactly the kind of silent contradiction that used
  //    to leave an item with no real disposition at all.
  const targeted = plan.replacements.map((task) => task.existingItemId);
  if (new Set(targeted).size !== targeted.length) {
    violations.push("an existing item is targeted by more than one replacement");
  }
  const removed = plan.removals.map((task) => task.existingItemId);
  if (new Set(removed).size !== removed.length) {
    violations.push("an existing item is targeted by more than one removal");
  }
  const doubleBooked = removed.filter((id) => targeted.includes(id));
  if (doubleBooked.length > 0) {
    violations.push(
      `item(s) both replaced and removed: ${[...new Set(doubleBooked)].join(", ")}`
    );
  }

  // 3b. No fixed object is ever removed — the same guarantee as #2, for the
  //     other way an existing item can be made to disappear.
  for (const task of plan.removals) {
    const item = furniture.find((f) => f.id === task.existingItemId);
    if (item && !item.replaceable) {
      violations.push(
        `removal targets non-replaceable item "${item.id}" (${item.canonicalCategory})`
      );
    }
  }

  // 4. Every selected product has exactly one destination.
  for (const productId of input.selectedProductIds || []) {
    const destinations =
      plan.replacements.filter((task) => task.productId === productId).length +
      plan.additions.filter((task) => task.productId === productId).length;
    if (destinations !== 1) {
      violations.push(
        `selected product "${productId}" has ${destinations} destinations (expected exactly 1)`
      );
    }
  }

  // 5. Category integrity: a product may only replace a canonical category its
  //    own catalogue category declares as a target. This is the guard that
  //    makes "a TV unit replaced a sofa" impossible.
  for (const task of plan.replacements) {
    const item = furniture.find((f) => f.id === task.existingItemId);
    if (!item) continue;
    const score = productCategoryMatchScore(
      task.productCategorySlug,
      item.canonicalCategory
    );
    if (score <= 0) {
      violations.push(
        `product "${task.productId}" (${task.productCategorySlug}) may not replace a "${item.canonicalCategory}" item; allowed targets: [${canonicalTargetsForProductCategory(
          task.productCategorySlug
        ).join(", ") || "none"}]`
      );
    }
  }

  // 6. Task ids are unique across the whole plan.
  const taskIds = [
    ...plan.replacements.map((task) => task.taskId),
    ...plan.additions.map((task) => task.taskId),
    ...plan.removals.map((task) => task.taskId),
  ];
  if (new Set(taskIds).size !== taskIds.length) {
    violations.push("duplicate task ids in the plan");
  }

  return violations;
}

/**
 * Render the plan as an explicit, numbered instruction block for the image
 * prompt. Returns "" when there is nothing to say (fallback-safe).
 */
export function formatReplacementPlan(plan: ReplacementPlan): string {
  const lines: string[] = [];

  for (const task of plan.replacements) {
    const existing = [
      task.existingCategory,
      task.existingColor ? `(${task.existingColor})` : null,
      `— ${task.location}`,
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(
      `Task ${task.taskId} — REPLACE the existing ${existing} with the ${task.productTitle} (${task.productCategory}). ${task.placement}. Match confidence: ${task.confidence}.`
    );
  }

  for (const task of plan.additions) {
    lines.push(
      `Task ${task.taskId} — PLACE the ${task.productTitle} (${task.productCategory}) at ${task.target}. ${task.placement}.`
    );
  }

  for (const task of plan.removals) {
    const existing = [
      task.existingCategory,
      `— ${task.location}`,
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(
      `Task ${task.taskId} — REMOVE the existing ${existing} completely. Do NOT put any replacement furniture in its place — that space becomes part of the room's remaining open area or the seating placed by another task. ${task.reason}.`
    );
  }

  if (lines.length === 0) return "";

  const header =
    "REPLACEMENT PLAN — perform EXACTLY these changes and nothing else. Do not duplicate furniture; do not touch anything not listed here:";
  const footer =
    plan.preserved.length > 0
      ? `Leave untouched (fixed): ${plan.preserved.join(", ")}.`
      : null;

  return [header, ...lines, footer].filter(Boolean).join("\n");
}
