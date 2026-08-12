/**
 * Design mode + room object selection model (v3 region-first redesign).
 *
 * The customer journey starts from an explicit INTENT rather than a technical
 * toggle:
 *
 *   "replace-items" — I know which objects in my room I want to change.
 *   "surprise-me"   — Design this room for me with a coherent Koala look.
 *
 * The old `aiConceptMode` boolean survives ONLY as the wire format the existing
 * generation pipeline understands — see `designModeToConceptMode`.
 *
 * ---------------------------------------------------------------------------
 * SELECTION REPRESENTATION — why boxes, not masks
 * ---------------------------------------------------------------------------
 * We probed `gemini-2.5-flash` directly for segmentation masks. Bounding boxes
 * come back real and accurate, but the mask field does NOT contain usable data:
 *
 *   - with `responseMimeType: application/json` the mask is the literal
 *     placeholder string "gimme_mask_for_this";
 *   - without it, the mask is a run of internal codebook tokens
 *     ("<start_of_mask><seg_18><seg_58>…") that need a proprietary decoder.
 *
 * Neither is a renderable probability map. So smart selection is represented by
 * BOUNDING BOXES derived from scene analysis, and the UI says so rather than
 * implying pixel-accurate cut-outs. `polygon` and `mask` are optional on the
 * contract from day one, so a real segmentation source can populate them later
 * without touching any consumer.
 *
 * ---------------------------------------------------------------------------
 * TRUST PRINCIPLE
 * ---------------------------------------------------------------------------
 * NO SELECTION = NO PERMISSION TO CHANGE THAT OBJECT. Every selection is tied
 * to ONE scene item by `sceneItemId`. Selecting one sofa never implies
 * permission to change another sofa, even of the identical category.
 */
import type { BoundingBox, SceneFurniture, SceneGraph } from "./scene-graph";
import {
  isReplaceableCanonical,
  type CanonicalCategory,
} from "./scene-taxonomy";

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
 */
export function designModeToConceptMode(mode: DesignMode): boolean {
  return mode === "surprise-me";
}

/** How a region was selected. */
export type SelectionMethod = "smart" | "manual";

/** A point in normalised (0–1) image space. */
export type SelectionPoint = { x: number; y: number };

/** Pixel dimensions of the room photo a selection was made against. */
export type SourceImageSize = { width: number; height: number };

/**
 * Categories that are never offered for selection even if the vision model
 * reports them as furniture. These are things a customer cannot buy their way
 * out of — changing them stops the render being a photo of THEIR room.
 *
 * This is belt-and-braces on top of `isReplaceableCanonical`: that function is
 * the pipeline's rule, this list is the customer-facing promise.
 */
const NEVER_SELECTABLE: ReadonlySet<CanonicalCategory> = new Set([
  "tv",
  "window",
  "door",
  "curtains",
  "air-conditioner",
  "fireplace",
  "radiator",
  "ceiling-fan",
  "built-in",
  "unknown",
]);

/** Is this canonical category offerable as a replaceable selection? */
export function isSelectableCategory(canonical: CanonicalCategory): boolean {
  if (NEVER_SELECTABLE.has(canonical)) return false;
  return isReplaceableCanonical(canonical);
}

/**
 * A candidate object the customer may tap. Derived from scene analysis; carries
 * no permission on its own — permission only exists once it is selected.
 */
export type SelectableObject = {
  sceneItemId: string;
  canonicalCategory: CanonicalCategory;
  /** Spatially disambiguated, e.g. "the left sofa". */
  instanceLabel: string;
  /** Short customer-facing name, e.g. "Sofa 1". */
  displayName: string;
  boundingBox: BoundingBox;
  /** What the object currently looks like, from scene analysis. */
  originalObjectDescription: string;
  /** 0–1 detection confidence, straight from scene analysis. Never invented. */
  confidence: number;
};

/** Title-case a canonical category for display, e.g. "coffee-table" → "Coffee table". */
export function displayCategoryName(canonical: CanonicalCategory): string {
  const words = canonical === "tv-unit" ? "TV unit" : canonical.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Describe an object from what scene analysis actually observed. Returns "" when
 * nothing useful is known — never fabricates a description.
 */
export function describeSceneObject(item: SceneFurniture): string {
  const parts = [
    item.dominantColor && item.dominantColor !== "unknown"
      ? item.dominantColor
      : "",
    item.material && item.material !== "unknown" ? item.material : "",
    item.category,
  ].filter(Boolean);
  return parts.join(" ");
}

/**
 * Turn a scene graph into the objects a customer may choose from.
 *
 * Fixed objects and architecture are excluded here, not merely hidden in the
 * UI, so no downstream consumer can accidentally offer them. Objects without a
 * bounding box are excluded too: an object we cannot point at cannot be tapped.
 */
export function toSelectableObjects(
  sceneGraph: SceneGraph | undefined
): SelectableObject[] {
  const furniture = sceneGraph?.furniture ?? [];
  const eligible = furniture.filter(
    (item) =>
      item.replaceable &&
      isSelectableCategory(item.canonicalCategory) &&
      item.boundingBox !== null
  );

  // Number instances within a category so the customer sees "Sofa 1" / "Sofa 2"
  // rather than two identically named entries.
  const seenPerCategory = new Map<CanonicalCategory, number>();
  const totalPerCategory = new Map<CanonicalCategory, number>();
  for (const item of eligible) {
    totalPerCategory.set(
      item.canonicalCategory,
      (totalPerCategory.get(item.canonicalCategory) || 0) + 1
    );
  }

  return eligible.map((item) => {
    const index = (seenPerCategory.get(item.canonicalCategory) || 0) + 1;
    seenPerCategory.set(item.canonicalCategory, index);
    const base = displayCategoryName(item.canonicalCategory);
    const total = totalPerCategory.get(item.canonicalCategory) || 1;

    return {
      sceneItemId: item.id,
      canonicalCategory: item.canonicalCategory,
      instanceLabel: item.instanceLabel,
      displayName: total > 1 ? `${base} ${index}` : base,
      boundingBox: item.boundingBox as BoundingBox,
      originalObjectDescription: describeSceneObject(item),
      confidence: item.confidence,
    };
  });
}

/**
 * A room object the customer has authorised for change.
 *
 * `confidence` is OPTIONAL and only ever set from a real model output. A
 * hand-drawn region has none — the customer's intent is not a probabilistic
 * detection, and inventing a number would put fabricated certainty into the
 * pipeline.
 */
export type RoomSelection = {
  selectionId: string;
  /** The scene-graph object this authorises. Null for a hand-drawn region. */
  sceneItemId: string | null;
  canonicalCategory: CanonicalCategory;
  /** Spatially disambiguated name, e.g. "the left sofa". */
  instanceLabel: string;
  /** Short customer-facing name, e.g. "Sofa 1". */
  displayName: string;
  selectionMethod: SelectionMethod;
  /** Normalised 0–1 against the source image, so it survives any display size. */
  boundingBox: BoundingBox;
  polygon?: SelectionPoint[];
  mask?: string;
  confidence?: number;
  originalObjectDescription?: string;
  /** Pixel size of the photo this was drawn against. */
  sourceImage: SourceImageSize;
};

let selectionCounter = 0;

function nextSelectionId(prefix: string): string {
  selectionCounter += 1;
  return `${prefix}-${selectionCounter}`;
}

/** Reset id generation so tests are deterministic. */
export function resetSelectionIds(): void {
  selectionCounter = 0;
}

/** Authorise a detected object. Carries its detection confidence through. */
export function selectionFromDetectedObject(
  object: SelectableObject,
  sourceImage: SourceImageSize
): RoomSelection {
  return {
    selectionId: nextSelectionId("smart"),
    sceneItemId: object.sceneItemId,
    canonicalCategory: object.canonicalCategory,
    instanceLabel: object.instanceLabel,
    displayName: object.displayName,
    selectionMethod: "smart",
    boundingBox: object.boundingBox,
    ...(Number.isFinite(object.confidence)
      ? { confidence: Math.max(0, Math.min(1, object.confidence)) }
      : {}),
    ...(object.originalObjectDescription
      ? { originalObjectDescription: object.originalObjectDescription }
      : {}),
    sourceImage,
  };
}

/**
 * A region the customer drew by hand. Deliberately has NO confidence, and no
 * `sceneItemId` — it is not tied to a detected object.
 */
export function createManualSelection(input: {
  boundingBox: BoundingBox;
  sourceImage: SourceImageSize;
  canonicalCategory?: CanonicalCategory;
  displayName?: string;
  polygon?: SelectionPoint[];
}): RoomSelection {
  const category = input.canonicalCategory ?? "unknown";
  const name =
    input.displayName?.trim() ||
    (category === "unknown" ? "Selected area" : displayCategoryName(category));

  return {
    selectionId: nextSelectionId("manual"),
    sceneItemId: null,
    canonicalCategory: category,
    instanceLabel: name,
    displayName: name,
    selectionMethod: "manual",
    boundingBox: input.boundingBox,
    ...(input.polygon ? { polygon: input.polygon } : {}),
    sourceImage: input.sourceImage,
  };
}

/** Assign or correct the object type of an existing selection. */
export function assignSelectionCategory(
  selection: RoomSelection,
  canonicalCategory: CanonicalCategory,
  displayName?: string
): RoomSelection {
  const name = displayName?.trim() || displayCategoryName(canonicalCategory);
  return {
    ...selection,
    canonicalCategory,
    displayName: name,
    // A hand-drawn region's instance label follows its assigned type; a
    // detected object keeps the spatial label scene analysis gave it.
    instanceLabel:
      selection.selectionMethod === "manual" ? name : selection.instanceLabel,
  };
}

/** Selections whose region is large enough to act on. */
export function hasUsableArea(selection: RoomSelection): boolean {
  const { width, height } = selection.boundingBox;
  return width > 0.01 && height > 0.01;
}

/** Is this specific scene object already authorised? */
export function isObjectSelected(
  selections: RoomSelection[],
  sceneItemId: string
): boolean {
  return selections.some((selection) => selection.sceneItemId === sceneItemId);
}

/**
 * Toggle one detected object.
 *
 * Matching is by `sceneItemId`, never by category — this is what stops
 * selecting one sofa from implicitly authorising every sofa in the room.
 */
export function toggleObjectSelection(
  selections: RoomSelection[],
  object: SelectableObject,
  sourceImage: SourceImageSize
): RoomSelection[] {
  if (isObjectSelected(selections, object.sceneItemId)) {
    return selections.filter(
      (selection) => selection.sceneItemId !== object.sceneItemId
    );
  }
  return [...selections, selectionFromDetectedObject(object, sourceImage)];
}

/** Remove a selection by its id. */
export function removeSelection(
  selections: RoomSelection[],
  selectionId: string
): RoomSelection[] {
  return selections.filter((selection) => selection.selectionId !== selectionId);
}

/**
 * Project a normalised box onto a rendered element of a given pixel size.
 * Selections are stored normalised, so this is the only place display size
 * enters — a selection made at one viewport size renders correctly at any other.
 */
export function projectBox(
  box: BoundingBox,
  display: { width: number; height: number }
): { left: number; top: number; width: number; height: number } {
  return {
    left: box.x * display.width,
    top: box.y * display.height,
    width: box.width * display.width,
    height: box.height * display.height,
  };
}

/** Normalise a pixel-space rectangle from a rendered element back to 0–1. */
export function normaliseRect(
  rect: { left: number; top: number; width: number; height: number },
  display: { width: number; height: number }
): BoundingBox {
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const x = clamp01(rect.left / display.width);
  const y = clamp01(rect.top / display.height);
  return {
    x,
    y,
    width: clamp01(rect.width / display.width + x) - x,
    height: clamp01(rect.height / display.height + y) - y,
  };
}

/** Serialise selections for persistence. */
export function serialiseSelections(selections: RoomSelection[]): string {
  return JSON.stringify(selections);
}

/**
 * Restore selections from persistence, dropping anything malformed rather than
 * trusting it. A restored selection must still name a category and a region.
 */
export function deserialiseSelections(raw: string): RoomSelection[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.filter((entry): entry is RoomSelection => {
    if (!entry || typeof entry !== "object") return false;
    const s = entry as Partial<RoomSelection>;
    const box = s.boundingBox;
    return (
      typeof s.selectionId === "string" &&
      (s.selectionMethod === "smart" || s.selectionMethod === "manual") &&
      typeof s.canonicalCategory === "string" &&
      Boolean(box) &&
      typeof box?.x === "number" &&
      typeof box?.y === "number" &&
      typeof box?.width === "number" &&
      typeof box?.height === "number"
    );
  });
}
