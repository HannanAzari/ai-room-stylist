/**
 * Explicit replacement contract (v3 region-first redesign).
 *
 * The pipeline used to be handed a bag of products and left to work out what
 * to do with them. It now receives an unambiguous statement of intent:
 *
 *     THIS region of THIS room  →  THIS exact Koala product.
 *
 * Every change is an explicit target/product pair the customer authorised.
 * Nothing is inferred: not which object a product replaces, not whether a
 * second object of the same category is included, not which reference image
 * belongs to which task.
 *
 * ---------------------------------------------------------------------------
 * PROVIDER REALITY — region grounding, not masking
 * ---------------------------------------------------------------------------
 * Enumerating the models available on this API key shows every image model
 * (`gemini-2.5-flash-image`, `gemini-3.x-*-image`, `imagen-4.0-*`) exposes only
 * `generateContent`/`predict`. NONE advertises an edit, inpaint or mask method
 * — mask-based editing lives behind a different platform entirely. So a region
 * here is geometry we STATE to the model, not a mask we apply. The contract
 * carries the geometry so a genuine masking backend can consume it unchanged
 * if one becomes available, but nothing in this codebase claims masking.
 */
import type { ProductProfile } from "./product-profile";
import type { BoundingBox } from "./scene-graph";
import type {
  RoomSelection,
  SelectionMethod,
  SelectionPoint,
  SourceImageSize,
} from "./room-selection";
import {
  describeLocation,
  type PlacementTask,
  type ReplacementPlan,
  type ReplacementTask,
} from "./replacement-planner";
import {
  canonicalCategoryLabel,
  isAnchorCategory,
  isWallMountedProductCategory,
  type CanonicalCategory,
} from "./scene-taxonomy";

/**
 * Which catalogue categories may fill a region of a given canonical category.
 *
 * This is the category lock. A sofa region can only ever receive a sofa
 * product; a TV-unit region only a TV unit. Cross-category assignment is not
 * merely discouraged in the UI — it is unrepresentable, because a product whose
 * category is not listed here has no way into that region.
 */
const CATEGORY_LOCK: Partial<Record<CanonicalCategory, string[]>> = {
  sofa: ["sofas"],
  // No armchairs in the catalogue — every product filed under "chairs" is a
  // DINING chair, and a dining chair standing where an armchair was is a
  // category error, not a near-enough match. Empty means nothing may fill an
  // armchair region, which surfaces as an honest "coming soon" rather than a
  // wrong product. Add an armchair category here the day the feed has one.
  armchair: [],
  chair: ["chairs"],
  "coffee-table": ["coffee-tables"],
  "dining-table": ["dining-tables"],
  rug: ["rugs"],
  "tv-unit": ["tv-units"],
  bed: ["beds"],
  bedside: ["bed-sides"],
  dresser: ["bed-sides"],
  artwork: ["decor"],
  mirror: ["decor"],
  "floor-lamp": ["lighting"],
  "table-lamp": ["lighting"],
  "ceiling-light": ["lighting"],
};

/** Catalogue categories permitted to fill this region. Empty = nothing may. */
export function allowedProductCategories(
  canonical: CanonicalCategory
): string[] {
  return CATEGORY_LOCK[canonical] ?? [];
}

/** May this catalogue product category fill a region of this canonical type? */
export function canAssignProductCategory(
  regionCategory: CanonicalCategory,
  productCategorySlug: string
): boolean {
  return allowedProductCategories(regionCategory).includes(productCategorySlug);
}

/** Does the customer want one object changed, or every one of its kind? */
export type ReplacementScope = "this-only" | "all-similar";

/** A specific region of the room that a product will be placed into. */
export type ReplacementTarget = {
  /** Stable, readable id, e.g. "scene_sofa_left" or "manual_region_1". */
  targetId: string;
  /** Scene-graph object this refers to; null for a hand-drawn region. */
  sceneItemId: string | null;
  canonicalCategory: CanonicalCategory;
  instanceLabel: string;
  displayName: string;
  boundingBox: BoundingBox;
  polygon?: SelectionPoint[];
  /** Present only if a real masking source ever populates it. */
  mask?: string;
  selectionMethod: SelectionMethod;
  originalObjectDescription?: string;
  /** Human-readable position, derived from the region geometry. */
  location: string;
};

/** One explicit "this region becomes this product" instruction. */
export type ReplacementAssignment = {
  taskId: number;
  action: "REPLACE";
  target: ReplacementTarget;
  productId: string;
  productTitle: string;
  productCategorySlug: string;
  canonicalCategory: CanonicalCategory;
  /** Whether this task came from a "replace all similar" decision. */
  scope: ReplacementScope;
};

/** Something that must survive the edit untouched. */
export type ProtectedItem = {
  /** Scene object id when known; null for architectural categories. */
  sceneItemId: string | null;
  label: string;
  reason: string;
  /** Known for detected objects; absent for blanket architectural entries. */
  canonicalCategory?: CanonicalCategory;
};

/**
 * A piece the customer asked for that has no counterpart in the room.
 *
 * Seating plans make this real: someone with two sofas and no armchairs can
 * ask to end up with an L-shape AND two armchairs. The sofa is a replacement;
 * the armchairs are not replacing anything. Without this the extra pieces
 * would be quietly dropped and the promise broken.
 */
export type ContractAddition = {
  taskId: number;
  action: "PLACE";
  productId: string;
  productTitle: string;
  productCategorySlug: string;
  canonicalCategory: CanonicalCategory;
  /** Where it should go, in words — there is no region to point at. */
  placement: string;
};

/** The complete, explicit instruction set handed to generation. */
export type ReplacementContract = {
  assignments: ReplacementAssignment[];
  /** Pieces with nothing to replace. Empty for a plain swap. */
  additions?: ContractAddition[];
  protectedItems: ProtectedItem[];
  sourceImage: SourceImageSize;
};

/** Readable target id from a selection, e.g. "scene_sofa_left". */
export function buildTargetId(selection: RoomSelection, index: number): string {
  if (selection.sceneItemId) {
    return `scene_${selection.sceneItemId}`.replace(/[^a-zA-Z0-9_]+/g, "_");
  }
  return `manual_region_${index + 1}`;
}

/** Turn an authorised selection into a replacement target. */
export function selectionToTarget(
  selection: RoomSelection,
  index: number
): ReplacementTarget {
  return {
    targetId: buildTargetId(selection, index),
    sceneItemId: selection.sceneItemId,
    canonicalCategory: selection.canonicalCategory,
    instanceLabel: selection.instanceLabel,
    displayName: selection.displayName,
    boundingBox: selection.boundingBox,
    ...(selection.polygon ? { polygon: selection.polygon } : {}),
    ...(selection.mask ? { mask: selection.mask } : {}),
    selectionMethod: selection.selectionMethod,
    ...(selection.originalObjectDescription
      ? { originalObjectDescription: selection.originalObjectDescription }
      : {}),
    location: describeLocation(selection.boundingBox),
  };
}

export type AssignmentInput = {
  /** Selection this assignment is for. */
  selectionId: string;
  productId: string;
  scope: ReplacementScope;
};

/**
 * Build the contract from authorised selections plus the customer's product
 * choices.
 *
 * Rules enforced here, not left to the caller:
 *  - a product may only fill a region its category is locked to;
 *  - "all-similar" expands to an EXPLICIT target per matching instance, so a
 *    bulk decision still produces individually named tasks;
 *  - every selection without an assignment, and every unselected object, lands
 *    in `protectedItems`. Nothing is changed by omission.
 */
export function buildReplacementContract(input: {
  selections: RoomSelection[];
  assignments: AssignmentInput[];
  profiles: ProductProfile[];
  /** Every object detected in the room, selected or not. */
  allDetected: {
    sceneItemId: string;
    canonicalCategory: CanonicalCategory;
    displayName: string;
  }[];
  sourceImage: SourceImageSize;
}): ReplacementContract {
  const profileById = new Map(input.profiles.map((p) => [p.id, p]));
  const selectionById = new Map(
    input.selections.map((s) => [s.selectionId, s])
  );
  const targetBySelectionId = new Map(
    input.selections.map((selection, index) => [
      selection.selectionId,
      selectionToTarget(selection, index),
    ])
  );

  const assignments: ReplacementAssignment[] = [];
  const assignedSceneIds = new Set<string>();
  let nextTaskId = 1;

  for (const entry of input.assignments) {
    const selection = selectionById.get(entry.selectionId);
    const profile = profileById.get(entry.productId);
    if (!selection || !profile) continue;

    // The category lock. A product that cannot legally fill this region is
    // dropped rather than quietly placed somewhere it does not belong.
    if (!canAssignProductCategory(selection.canonicalCategory, profile.category)) {
      continue;
    }

    const primaryTarget = targetBySelectionId.get(entry.selectionId);
    if (!primaryTarget) continue;

    const targets: ReplacementTarget[] = [primaryTarget];

    // "All similar" becomes one explicit task per instance — never a single
    // fuzzy instruction to change everything of a kind.
    if (entry.scope === "all-similar") {
      const siblings = input.allDetected.filter(
        (object) =>
          object.canonicalCategory === selection.canonicalCategory &&
          object.sceneItemId !== selection.sceneItemId
      );
      siblings.forEach((sibling) => {
        targets.push({
          targetId: `scene_${sibling.sceneItemId}`.replace(/[^a-zA-Z0-9_]+/g, "_"),
          sceneItemId: sibling.sceneItemId,
          canonicalCategory: sibling.canonicalCategory,
          instanceLabel: sibling.displayName,
          displayName: sibling.displayName,
          // A sibling expanded from "all similar" has no drawn region of its
          // own; generation identifies it by name and category.
          boundingBox: primaryTarget.boundingBox,
          selectionMethod: selection.selectionMethod,
          location: `at the position of ${sibling.displayName}`,
        });
      });
      void siblings;
    }

    for (const target of targets) {
      assignments.push({
        taskId: nextTaskId,
        action: "REPLACE",
        target,
        productId: profile.id,
        productTitle: profile.title,
        productCategorySlug: profile.category,
        canonicalCategory: target.canonicalCategory,
        scope: entry.scope,
      });
      if (target.sceneItemId) assignedSceneIds.add(target.sceneItemId);
      nextTaskId += 1;
    }
  }

  // Everything not explicitly assigned is protected — including objects the
  // customer selected but never assigned a product to.
  const protectedItems: ProtectedItem[] = [];
  for (const object of input.allDetected) {
    if (assignedSceneIds.has(object.sceneItemId)) continue;
    protectedItems.push({
      sceneItemId: object.sceneItemId,
      label: object.displayName,
      reason: "not assigned a replacement — must stay exactly as photographed",
      canonicalCategory: object.canonicalCategory,
    });
  }

  return {
    assignments,
    protectedItems,
    sourceImage: input.sourceImage,
  };
}

/** Fixed architecture that is always protected, stated explicitly. */
export const ALWAYS_PROTECTED: ProtectedItem[] = [
  { sceneItemId: null, label: "the television", reason: "fixed object" },
  { sceneItemId: null, label: "the windows", reason: "architecture" },
  { sceneItemId: null, label: "the doors", reason: "architecture" },
  { sceneItemId: null, label: "the walls", reason: "architecture" },
  { sceneItemId: null, label: "the floor", reason: "architecture" },
  { sceneItemId: null, label: "the ceiling", reason: "architecture" },
  { sceneItemId: null, label: "the air conditioner", reason: "fixed object" },
  { sceneItemId: null, label: "the curtains", reason: "fixed object" },
];

/**
 * Convert the explicit contract into the pipeline's `ReplacementPlan`.
 *
 * This is a direct translation, not a matching step: the customer already said
 * which object becomes which product, so there is nothing to infer. That is the
 * whole point — the ambiguity that used to live in the planner is gone.
 */
export function contractToReplacementPlan(
  contract: ReplacementContract,
  profiles: ProductProfile[]
): ReplacementPlan {
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  const replacements: ReplacementTask[] = contract.assignments
    .map((assignment): ReplacementTask | null => {
      const profile = profileById.get(assignment.productId);
      if (!profile) return null;
      const rule = profile.replacementRules[0];

      return {
        kind: "replace",
        taskId: assignment.taskId,
        stage: isAnchorCategory(assignment.canonicalCategory)
          ? "anchor"
          : "secondary",
        existingItemId: assignment.target.sceneItemId ?? assignment.target.targetId,
        existingCategory:
          assignment.target.originalObjectDescription ||
          canonicalCategoryLabel(assignment.canonicalCategory),
        existingCanonicalCategory: assignment.canonicalCategory,
        existingInstanceLabel: assignment.target.instanceLabel,
        // True when a PROTECTED object shares this category. That is exactly
        // the dangerous case — "replace the sofa" would be ambiguous — so the
        // prompt must name the instance and spell out that the other is
        // off-limits.
        existingSharesCategory: contract.protectedItems.some(
          (item) => item.canonicalCategory === assignment.canonicalCategory
        ),
        identity: profile.identity,
        existingColor: "",
        productId: profile.id,
        productTitle: profile.title,
        productCategory: profile.categoryLabel,
        productCategorySlug: profile.category,
        placement: rule?.placement || "in its existing position",
        location: assignment.target.location,
        boundingBox: assignment.target.boundingBox,
        // The customer chose this target explicitly; there is no detection
        // confidence to report about the decision itself.
        confidence: 100,
      };
    })
    .filter((task): task is ReplacementTask => task !== null);

  // Pieces with nothing to replace. These are the only additions a replace
  // contract may produce — the customer asked for them by name, so they are
  // not the "improve the room" additions the no-additions guardrail forbids.
  const additions: PlacementTask[] = (contract.additions ?? [])
    .map((addition): PlacementTask | null => {
      const profile = profileById.get(addition.productId);
      if (!profile) return null;
      return {
        kind: "place",
        taskId: addition.taskId,
        stage: isAnchorCategory(addition.canonicalCategory)
          ? "anchor"
          : "secondary",
        productId: profile.id,
        productTitle: profile.title,
        identity: profile.identity,
        productCategory: profile.categoryLabel,
        productCategorySlug: profile.category,
        target: "an open area of the room",
        placement: addition.placement,
        source: "selected",
        onWall: isWallMountedProductCategory(profile.category),
      };
    })
    .filter((task): task is PlacementTask => task !== null);

  const preserved = [
    ...contract.protectedItems.map((item) => item.label),
    ...ALWAYS_PROTECTED.map((item) => item.label),
  ];

  // Dispositions drive the prompt's explicit "PRESERVE EXACTLY" block and the
  // reviewer's unchanged-object checks. Leaving them empty would silently drop
  // both, so every contract item gets one — replaced or protected.
  const dispositions: ReplacementPlan["dispositions"] = [
    ...contract.assignments.map((assignment) => ({
      itemId: assignment.target.sceneItemId ?? assignment.target.targetId,
      rawCategory: canonicalCategoryLabel(assignment.canonicalCategory),
      canonicalCategory: assignment.canonicalCategory,
      instanceLabel: assignment.target.instanceLabel,
      sharesCategoryWithOthers: contract.protectedItems.some(
        (item) => item.canonicalCategory === assignment.canonicalCategory
      ),
      disposition: "replace" as const,
      reason: `Explicitly assigned by the customer to ${assignment.productTitle} (task ${assignment.taskId}).`,
      productId: assignment.productId,
      taskId: assignment.taskId,
    })),
    ...contract.protectedItems
      .filter((item) => item.sceneItemId !== null)
      .map((item) => ({
        itemId: item.sceneItemId as string,
        rawCategory: item.canonicalCategory
          ? canonicalCategoryLabel(item.canonicalCategory)
          : item.label,
        canonicalCategory: (item.canonicalCategory ??
          "unknown") as CanonicalCategory,
        instanceLabel: item.label,
        sharesCategoryWithOthers: contract.assignments.some(
          (assignment) => assignment.canonicalCategory === item.canonicalCategory
        ),
        disposition: "preserve" as const,
        // The prompt builder keys its preservation block off this prefix.
        reason: `Replaceable furniture that no selected product targets — ${item.reason}`,
        productId: null,
        taskId: null,
      })),
  ];

  return {
    replacements,
    additions,
    preserved: [...new Set(preserved)],
    dispositions,
    analysed: true,
  };
}

/** Every product id the contract intends to place, replacements and additions. */
export function contractProductIds(contract: ReplacementContract): string[] {
  return [
    ...new Set([
      ...contract.assignments.map((a) => a.productId),
      ...(contract.additions ?? []).map((a) => a.productId),
    ]),
  ];
}

/** Human-readable summary of the contract, for confirmation screens. */
export function summariseContract(contract: ReplacementContract): string[] {
  return contract.assignments.map(
    (assignment) =>
      `${assignment.target.displayName} → ${assignment.productTitle}`
  );
}
