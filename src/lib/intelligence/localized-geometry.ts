/**
 * Geometry for localized room edits.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 * The localized strategy edits one crop per selected target and composites the
 * results back onto the untouched room. Everything in this module is the pure,
 * deterministic half of that: rectangles, aspect snapping, mask specifications
 * and overlap detection. No image decoding, no sharp, no network — so it can be
 * exercised exhaustively in tests without a paid call or a real photograph.
 *
 * The only geometry the pipeline actually has is AXIS-ALIGNED BOUNDING BOXES.
 * `detect-objects` documents that the model's segmentation field returns
 * placeholder strings rather than a renderable mask, so silhouettes are not
 * available and nothing here should pretend otherwise.
 *
 * That has a consequence worth stating plainly: a box can contain furniture
 * that is not the target. In the benchmark room the left sofa's box contains
 * the coffee table's near corner. Protecting neighbours is therefore not
 * optional decoration — it is what stops a box-shaped mask editing the wrong
 * object. See `deriveProtectedRects`.
 */
import type { BoundingBox } from "./scene-graph";

/** Integer pixel rectangle. */
export type PixelRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type Bounds = { width: number; height: number };

/**
 * Aspect ratios the image API accepts, with their decimal value.
 *
 * Declared here rather than imported so this module stays free of provider
 * concerns; `nearestAspectRatio` in the Gemini provider answers a different
 * question (what is the room closest to?) than this one (what shape may a crop
 * legally be?). The labels must agree with the provider's, and the test suite
 * asserts that they do.
 */
export const SUPPORTED_CROP_RATIOS: ReadonlyArray<{ label: string; value: number }> = [
  { label: "1:1", value: 1 },
  { label: "2:3", value: 2 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "3:4", value: 3 / 4 },
  { label: "4:3", value: 4 / 3 },
  { label: "4:5", value: 4 / 5 },
  { label: "5:4", value: 5 / 4 },
  { label: "9:16", value: 9 / 16 },
  { label: "16:9", value: 16 / 9 },
  { label: "21:9", value: 21 / 9 },
];

export const LOCALIZED_DEFAULTS = {
  /** Fraction of the target's own size added as surrounding context. */
  contextMargin: 0.4,
  /** Context never drops below this, so small targets still get room to breathe. */
  minContextPx: 120,
  /** Mask margin around the target box, as a fraction of its size. */
  maskMargin: 0.06,
  /** Mask margin floor, in pixels. */
  minMaskMarginPx: 24,
  /** Soft edge on the editable side of the mask. */
  maskFeatherPx: 12,
  /** Soft edge on the protected side — grown outward, never inward. */
  protectFeatherPx: 5,
  /** A crop smaller than this in either dimension gives the model too little to work with. */
  minCropPx: 256,
  /** A target this small is probably a detection artefact. */
  minTargetAreaFraction: 0.005,
  /** A target this large is not a "localized" edit in any meaningful sense. */
  maxTargetAreaFraction: 0.6,
} as const;

// ---------------------------------------------------------------- primitives

export function clampRectToBounds(rect: PixelRect, bounds: Bounds): PixelRect {
  const width = Math.min(rect.width, bounds.width);
  const height = Math.min(rect.height, bounds.height);
  return {
    width,
    height,
    left: Math.max(0, Math.min(rect.left, bounds.width - width)),
    top: Math.max(0, Math.min(rect.top, bounds.height - height)),
  };
}

/** Normalised 0–1 box to integer pixels, clamped to the image. */
export function boxToPixels(box: BoundingBox, bounds: Bounds): PixelRect {
  const left = Math.round(box.x * bounds.width);
  const top = Math.round(box.y * bounds.height);
  const width = Math.round(box.width * bounds.width);
  const height = Math.round(box.height * bounds.height);
  return clampRectToBounds(
    { left, top, width: Math.max(1, width), height: Math.max(1, height) },
    bounds
  );
}

/** Grow a rectangle on all sides, clamped to the image. */
export function expandRect(rect: PixelRect, marginPx: number, bounds: Bounds): PixelRect {
  const margin = Math.max(0, Math.round(marginPx));
  const left = rect.left - margin;
  const top = rect.top - margin;
  const right = rect.left + rect.width + margin;
  const bottom = rect.top + rect.height + margin;
  return clampRectToBounds(
    {
      left: Math.max(0, left),
      top: Math.max(0, top),
      width: Math.min(bounds.width, right) - Math.max(0, left),
      height: Math.min(bounds.height, bottom) - Math.max(0, top),
    },
    bounds
  );
}

export function rectsOverlap(a: PixelRect, b: PixelRect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

/** The shared area of two rectangles, or null when they do not meet. */
export function intersectRects(a: PixelRect, b: PixelRect): PixelRect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

export function rectArea(rect: PixelRect): number {
  return rect.width * rect.height;
}

// ---------------------------------------------------------------- crop

export type CropDerivation = {
  crop: PixelRect;
  /** Exactly one of SUPPORTED_CROP_RATIOS — the crop is built to match it. */
  aspectRatio: string;
};

/**
 * Grow a rectangle to the cheapest supported aspect ratio that still fits.
 *
 * Only ever GROWS: cropping the short side to hit a ratio could cut the target
 * in half, and a distorting resize is worse still — the model would be shown a
 * squashed room and would faithfully reproduce the squash. Candidates are tried
 * cheapest-first and the first one that fits inside the image wins.
 *
 * Returns null when no supported ratio fits, which is a fallback condition
 * rather than something to paper over.
 */
export function snapToSupportedAspect(rect: PixelRect, bounds: Bounds): CropDerivation | null {
  const centreX = rect.left + rect.width / 2;
  const centreY = rect.top + rect.height / 2;

  const candidates = SUPPORTED_CROP_RATIOS.map((ratio) => {
    const width = Math.max(rect.width, Math.round(rect.height * ratio.value));
    const height = Math.max(rect.height, Math.round(width / ratio.value));
    // Re-derive width so rounding cannot drift the ratio.
    const finalWidth = Math.round(height * ratio.value);
    return { ratio, width: finalWidth, height };
  })
    .filter((c) => c.width <= bounds.width && c.height <= bounds.height)
    .sort((a, b) => a.width * a.height - b.width * b.height);

  for (const candidate of candidates) {
    const crop = clampRectToBounds(
      {
        left: Math.round(centreX - candidate.width / 2),
        top: Math.round(centreY - candidate.height / 2),
        width: candidate.width,
        height: candidate.height,
      },
      bounds
    );
    // Clamping moves a rectangle but never resizes it, so the ratio survives.
    if (crop.width === candidate.width && crop.height === candidate.height) {
      return { crop, aspectRatio: candidate.ratio.label };
    }
  }
  return null;
}

/**
 * The context crop for one target: its box, plus surrounding room, snapped to a
 * legal aspect. The margin is proportional so a small chair and a large sofa
 * both get context in proportion to themselves, with a pixel floor so tiny
 * targets are not starved.
 */
export function deriveCrop(
  box: BoundingBox,
  bounds: Bounds,
  options: { contextMargin?: number; minContextPx?: number } = {}
): CropDerivation | null {
  const contextMargin = options.contextMargin ?? LOCALIZED_DEFAULTS.contextMargin;
  const minContextPx = options.minContextPx ?? LOCALIZED_DEFAULTS.minContextPx;

  const target = boxToPixels(box, bounds);
  const margin = Math.max(
    minContextPx,
    Math.round(Math.max(target.width, target.height) * contextMargin)
  );
  const expanded = expandRect(target, margin, bounds);
  return snapToSupportedAspect(expanded, bounds);
}

/** The editable rectangle: the target plus a small margin. Feathered later. */
export function deriveMaskRect(
  box: BoundingBox,
  bounds: Bounds,
  options: { maskMargin?: number; minMaskMarginPx?: number } = {}
): PixelRect {
  const maskMargin = options.maskMargin ?? LOCALIZED_DEFAULTS.maskMargin;
  const minMaskMarginPx = options.minMaskMarginPx ?? LOCALIZED_DEFAULTS.minMaskMarginPx;
  const target = boxToPixels(box, bounds);
  const margin = Math.max(
    minMaskMarginPx,
    Math.round(Math.max(target.width, target.height) * maskMargin)
  );
  return expandRect(target, margin, bounds);
}

/**
 * Rectangles inside this crop whose pixels must survive untouched.
 *
 * Two sources, both structural rather than prompt-based:
 *   - every OTHER target's mask rectangle, so two edits can never claim the
 *     same pixels even when their crops overlap;
 *   - every protected neighbour that carries geometry.
 *
 * Anything without geometry is protected by omission — it is outside the mask —
 * which is why the mask hugs the target rather than filling the crop.
 */
export function deriveProtectedRects(input: {
  crop: PixelRect;
  ownMask: PixelRect;
  otherTargetBoxes: BoundingBox[];
  protectedBoxes: BoundingBox[];
  bounds: Bounds;
}): PixelRect[] {
  const { crop, ownMask, bounds } = input;
  const candidates: PixelRect[] = [
    ...input.otherTargetBoxes.map((box) =>
      deriveMaskRect(box, bounds)
    ),
    ...input.protectedBoxes.map((box) => boxToPixels(box, bounds)),
  ];

  const rects: PixelRect[] = [];
  for (const candidate of candidates) {
    const withinCrop = intersectRects(candidate, crop);
    if (!withinCrop) continue;
    // A protected rectangle that swallowed the target would leave nothing to
    // edit. Detection boxes do overlap, so this is a real case, not paranoia:
    // subtracting it is wrong (we cannot represent the remainder as a rect), so
    // the edit is left to the mask's own bounds and the overlap is reported.
    if (rectArea(intersectRects(withinCrop, ownMask) ?? { left: 0, top: 0, width: 0, height: 0 }) >=
      rectArea(ownMask) * 0.9) {
      continue;
    }
    rects.push(withinCrop);
  }
  return rects;
}

// ---------------------------------------------------------------- ownership

export type MaskOverlap = { a: string; b: string; area: number };

/**
 * Pairwise overlap between plain mask rectangles.
 *
 * Kept because it is the honest measure of "do these two rectangles touch",
 * which the writable-region resolver below needs. It is NOT by itself a reason
 * to refuse a request — see `resolveWritableMasks`.
 */
export function findMaskOverlaps(
  masks: Array<{ id: string; rect: PixelRect }>
): MaskOverlap[] {
  const overlaps: MaskOverlap[] = [];
  for (let i = 0; i < masks.length; i += 1) {
    for (let j = i + 1; j < masks.length; j += 1) {
      const shared = intersectRects(masks[i].rect, masks[j].rect);
      if (shared) {
        overlaps.push({ a: masks[i].id, b: masks[j].id, area: rectArea(shared) });
      }
    }
  }
  return overlaps;
}

export type LocalizedTargetSpec = { id: string; box: BoundingBox };

/**
 * How much of the smaller of two target boxes the other one covers.
 *
 * Two targets whose CORES overlap substantially are genuinely ambiguous — one
 * object is largely hidden behind the other and no rule about margins can say
 * which pixels belong to which product. Above this share the request falls back
 * rather than guessing.
 */
export const MAX_CORE_OVERLAP_SHARE = 0.25;

/**
 * Front-to-back order, frontmost first.
 *
 * Image-space depth heuristic: in a photograph taken from standing height, the
 * object whose bottom edge sits lower in the frame is nearer the camera. It is
 * a heuristic and it is wrong for objects at very different heights, which is
 * why it only ever decides MARGIN pixels — a target's own core is protected
 * from its neighbours regardless of the order this returns.
 *
 * Ties break on area then id, so the order is fully deterministic and two runs
 * of the same request always carve the same pixels.
 */
export function orderByDepth(
  targets: LocalizedTargetSpec[],
  bounds: Bounds
): LocalizedTargetSpec[] {
  return [...targets].sort((a, b) => {
    const ra = boxToPixels(a.box, bounds);
    const rb = boxToPixels(b.box, bounds);
    const bottomA = ra.top + ra.height;
    const bottomB = rb.top + rb.height;
    if (bottomA !== bottomB) return bottomB - bottomA;
    const areaDiff = rectArea(rb) - rectArea(ra);
    if (areaDiff !== 0) return areaDiff;
    return a.id.localeCompare(b.id);
  });
}

export type WritableMask = {
  id: string;
  /** The region this edit may write into, before carving. */
  maskRect: PixelRect;
  /** Everything carved out of it: siblings, their cores, and neighbours. */
  protectedRects: PixelRect[];
  /** Position in the front-to-back order; 0 is frontmost. */
  depthIndex: number;
};

export type WritableMaskResolution =
  | { ok: true; masks: WritableMask[] }
  | { ok: false; reason: string };

/**
 * Turn overlapping mask rectangles into provably disjoint WRITABLE regions.
 *
 * ---------------------------------------------------------------------------
 * WHY CARVING RATHER THAN REFUSING
 * ---------------------------------------------------------------------------
 * The first version rejected a request whenever two expanded masks touched.
 * That was too blunt: the hand-built benchmark that motivated this whole
 * architecture had overlapping CROPS and overlapping context margins, and was
 * perfectly safe, because what actually has to be disjoint is the set of pixels
 * each edit is allowed to WRITE. Kelly, Elva and Aspen in the benchmark room
 * would have fallen back for a few hundred pixels of shared carpet margin.
 *
 * So each target keeps its own rectangle and carves out:
 *   - every OTHER target's core box, always and in both directions, so no edit
 *     can ever redraw another product's actual object;
 *   - every frontward sibling's whole mask rectangle, which resolves the
 *     margin-only overlaps deterministically in favour of the nearer object;
 *   - every protected neighbour that carries geometry.
 *
 * Disjointness then holds by construction: for any pair, the further-back one
 * has carved away the entire rectangle of the nearer one, which contains all of
 * the nearer one's writable pixels. `writableOverlapArea` verifies this rather
 * than trusting the argument.
 */
export function resolveWritableMasks(input: {
  targets: LocalizedTargetSpec[];
  protectedBoxes: BoundingBox[];
  bounds: Bounds;
  maskOptions?: { maskMargin?: number; minMaskMarginPx?: number };
}): WritableMaskResolution {
  const { bounds } = input;
  const ordered = orderByDepth(input.targets, bounds);

  // Genuinely ambiguous occlusion is a fallback, not a guess.
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const coreA = boxToPixels(ordered[i].box, bounds);
      const coreB = boxToPixels(ordered[j].box, bounds);
      const shared = intersectRects(coreA, coreB);
      if (!shared) continue;
      const share = rectArea(shared) / Math.min(rectArea(coreA), rectArea(coreB));
      if (share > MAX_CORE_OVERLAP_SHARE) {
        return {
          ok: false,
          reason: `targets ${ordered[i].id} and ${ordered[j].id} overlap by ${(share * 100).toFixed(0)}% of the smaller box, which is too much to attribute safely`,
        };
      }
    }
  }

  const protectedNeighbourRects = input.protectedBoxes.map((box) => boxToPixels(box, bounds));

  const masks: WritableMask[] = ordered.map((target, index) => {
    const maskRect = deriveMaskRect(target.box, bounds, input.maskOptions);

    const carved: PixelRect[] = [];
    ordered.forEach((other, otherIndex) => {
      if (other.id === target.id) return;
      // Never write over another target's actual object, in either direction.
      carved.push(boxToPixels(other.box, bounds));
      // Margin-only overlap goes to whichever is nearer the camera.
      if (otherIndex < index) {
        carved.push(deriveMaskRect(other.box, bounds, input.maskOptions));
      }
    });
    carved.push(...protectedNeighbourRects);

    // Only the parts that actually meet this mask are worth carrying.
    const protectedRects = carved
      .map((rect) => intersectRects(rect, maskRect))
      .filter((rect): rect is PixelRect => rect !== null);

    return { id: target.id, maskRect, protectedRects, depthIndex: index };
  });

  // A carve that swallowed a target leaves nothing to edit — better to fall
  // back than to send a request that can only return the room unchanged.
  for (const mask of masks) {
    if (writableAreaEstimate(mask) <= 0) {
      return { ok: false, reason: `target ${mask.id} has no writable area left after protecting its neighbours` };
    }
  }

  const conflicts = writableConflicts(masks);
  if (conflicts.length > 0) {
    const described = conflicts.map((c) => `${c.a}/${c.b} (${c.area}px)`).join(", ");
    return { ok: false, reason: `writable regions still overlap after carving: ${described}` };
  }

  return { ok: true, masks };
}

/** Whether a pixel is inside any of the rectangles. */
function coveredBy(rects: PixelRect[], x: number, y: number): boolean {
  for (const rect of rects) {
    if (x >= rect.left && x < rect.left + rect.width && y >= rect.top && y < rect.top + rect.height) {
      return true;
    }
  }
  return false;
}

/**
 * Pixels two writable regions genuinely share, after carving.
 *
 * Exact rather than clever: the candidate area is the intersection of two mask
 * rectangles, which is small, so every pixel in it is tested against both
 * protection lists. An estimate would be the wrong trade here — this is the
 * check that decides whether the composite is order-independent.
 */
export function writableOverlapArea(a: WritableMask, b: WritableMask): number {
  const shared = intersectRects(a.maskRect, b.maskRect);
  if (!shared) return 0;

  // Fast path: one protection rectangle covering the whole shared area is the
  // normal outcome of carving a frontward sibling's rectangle.
  const swallowed = (mask: WritableMask) =>
    mask.protectedRects.some(
      (rect) =>
        rect.left <= shared.left &&
        rect.top <= shared.top &&
        rect.left + rect.width >= shared.left + shared.width &&
        rect.top + rect.height >= shared.top + shared.height
    );
  if (swallowed(a) || swallowed(b)) return 0;

  let overlap = 0;
  for (let y = shared.top; y < shared.top + shared.height; y += 1) {
    for (let x = shared.left; x < shared.left + shared.width; x += 1) {
      if (!coveredBy(a.protectedRects, x, y) && !coveredBy(b.protectedRects, x, y)) {
        overlap += 1;
      }
    }
  }
  return overlap;
}

export function writableConflicts(masks: WritableMask[]): MaskOverlap[] {
  const conflicts: MaskOverlap[] = [];
  for (let i = 0; i < masks.length; i += 1) {
    for (let j = i + 1; j < masks.length; j += 1) {
      const area = writableOverlapArea(masks[i], masks[j]);
      if (area > 0) conflicts.push({ a: masks[i].id, b: masks[j].id, area });
    }
  }
  return conflicts;
}

/**
 * Rough writable area: the mask minus the largest single protection.
 *
 * Deliberately an under-estimate — overlapping protections are not
 * double-counted, so a mask this says is empty really is empty.
 */
export function writableAreaEstimate(mask: WritableMask): number {
  const covered = mask.protectedRects.reduce((largest, rect) => {
    const shared = intersectRects(rect, mask.maskRect);
    return Math.max(largest, shared ? rectArea(shared) : 0);
  }, 0);
  return rectArea(mask.maskRect) - covered;
}

// ---------------------------------------------------------------- eligibility

export type TargetGeometryIssue =
  | "missing-box"
  | "degenerate-box"
  | "target-too-small"
  | "target-too-large"
  | "crop-unrepresentable"
  | "crop-too-small";

/** Why one target cannot be edited locally, or null when it can. */
export function assessTargetGeometry(
  box: BoundingBox | null | undefined,
  bounds: Bounds
): TargetGeometryIssue | null {
  if (!box) return "missing-box";
  if (
    !Number.isFinite(box.x) ||
    !Number.isFinite(box.y) ||
    !Number.isFinite(box.width) ||
    !Number.isFinite(box.height) ||
    box.width <= 0 ||
    box.height <= 0
  ) {
    return "degenerate-box";
  }

  const area = box.width * box.height;
  if (area < LOCALIZED_DEFAULTS.minTargetAreaFraction) return "target-too-small";
  if (area > LOCALIZED_DEFAULTS.maxTargetAreaFraction) return "target-too-large";

  const derived = deriveCrop(box, bounds);
  if (!derived) return "crop-unrepresentable";
  if (
    derived.crop.width < LOCALIZED_DEFAULTS.minCropPx ||
    derived.crop.height < LOCALIZED_DEFAULTS.minCropPx
  ) {
    return "crop-too-small";
  }
  return null;
}
