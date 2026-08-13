/**
 * Desired-vs-existing reconciliation for seating.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN MODULE
 * ---------------------------------------------------------------------------
 * Seating is the one category where "the customer chose a type" does NOT mean
 * "replace every existing instance of it". A seating plan states a DESIRED
 * FINAL COUNT — "one L-shape sofa" — that is independent of how many sofas the
 * room happens to hold today. Reconciling those two numbers into explicit
 * REPLACE / ADD / REMOVE tasks is a genuinely different operation from the
 * simple "match every detected instance" rule that still applies to plain
 * categories like rugs and coffee tables, so it gets its own well-tested
 * function rather than living as a branch inside a bigger one.
 *
 * ---------------------------------------------------------------------------
 * THE ALGORITHM
 * ---------------------------------------------------------------------------
 * Given N existing sofas and a flat, ordered list of M desired pieces (each
 * with its own chosen product):
 *   - the first min(N, M) existing sofas are REPLACED, one each, with the
 *     desired pieces in order;
 *   - any desired pieces beyond that (when M > N) become ADDITIONS — nothing
 *     exists to replace them, so they are placed fresh;
 *   - any existing sofas beyond that (when N > M) become REMOVALS — the room
 *     is being asked to end up with fewer seats than it has, and a leftover
 *     sofa with no task at all is exactly the silent gap that let a model
 *     invent furniture in its place.
 *
 * This one rule produces every case Phase 3 asks for:
 *   - 2 existing, 2×same product desired  → 2 replacements, 0 add, 0 remove.
 *   - 2 existing, 1×L-shape desired       → 1 replacement, 0 add, 1 remove.
 *   - 1 existing, 2×3-seater desired      → 1 replacement, 1 add, 0 remove.
 *
 * Existing instances are ordered deterministically (left to right, then by
 * id) so the same inputs always produce the same plan — which matters for
 * tests and for a regenerate attempt not silently reassigning which sofa
 * becomes what.
 */
import type { SeatingPieceKind } from "./room-categories";
import type { SelectableObject } from "./room-selection";

/** One desired final seating piece, already bound to the product for it. */
export type DesiredSeatingPiece = {
  kind: SeatingPieceKind;
  productId: string;
  productName: string;
};

export type SeatingReplacementPairing = {
  target: SelectableObject;
  piece: DesiredSeatingPiece;
};

export type SeatingReconciliation = {
  /** Existing sofa → desired piece, one to one. */
  replacements: SeatingReplacementPairing[];
  /** Desired pieces with no existing sofa left to become. */
  additions: DesiredSeatingPiece[];
  /** Existing sofas with no desired piece left for them. */
  removals: SelectableObject[];
};

/**
 * Flatten "N of this piece" declarations into one entry per physical unit, in
 * a fixed, reproducible order (the order the kinds are given in — callers
 * pass them in `SEATING_PIECE_KINDS` order). Two 3-seaters of the same
 * product become two identical entries; a mixed request keeps each kind's
 * units grouped together.
 */
export function flattenDesiredPieces(
  pieces: { kind: SeatingPieceKind; count: number; productId: string; productName: string }[]
): DesiredSeatingPiece[] {
  const flat: DesiredSeatingPiece[] = [];
  for (const piece of pieces) {
    for (let index = 0; index < piece.count; index += 1) {
      flat.push({
        kind: piece.kind,
        productId: piece.productId,
        productName: piece.productName,
      });
    }
  }
  return flat;
}

/** Deterministic left-to-right reading order, tie-broken by id. */
function orderExisting(objects: SelectableObject[]): SelectableObject[] {
  return [...objects].sort((a, b) => {
    const ax = a.boundingBox.x;
    const bx = b.boundingBox.x;
    if (ax !== bx) return ax - bx;
    return a.sceneItemId.localeCompare(b.sceneItemId);
  });
}

/** Reconcile what the room has against what the customer wants it to have. */
export function reconcileSeating(input: {
  existing: SelectableObject[];
  desired: DesiredSeatingPiece[];
}): SeatingReconciliation {
  const existingOrdered = orderExisting(input.existing);
  const pairCount = Math.min(existingOrdered.length, input.desired.length);

  const replacements: SeatingReplacementPairing[] = existingOrdered
    .slice(0, pairCount)
    .map((target, index) => ({ target, piece: input.desired[index] }));

  return {
    replacements,
    additions: input.desired.slice(pairCount),
    removals: existingOrdered.slice(pairCount),
  };
}
