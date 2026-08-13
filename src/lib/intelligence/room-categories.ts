/**
 * The replace menu, seating plans and design-flow state.
 *
 * Two decisions drive this file.
 *
 * FIRST: the menu of things you can replace is known before we look at the
 * room. A living room can contain a sofa, a rug, a coffee table — that is true
 * of living rooms in general, not of this photo. So the menu is prebuilt and
 * appears instantly, and the room is only analysed once the customer has said
 * what they actually want. Nobody waits half a minute to be shown a list we
 * could have written in advance.
 *
 * SECOND: seating is not a one-for-one swap. Someone with two tired sofas may
 * want one L-shape and two armchairs. Expressing that as "replace object A and
 * object B" is the wrong shape, so seating carries a PLAN — what the room
 * should end up with — and the pipeline works out the difference.
 */
import type { CanonicalCategory } from "./scene-taxonomy";
import type { RoomSelection } from "./room-selection";
import { allowedProductCategories } from "./replacement-assignment";

/** How a category is chosen. */
export type CategoryBehaviour =
  /** Pick one product; it replaces what is already there. */
  | "simple"
  /** Configure the arrangement you want to end up with. */
  | "seating";

export type MenuCategory = {
  canonicalCategory: CanonicalCategory;
  /** Customer-facing name, already pluralised where that reads better. */
  label: string;
  behaviour: CategoryBehaviour;
};

/**
 * What a room of each type can contain, in the order it makes sense to offer.
 * Prebuilt on purpose — see the note at the top of this file.
 */
const ROOM_CATEGORY_MENUS: Record<string, MenuCategory[]> = {
  "living room": [
    { canonicalCategory: "sofa", label: "Sofas", behaviour: "seating" },
    { canonicalCategory: "armchair", label: "Armchair", behaviour: "simple" },
    { canonicalCategory: "coffee-table", label: "Coffee table", behaviour: "simple" },
    { canonicalCategory: "rug", label: "Rug", behaviour: "simple" },
    { canonicalCategory: "tv-unit", label: "TV unit", behaviour: "simple" },
    { canonicalCategory: "sideboard", label: "Sideboard", behaviour: "simple" },
    { canonicalCategory: "floor-lamp", label: "Floor lamp", behaviour: "simple" },
    { canonicalCategory: "mirror", label: "Mirror", behaviour: "simple" },
    { canonicalCategory: "artwork", label: "Artwork", behaviour: "simple" },
    { canonicalCategory: "plant", label: "Plant", behaviour: "simple" },
  ],
  "dining room": [
    { canonicalCategory: "dining-table", label: "Dining table", behaviour: "simple" },
    { canonicalCategory: "chair", label: "Dining chairs", behaviour: "simple" },
    { canonicalCategory: "rug", label: "Rug", behaviour: "simple" },
    { canonicalCategory: "sideboard", label: "Sideboard", behaviour: "simple" },
    { canonicalCategory: "ceiling-light", label: "Ceiling light", behaviour: "simple" },
    { canonicalCategory: "artwork", label: "Artwork", behaviour: "simple" },
    { canonicalCategory: "mirror", label: "Mirror", behaviour: "simple" },
    { canonicalCategory: "plant", label: "Plant", behaviour: "simple" },
  ],
  bedroom: [
    { canonicalCategory: "bed", label: "Bed", behaviour: "simple" },
    { canonicalCategory: "bedside", label: "Bedside tables", behaviour: "simple" },
    { canonicalCategory: "dresser", label: "Dresser", behaviour: "simple" },
    { canonicalCategory: "rug", label: "Rug", behaviour: "simple" },
    { canonicalCategory: "armchair", label: "Armchair", behaviour: "simple" },
    { canonicalCategory: "table-lamp", label: "Table lamp", behaviour: "simple" },
    { canonicalCategory: "artwork", label: "Artwork", behaviour: "simple" },
    { canonicalCategory: "mirror", label: "Mirror", behaviour: "simple" },
    { canonicalCategory: "plant", label: "Plant", behaviour: "simple" },
  ],
};

/** The replace menu for a room type. Falls back to the living-room menu. */
export function getCategoryMenu(roomType: string): MenuCategory[] {
  const key = (roomType || "").toLowerCase().trim();
  return ROOM_CATEGORY_MENUS[key] ?? ROOM_CATEGORY_MENUS["living room"];
}

export function getMenuCategory(
  roomType: string,
  category: CanonicalCategory
): MenuCategory | undefined {
  return getCategoryMenu(roomType).find(
    (entry) => entry.canonicalCategory === category
  );
}

/**
 * Can the catalogue actually supply this category today?
 *
 * The menu is written from what a living room contains, not from what Koala
 * stocks, so some entries have nothing behind them yet — there are no
 * sideboards or plants in the catalogue. Those stay visible, because the menu
 * should read like a complete room, but they are marked unavailable rather
 * than letting someone choose one and meet an empty shelf.
 */
export function isCategorySupported(
  category: CanonicalCategory,
  catalogue: { category: string }[]
): boolean {
  const allowed = allowedProductCategories(category);
  if (allowed.length === 0) return false;
  return catalogue.some((product) => allowed.includes(product.category));
}

/** Does this category use the seating configurator? */
export function isSeatingCategory(
  roomType: string,
  category: CanonicalCategory
): boolean {
  return getMenuCategory(roomType, category)?.behaviour === "seating";
}

// ---------------------------------------------------------------------------
// Seating plans
// ---------------------------------------------------------------------------

/**
 * A shape of seating the customer can ask for.
 *
 * No "armchair" kind: the catalogue has none — every product filed under
 * "chairs" is a dining chair — so this screen only offers what Koala can
 * actually deliver. Add one back here the day a real armchair exists.
 */
export type SeatingPieceKind =
  | "sofa-3-seater"
  | "sofa-2-seater"
  | "sofa-l-shape"
  | "sofa-modular";

export type SeatingPiece = {
  kind: SeatingPieceKind;
  count: number;
};

/**
 * What the seating area should end up as — the DESIRED FINAL layout, not a
 * mapping onto what is there now. "One L-shape" means the room should end up
 * with one L-shape sofa, however many sofas it happens to hold today; the
 * pipeline works out the difference.
 */
export type SeatingPlan = {
  pieces: SeatingPiece[];
};

/** The four shapes offered, in the order the stepper lists them. */
export const SEATING_PIECE_KINDS: { kind: SeatingPieceKind; label: string }[] =
  [
    { kind: "sofa-3-seater", label: "3-seater sofa" },
    { kind: "sofa-2-seater", label: "2-seater sofa" },
    { kind: "sofa-l-shape", label: "L-shape sofa" },
    { kind: "sofa-modular", label: "Modular sofa" },
  ];

/**
 * A living room seats a family, not a furniture showroom. Three large pieces
 * is already a generous room; a fourth stops reading as a considered layout.
 */
export const MAX_SEATING_PIECES = 3;

/** Human-readable name for a seating piece. */
export function seatingPieceLabel(kind: SeatingPieceKind): string {
  return (
    SEATING_PIECE_KINDS.find((entry) => entry.kind === kind)?.label ?? kind
  );
}

/** Which catalogue category supplies a seating piece. Always sofas today. */
export function seatingPieceProductCategory(kind: SeatingPieceKind): string {
  void kind;
  return "sofas";
}

/**
 * Build a plan from a count per kind. Zero and absent counts are dropped, so
 * a plan's `pieces` always lists only what was actually asked for — "is
 * there a piece here" and "is the count nonzero" are never two different
 * questions to a caller.
 */
export function buildSeatingPlan(
  counts: Partial<Record<SeatingPieceKind, number>>
): SeatingPlan {
  const pieces: SeatingPiece[] = SEATING_PIECE_KINDS.map(({ kind }) => ({
    kind,
    count: Math.max(0, Math.floor(counts[kind] ?? 0)),
  })).filter((piece) => piece.count > 0);
  return { pieces };
}

/** Total pieces the finished seating area should contain. */
export function seatingPlanPieceCount(plan: SeatingPlan): number {
  return plan.pieces.reduce((total, piece) => total + piece.count, 0);
}

/**
 * A plan is submittable once it asks for at least one piece and stays within
 * the max — the two rules the stepper UI is not allowed to violate.
 */
export function isValidSeatingPlan(plan: SeatingPlan): boolean {
  const total = seatingPlanPieceCount(plan);
  return total >= 1 && total <= MAX_SEATING_PIECES;
}

/** "One L-shape sofa and 2 armchairs" — for confirmation copy and prompts. */
export function describeSeatingPlan(plan: SeatingPlan): string {
  const parts = plan.pieces
    .filter((piece) => piece.count > 0)
    .map((piece) => {
      const label = seatingPieceLabel(piece.kind);
      return piece.count === 1 ? `1 ${label}` : `${piece.count} ${label}s`;
    });
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

export type SurpriseStyle = {
  id: string;
  label: string;
  /**
   * Style tags this maps onto. Empty for "No preference", which must not bias
   * selection at all. These are the hook a richer product feed plugs into —
   * today they are matched against `styleTags`, tomorrow they can also weight
   * merchandising lists.
   */
  styleTags: string[];
};

export const SURPRISE_STYLES: SurpriseStyle[] = [
  { id: "modern", label: "Modern", styleTags: ["modern luxury", "contemporary"] },
  { id: "scandinavian", label: "Scandinavian", styleTags: ["minimal", "warm neutral"] },
  { id: "minimalist", label: "Minimalist", styleTags: ["minimal"] },
  { id: "contemporary", label: "Contemporary", styleTags: ["contemporary"] },
  { id: "coastal", label: "Coastal", styleTags: ["warm neutral", "organic modern"] },
  { id: "warm-neutral", label: "Warm neutral", styleTags: ["warm neutral"] },
  { id: "no-preference", label: "No preference", styleTags: [] },
];

export function getSurpriseStyle(id: string | null): SurpriseStyle | undefined {
  return SURPRISE_STYLES.find((style) => style.id === id);
}

/**
 * The style prompt fragment for a chosen style. "No preference" returns the
 * room's existing direction rather than inventing one.
 */
export function surpriseStylePrompt(
  id: string | null,
  fallback: string
): string {
  const style = getSurpriseStyle(id);
  if (!style || style.styleTags.length === 0) return fallback;
  return style.label.toLowerCase();
}

// ---------------------------------------------------------------------------
// Flow state
// ---------------------------------------------------------------------------

/**
 * Everything the design flow knows.
 *
 * Kept as one declared shape so the pieces that must survive to generation are
 * visible in one place, rather than inferred from a dozen useState calls.
 */
export type DesignFlowState = {
  mode: "replace-items" | "surprise-me" | null;
  roomType: string;
  /** Replace path: the types the customer chose. */
  selectedCategories: CanonicalCategory[];
  /** Surprise path: the chosen style id, or null for no preference. */
  surpriseStyle: string | null;
  /** Configurable categories keyed by canonical category. */
  categoryPlans: Partial<Record<CanonicalCategory, SeatingPlan>>;
  /** One chosen product per catalogue category. */
  selectedProducts: Record<string, string | undefined>;
  /** Targeted detections, only fetched where a category needed them. */
  targetedDetections: Record<string, unknown>;
  /** Hand-marked areas, used only via the fallback path. */
  manualSelections: RoomSelection[];
};

/** A flow with nothing chosen yet. */
export function emptyFlowState(roomType: string): DesignFlowState {
  return {
    mode: null,
    roomType,
    selectedCategories: [],
    surpriseStyle: null,
    categoryPlans: {},
    selectedProducts: {},
    targetedDetections: {},
    manualSelections: [],
  };
}
