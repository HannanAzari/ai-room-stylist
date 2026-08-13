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
 */
import {
  buildReplacementContract,
  selectionToTarget,
  type AssignmentInput,
  type ContractAddition,
  type ReplacementContract,
} from "./replacement-assignment";
import {
  buildReplacementGroups,
  primaryTargetFor,
  toPackageLines,
} from "./replacement-group";
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
  seatingPieceProductCategory,
  type SeatingPlan,
} from "./room-categories";
import type { SceneGraph } from "./scene-graph";
import type { CanonicalCategory } from "./scene-taxonomy";

/** One "replace this type with this product" instruction from the browser. */
export type CategoryIntent = {
  canonicalCategory: CanonicalCategory;
  productId: string;
  /**
   * Narrow to specific pieces. Set only when the customer used "Choose a
   * specific one instead", which is the one path that analyses first. Empty or
   * absent means every piece of this type, which is what choosing a type means.
   */
  sceneItemIds?: string[];
  /** Seating only: what the room should end up with. */
  seatingPlan?: SeatingPlan;
};

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
    const productId = record.productId;
    if (typeof canonicalCategory !== "string" || canonicalCategory === "") {
      return [];
    }
    if (typeof productId !== "string" || productId === "") return [];

    const sceneItemIds = Array.isArray(record.sceneItemIds)
      ? record.sceneItemIds.filter(
          (id): id is string => typeof id === "string" && id !== ""
        )
      : undefined;

    return [
      {
        canonicalCategory: canonicalCategory as CanonicalCategory,
        productId,
        ...(sceneItemIds && sceneItemIds.length > 0 ? { sceneItemIds } : {}),
        ...(isSeatingPlan(record.seatingPlan)
          ? { seatingPlan: record.seatingPlan }
          : {}),
      },
    ];
  });
}

function isSeatingPlan(value: unknown): value is SeatingPlan {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.presetId !== "string") return false;
  if (!Array.isArray(record.pieces)) return false;
  return record.pieces.every((piece) => {
    if (!piece || typeof piece !== "object") return false;
    const entry = piece as Record<string, unknown>;
    return typeof entry.kind === "string" && typeof entry.count === "number";
  });
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
 * The shape of the answer differs by intent:
 *
 *  - A plain type ("replace my rug") becomes one assignment per piece of that
 *    type in the room.
 *  - A seating plan ("end up with one L-shape and two armchairs") is matched
 *    against what is already there. Existing pieces are replaced; anything the
 *    plan asks for beyond that becomes an ADDITION, because the customer named
 *    it and it would otherwise be silently dropped.
 */
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
  const productById = new Map(catalogue.map((product) => [product.id, product]));

  const selections: RoomSelection[] = [];
  const assignments: AssignmentInput[] = [];
  const additions: ContractAddition[] = [];
  const unmatchedCategories: CanonicalCategory[] = [];
  const quantities: Record<string, number> = {};

  // Intents that narrow to named pieces win over the broad "all of this type"
  // reading, exactly as they do in the browser.
  const overrides = intents.reduce<Record<string, string[]>>((map, intent) => {
    if (intent.sceneItemIds && intent.sceneItemIds.length > 0) {
      map[intent.canonicalCategory] = intent.sceneItemIds;
    }
    return map;
  }, {});

  for (const intent of intents) {
    const product = productById.get(intent.productId);
    if (!product) continue;

    const objects = objectsForSelectedCategories(
      [intent.canonicalCategory],
      detected,
      overrides
    );

    if (objects.length === 0) {
      unmatchedCategories.push(intent.canonicalCategory);
    }

    for (const object of objects) {
      const selection = selectionFromDetectedObject(object, sourceImage);
      selections.push(selection);
      assignments.push({
        selectionId: selection.selectionId,
        productId: intent.productId,
        scope: "this-only",
      });
    }
  }

  const contract = buildReplacementContract({
    selections,
    assignments,
    profiles,
    allDetected: detected.map((object) => ({
      sceneItemId: object.sceneItemId,
      canonicalCategory: object.canonicalCategory,
      displayName: object.displayName,
    })),
    sourceImage,
  });

  // Groups decide how many units a room actually needs: two sofas replaced by
  // one L-shape is one unit, two sofas replaced by two two-seaters is two.
  const groups = buildReplacementGroups({
    targetsByCategory: selections.reduce((map, selection, index) => {
      const list = map.get(selection.canonicalCategory) ?? [];
      list.push(selectionToTarget(selection, index));
      map.set(selection.canonicalCategory, list);
      return map;
    }, new Map<CanonicalCategory, ReturnType<typeof selectionToTarget>[]>()),
    productByCategory: intents.reduce((map, intent) => {
      const product = productById.get(intent.productId);
      if (product) map.set(intent.canonicalCategory, product);
      return map;
    }, new Map<CanonicalCategory, Product>()),
  });
  for (const line of toPackageLines(groups)) {
    quantities[line.productId] = line.quantity;
  }

  // A group that collapses several seats into one sectional PLACES that
  // sectional once, so drop the tasks for the seats it absorbs.
  const absorbedTargetIds = new Set(
    groups
      .filter((group) => group.strategy === "replace-group-with-single")
      .flatMap((group) => {
        const primary = primaryTargetFor(group);
        return group.targets
          .filter((target) => target.targetId !== primary.targetId)
          .map((target) => target.targetId);
      })
  );
  const keptAssignments = contract.assignments.filter(
    (assignment) => !absorbedTargetIds.has(assignment.target.targetId)
  );

  // Seating plans can ask for more than the room holds. Those extras are the
  // only additions a replace contract may produce — the customer named them.
  let nextTaskId =
    keptAssignments.reduce((max, a) => Math.max(max, a.taskId), 0) + 1;

  for (const intent of intents) {
    if (!intent.seatingPlan) continue;
    const product = productById.get(intent.productId);
    if (!product) continue;

    for (const piece of intent.seatingPlan.pieces) {
      if (piece.count <= 0) continue;
      const pieceCategory = seatingPieceProductCategory(piece.kind);
      // Only the piece kinds this intent's product can actually supply. An
      // armchair in a sofa plan is a different intent's job, or nobody's.
      if (pieceCategory !== product.category) continue;

      const alreadyPlaced = keptAssignments.filter(
        (assignment) => assignment.productId === intent.productId
      ).length;
      const shortfall = piece.count - alreadyPlaced;
      for (let index = 0; index < shortfall; index += 1) {
        additions.push({
          taskId: nextTaskId,
          action: "PLACE",
          productId: intent.productId,
          productTitle: product.name,
          productCategorySlug: product.category,
          canonicalCategory: intent.canonicalCategory,
          placement:
            "in the seating area, arranged with the other seating so the group reads as one setting",
        });
        nextTaskId += 1;
      }
      if (piece.count > 0) {
        quantities[intent.productId] = Math.max(
          quantities[intent.productId] ?? 0,
          piece.count
        );
      }
    }
  }

  const resolved: ReplacementContract = {
    ...contract,
    assignments: keptAssignments,
    ...(additions.length > 0 ? { additions } : {}),
  };

  const hasWork =
    resolved.assignments.length > 0 || (resolved.additions?.length ?? 0) > 0;

  return {
    contract: hasWork ? resolved : null,
    quantities,
    unmatchedCategories,
  };
}
