/**
 * Design mode + room region selection model (v3 region-first redesign).
 *
 * The customer journey now starts from an explicit INTENT rather than a
 * technical toggle:
 *
 *   "replace-items" — I know which objects in my room I want to change.
 *   "surprise-me"   — Design this room for me with a coherent Koala look.
 *
 * These are genuinely different jobs, so they get different screens and
 * different generation constraints. The old `aiConceptMode` boolean is retained
 * ONLY as the wire format the existing generation pipeline already understands
 * — see `designModeToConceptMode`. Customer-facing code should reason about
 * `DesignMode`, never about that boolean.
 */
import type { BoundingBox } from "./scene-graph";
import type { CanonicalCategory } from "./scene-taxonomy";

export type DesignMode = "replace-items" | "surprise-me";

export const DESIGN_MODES: DesignMode[] = ["replace-items", "surprise-me"];

export function isDesignMode(value: unknown): value is DesignMode {
  return value === "replace-items" || value === "surprise-me";
}

/**
 * Map an intent onto the generation pipeline's existing concept-mode flag.
 *
 *  - "replace-items" → false: change only what the customer picked, add nothing.
 *  - "surprise-me"   → true : complete the room with complementary products.
 *
 * This is a translation at the boundary, not a rename: the backend contract is
 * unchanged, so the whole replacement-accuracy pipeline keeps working exactly
 * as it does on main.
 */
export function designModeToConceptMode(mode: DesignMode): boolean {
  return mode === "surprise-me";
}

/** How a region was selected. */
export type RoomSelectionMethod = "smart" | "manual";

/** A point in normalised (0–1) image space. */
export type SelectionPoint = { x: number; y: number };

/**
 * A region of the customer's room that they want changed.
 *
 * Coordinates are normalised 0–1 against the source image so a selection stays
 * valid across viewport sizes and image scaling.
 *
 * `confidence` is OPTIONAL and must only ever be set from a real model output.
 * A hand-drawn region has no confidence and must leave the field undefined —
 * inventing a number here would put fabricated certainty into the pipeline.
 */
export type RoomSelection = {
  id: string;
  method: RoomSelectionMethod;
  /** Canonical category of the object, once known. */
  canonicalCategory: CanonicalCategory;
  /** Human-readable name shown to the customer, e.g. "the left sofa". */
  label: string;
  boundingBox: BoundingBox;
  /** Optional finer outline, normalised 0–1. */
  polygon?: SelectionPoint[];
  /** Optional encoded mask (e.g. a data URL or RLE string). */
  mask?: string;
  /** 0–1. Present ONLY when a model actually produced it. */
  confidence?: number;
  /** Links this region to a scene-graph furniture instance when matched. */
  instanceId?: string;
};

let selectionCounter = 0;

function nextSelectionId(prefix: string): string {
  selectionCounter += 1;
  return `${prefix}-${selectionCounter}`;
}

/** Reset id generation. Test-only helper; keeps ids deterministic per case. */
export function resetSelectionIds(): void {
  selectionCounter = 0;
}

/**
 * A region the customer drew by hand. Deliberately has NO confidence: the
 * customer's intent is not a probabilistic detection.
 */
export function createManualSelection(input: {
  boundingBox: BoundingBox;
  label?: string;
  canonicalCategory?: CanonicalCategory;
  polygon?: SelectionPoint[];
}): RoomSelection {
  return {
    id: nextSelectionId("manual"),
    method: "manual",
    canonicalCategory: input.canonicalCategory ?? "unknown",
    label: input.label?.trim() || "Selected area",
    boundingBox: input.boundingBox,
    ...(input.polygon ? { polygon: input.polygon } : {}),
  };
}

/**
 * A region proposed by a detection model. `confidence` is carried through only
 * when the model supplied a usable number.
 */
export function createSmartSelection(input: {
  boundingBox: BoundingBox;
  label: string;
  canonicalCategory: CanonicalCategory;
  confidence?: number;
  instanceId?: string;
  polygon?: SelectionPoint[];
  mask?: string;
}): RoomSelection {
  const hasConfidence =
    typeof input.confidence === "number" && Number.isFinite(input.confidence);

  return {
    id: nextSelectionId("smart"),
    method: "smart",
    canonicalCategory: input.canonicalCategory,
    label: input.label.trim() || "Detected object",
    boundingBox: input.boundingBox,
    ...(input.polygon ? { polygon: input.polygon } : {}),
    ...(input.mask ? { mask: input.mask } : {}),
    ...(hasConfidence
      ? { confidence: Math.max(0, Math.min(1, input.confidence as number)) }
      : {}),
    ...(input.instanceId ? { instanceId: input.instanceId } : {}),
  };
}

/** Selections whose region is large enough to act on. */
export function hasUsableArea(selection: RoomSelection): boolean {
  const { width, height } = selection.boundingBox;
  return width > 0.01 && height > 0.01;
}
