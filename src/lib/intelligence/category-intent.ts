/**
 * Turning "replace my sofas" into an explicit contract — on the server.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS LIVES HERE AND NOT IN THE BROWSER
 * ---------------------------------------------------------------------------
 * The customer chooses furniture TYPES from a list we can write in advance, so
 * nothing needs analysing to show that list. But a contract needs INSTANCES —
 * this sofa, at these coordinates — and instances only exist once the room has
 * been looked at.
 *
 * The generate route already analyses the room: it must, because "Surprise me"
 * cannot choose a package without knowing what kind of room it is. So the
 * instances are already sitting in that request. Resolving categories here
 * means the customer's intent survives to generation without anyone paying for
 * a second analysis, and without a spinner standing between "Replace items"
 * and the list of things they can replace.
 *
 * The browser sends INTENT. The server, holding the only scene graph anyone
 * paid for, turns it into targets.
 *
 * ---------------------------------------------------------------------------
 * SIMPLE CATEGORIES vs SEATING
 * ---------------------------------------------------------------------------
 * A plain category ("replace my rug") means every existing instance of that
 * type is replaced — the desired count and the existing count are the same
 * thing, because there is no separate concept of a "desired rug count".
 *
 * Seating is different: the customer states a DESIRED FINAL layout ("one
 * L-shape sofa") that is independent of how many sofas the room happens to
 * hold. Treating that the same way a plain category is treated — replace
 * every existing sofa with the chosen product — silently ignores the
 * customer's actual request and, worse, can leave an existing sofa with NO
 * task at all when a plan consolidates seats, which is exactly the kind of
 * undocumented region a model fills with invented furniture. Seating is
 * therefore resolved by `reconcileSeating` (seating-resolution.ts) instead,
 * which reasons from desired count vs existing count and can produce REPLACE,
 * ADD and REMOVE tasks — never a silent gap.
 */
import {
  buildReplacementContract,
  canAssignProductCategory,
  selectionToTarget,
  type AssignmentInput,
  type ContractAddition,
  type ContractRemoval,
  type ReplacementContract,
} from "./replacement-assignment";
import type { Product } from "@/lib/products";
import type { ProductProfile } from "./product-profile";
import {
  objectsForSelectedCategories,
  selectionFromDetectedObject,
  toSelectableObjects,
  type RoomSelection,
  type SourceImageSize,
} from "./room-selection";
import {
  flattenDesiredPieces,
  reconcileSeating,
  type DesiredSeatingPiece,
} from "./seating-resolution";
import type { SeatingPieceKind } from "./room-categories";
import type { SceneGraph } from "./scene-graph";
import type { CanonicalCategory } from "./scene-taxonomy";

/** One desired seating piece as it travels the wire: kind, count, product. */
export type SeatingSelectionEntry = {
  kind: SeatingPieceKind;
  count: number;
  productId: string;
  productName: string;
};

/**
 * One "here is what I want for this type" instruction from the browser.
 *
 * A simple category carries `productId`. Seating carries `seatingSelection`
 * instead — potentially several entries, since a mixed request ("1 three-seat
 * + 1 two-seat") binds a different product to each shape. An intent has
 * exactly one of the two; never both, never neither.
 */
export type CategoryIntent = {
  canonicalCategory: CanonicalCategory;
  /** Simple categories only. */
  productId?: string;
  /**
   * Narrow to specific pieces. Set only when the customer used "Choose a
   * specific one instead", which is the one path that analyses first. Empty or
   * absent means every piece of this type, which is what choosing a type means.
   * Not used for seating — a seating plan already describes the whole
   * category's desired final state, not a subset of it.
   */
  sceneItemIds?: string[];
  /** Seating only: the desired final pieces, each bound to its product. */
  seatingSelection?: SeatingSelectionEntry[];
};

function isSeatingSelectionEntry(value: unknown): value is SeatingSelectionEntry {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.kind === "string" &&
    typeof record.count === "number" &&
    Number.isFinite(record.count) &&
    typeof record.productId === "string" &&
    record.productId !== "" &&
    typeof record.productName === "string"
  );
}

/**
 * Read intents off the wire. Malformed entries are dropped rather than
 * failing the request — a corrupt intent should cost one category, not the
 * whole render.
 */
export function parseCategoryIntents(raw: unknown): CategoryIntent[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry): CategoryIntent[] => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const canonicalCategory = record.canonicalCategory;
    if (typeof canonicalCategory !== "string" || canonicalCategory === "") {
      return [];
    }

    const seatingSelection = Array.isArray(record.seatingSelection)
      ? record.seatingSelection
          .filter(isSeatingSelectionEntry)
          .map((entry) => ({
            kind: entry.kind,
            count: Math.max(0, Math.floor(entry.count)),
            productId: entry.productId,
            productName: entry.productName,
          }))
          .filter((entry) => entry.count > 0)
      : [];

    const productId =
      typeof record.productId === "string" && record.productId !== ""
        ? record.productId
        : undefined;

    // Exactly one of the two shapes. Neither present means there is nothing
    // to act on — drop the entry rather than guess.
    if (seatingSelection.length === 0 && !productId) return [];

    const sceneItemIds = Array.isArray(record.sceneItemIds)
      ? record.sceneItemIds.filter(
          (id): id is string => typeof id === "string" && id !== ""
        )
      : undefined;

    return [
      {
        canonicalCategory: canonicalCategory as CanonicalCategory,
        ...(productId ? { productId } : {}),
        ...(sceneItemIds && sceneItemIds.length > 0 ? { sceneItemIds } : {}),
        ...(seatingSelection.length > 0 ? { seatingSelection } : {}),
      },
    ];
  });
}

/** Every product id an intent references — one for a simple category, one per bound piece for seating. */
export function intentProductIds(intent: CategoryIntent): string[] {
  if (intent.seatingSelection) {
    return intent.seatingSelection.map((entry) => entry.productId);
  }
  return intent.productId ? [intent.productId] : [];
}

export type ResolvedIntent = {
  contract: ReplacementContract | null;
  /** Units per product id, so the basket charges for two sofas when two are used. */
  quantities: Record<string, number>;
  /** Categories the customer asked for that the room has no instance of. */
  unmatchedCategories: CanonicalCategory[];
};

/**
 * Resolve category intents against the room the scene graph describes.
 *
 * Every REPLACE task, whether it came from a plain category or from seating
 * reconciliation, is funnelled through the same `buildReplacementContract`
 * call — one place that assigns task ids, applies the category lock and
 * computes what stays protected. Seating additionally contributes ADD and
 * REMOVE tasks, numbered to continue from whatever `buildReplacementContract`
 * assigned, and its removal targets are struck from `protectedItems` — a
 * removed item must carry exactly one instruction (remove it), never two
 * contradictory ones (remove it, but also leave it exactly as it is).
 */
/**
 * Where a piece should go when the room has no counterpart to replace.
 *
 * An ADD task has no region to point at, so the placement has to be described.
 * These are deliberately relational ("above the main seating", "in an empty
 * corner") rather than absolute: the model can see the room and we cannot, so
 * naming a relationship it can verify beats naming coordinates it would have to
 * invent.
 */
export function defaultPlacementFor(category: CanonicalCategory): string {
  const placements: Partial<Record<CanonicalCategory, string>> = {
    mirror: "on a clear wall where it suits the room, at a natural height",
    artwork: "on a clear wall, hung at a natural height above the main furniture",
    "floor-lamp": "standing on the floor beside the seating, in a spot that is currently empty",
    "table-lamp": "on an existing side table or surface",
    "ceiling-light": "hanging centrally from the ceiling",
    rug: "on the floor under the main seating area",
    plant: "standing in an empty corner or beside the seating",
    "coffee-table": "on the floor in front of the main seating",
    bookshelf: "against a clear wall",
    sideboard: "against a clear wall",
    "tv-unit": "against the wall below the television",
    bedside: "beside the bed",
    dresser: "against a clear wall",
    desk: "against a clear wall with room to sit at it",
    armchair: "in the seating area, angled towards the other seats",
  };
  return (
    placements[category] ??
    "in a natural, empty spot that suits the room without crowding the existing furniture"
  );
}

export function resolveCategoryIntents(input: {
  intents: CategoryIntent[];
  sceneGraph: SceneGraph | undefined;
  catalogue: Product[];
  profiles: ProductProfile[];
  sourceImage: SourceImageSize;
}): ResolvedIntent {
  const { intents, sceneGraph, catalogue, profiles, sourceImage } = input;
  if (intents.length === 0) {
    return { contract: null, quantities: {}, unmatchedCategories: [] };
  }

  const detected = toSelectableObjects(sceneGraph);
  const catalogueIds = new Set(catalogue.map((product) => product.id));

  const selections: RoomSelection[] = [];
  const assignments: AssignmentInput[] = [];
  const pendingAdditions: Omit<ContractAddition, "taskId">[] = [];
  const pendingRemovals: Omit<ContractRemoval, "taskId">[] = [];
  const unmatchedCategories: CanonicalCategory[] = [];
  const quantities: Record<string, number> = {};

  const bump = (productId: string, by: number) => {
    quantities[productId] = (quantities[productId] ?? 0) + by;
  };

  // Narrowing overrides apply only to simple categories — see the type doc on
  // `sceneItemIds`.
  const overrides = intents.reduce<Record<string, string[]>>((map, intent) => {
    if (
      !intent.seatingSelection &&
      intent.sceneItemIds &&
      intent.sceneItemIds.length > 0
    ) {
      map[intent.canonicalCategory] = intent.sceneItemIds;
    }
    return map;
  }, {});

  // --- Simple categories: every existing instance is replaced -------------
  for (const intent of intents) {
    if (intent.seatingSelection || !intent.productId) continue;
    const productId = intent.productId;
    // A product id that doesn't exist in the catalogue can't become a real
    // task — drop the intent rather than build a selection for nothing.
    if (!catalogueIds.has(productId)) continue;

    const objects = objectsForSelectedCategories(
      [intent.canonicalCategory],
      detected,
      overrides
    );
    if (objects.length === 0) {
      /**
       * Nothing of this kind in the room, so PLACE it rather than dropping it.
       *
       * This used to record the category as unmatched and produce no task at
       * all, which — combined with the readiness gate — turned "I would like a
       * mirror" into a dead end. A customer choosing a piece the room does not
       * already have is expressing exactly the intent the catalogue exists to
       * serve.
       */
      const product = catalogue.find((entry) => entry.id === productId);
      /**
       * Two guards, both load-bearing.
       *
       * The room must have been READ. An unanalysed graph is indistinguishable
       * from an empty room, and placing furniture into a room nobody could see
       * is the precise failure the readiness gate exists to prevent — turning
       * it into an ADD task here would route around that gate.
       *
       * And the product must legally fill the category. The replace path gets
       * this from `buildReplacementContract`'s category lock; an addition never
       * touches that code, so without this a rug chosen for an "artwork" slot
       * would be hung on the wall.
       */
      const roomWasRead = Boolean(sceneGraph?.analysed) && (sceneGraph?.furniture ?? []).length > 0;
      const productFits =
        Boolean(product) && canAssignProductCategory(intent.canonicalCategory, product!.category);

      if (product && roomWasRead && productFits) {
        unmatchedCategories.push(intent.canonicalCategory);
        bump(productId, 1);
        pendingAdditions.push({
          action: "PLACE",
          productId,
          productTitle: product.name,
          productCategorySlug: product.category,
          canonicalCategory: intent.canonicalCategory,
          placement: defaultPlacementFor(intent.canonicalCategory),
        });
      } else {
        // Still reported, so the caller knows the choice went nowhere.
        unmatchedCategories.push(intent.canonicalCategory);
      }
      continue;
    }

    for (const object of objects) {
      const selection = selectionFromDetectedObject(object, sourceImage);
      selections.push(selection);
      assignments.push({
        selectionId: selection.selectionId,
        productId,
        scope: "this-only",
      });
    }
    bump(productId, objects.length);
  }

  // --- Seating: desired final layout vs what the room actually holds ------
  for (const intent of intents) {
    if (!intent.seatingSelection || intent.seatingSelection.length === 0) {
      continue;
    }

    const existing = objectsForSelectedCategories(
      [intent.canonicalCategory],
      detected,
      {}
    );
    const desired: DesiredSeatingPiece[] = flattenDesiredPieces(
      intent.seatingSelection
    ).filter((piece) => catalogueIds.has(piece.productId));
    if (desired.length === 0) continue;

    const { replacements, additions, removals } = reconcileSeating({
      existing,
      desired,
    });

    for (const pairing of replacements) {
      const selection = selectionFromDetectedObject(pairing.target, sourceImage);
      selections.push(selection);
      assignments.push({
        selectionId: selection.selectionId,
        productId: pairing.piece.productId,
        scope: "this-only",
      });
      bump(pairing.piece.productId, 1);
    }

    for (const piece of additions) {
      bump(piece.productId, 1);
      pendingAdditions.push({
        action: "PLACE",
        productId: piece.productId,
        productTitle: piece.productName,
        productCategorySlug: "sofas",
        canonicalCategory: intent.canonicalCategory,
        placement:
          "in the seating area, arranged with the other seating so the group reads as one setting",
      });
    }

    for (const target of removals) {
      const selection = selectionFromDetectedObject(target, sourceImage);
      pendingRemovals.push({
        action: "REMOVE",
        target: selectionToTarget(selection, 0),
        canonicalCategory: intent.canonicalCategory,
        reason:
          replacements.length > 0 || additions.length > 0
            ? "the seating area is being consolidated into fewer, larger pieces"
            : "the customer asked for fewer seats than the room currently has",
      });
    }
  }

  const contract = buildReplacementContract({
    selections,
    assignments,
    profiles,
    // The WHOLE scene, not just the customer-selectable subset `detected`
    // narrows to. `toSelectableObjects` drops fixed/non-replaceable items
    // (the TV, architecture-adjacent furniture) because those can never be
    // chosen — but `buildReplacementContract`'s protectedItems accounting is
    // only exhaustive over whatever list it is given. Handing it the
    // selectable subset left every fixed item with NO disposition at all:
    // not replaced, not explicitly preserved either, just absent from the
    // plan the prompt and reviewer both read. Passing the full scene closes
    // that gap without changing what a customer can ever select.
    allDetected: (sceneGraph?.furniture ?? []).map((item) => ({
      sceneItemId: item.id,
      canonicalCategory: item.canonicalCategory,
      displayName: item.instanceLabel,
    })),
    sourceImage,
  });

  // Additions and removals are numbered to continue from whatever
  // `buildReplacementContract` assigned the replace tasks, so every task id
  // in the finished contract is unique and the prompt's numbering is gapless.
  let nextTaskId =
    contract.assignments.reduce((max, a) => Math.max(max, a.taskId), 0) + 1;
  const additions: ContractAddition[] = pendingAdditions.map((addition) => ({
    ...addition,
    taskId: nextTaskId++,
  }));
  const removals: ContractRemoval[] = pendingRemovals.map((removal) => ({
    ...removal,
    taskId: nextTaskId++,
  }));

  // A removed item must carry exactly one instruction. `buildReplacementContract`
  // does not know about removals, so it has already (correctly, from its own
  // point of view) placed every removed scene item in `protectedItems` —
  // "nobody assigned this, so preserve it". That is now wrong for these
  // specific items, and must be corrected here rather than left to silently
  // contradict the removal task.
  const removedSceneIds = new Set(
    removals.map((removal) => removal.target.sceneItemId).filter(Boolean)
  );
  const protectedItems = contract.protectedItems.filter(
    (item) => !item.sceneItemId || !removedSceneIds.has(item.sceneItemId)
  );

  const resolved: ReplacementContract = {
    ...contract,
    protectedItems,
    ...(additions.length > 0 ? { additions } : {}),
    ...(removals.length > 0 ? { removals } : {}),
  };

  const hasWork =
    resolved.assignments.length > 0 ||
    (resolved.additions?.length ?? 0) > 0 ||
    (resolved.removals?.length ?? 0) > 0;

  return {
    contract: hasWork ? resolved : null,
    quantities,
    unmatchedCategories,
  };
}
