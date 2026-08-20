/**
 * Rasterisation and compositing for localized edits.
 *
 * Everything that touches pixels lives here; the geometry that decides WHERE
 * lives in `lib/intelligence/localized-geometry.ts` and is pure. Keeping the
 * split means the interesting decisions can be tested without decoding an
 * image, and this module stays small enough to read in one sitting.
 */
import sharp from "sharp";
import {
  LOCALIZED_DEFAULTS,
  type PixelRect,
} from "@/lib/intelligence/localized-geometry";

export type MaskSpec = {
  /** The crop this mask is expressed in. */
  crop: PixelRect;
  /** Editable region, in ROOM coordinates. */
  maskRect: PixelRect;
  /** Regions whose pixels must survive untouched, in ROOM coordinates. */
  protectedRects: PixelRect[];
  featherPx?: number;
  protectFeatherPx?: number;
};

export type MaskStats = {
  editablePixels: number;
  protectedPixels: number;
  /** Pixels at full alpha — the core of the edit, ignoring the soft edge. */
  fullyEditablePixels: number;
};

/**
 * Build the alpha mask for one edit, in crop coordinates.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PROTECTED EDGE IS GROWN BEFORE BLURRING
 * ---------------------------------------------------------------------------
 * Blurring a black rectangle on white softens BOTH sides of its edge, so the
 * rectangle's own interior picks up a little alpha near its border. Measured in
 * the two-sofa benchmark, that leaked 991 pixels of a protected rug — visually
 * harmless at alpha 78/255, but it broke the only guarantee that matters here:
 * a protected region is EXACTLY the original photograph.
 *
 * So protected rectangles are grown by three times the feather before the blur
 * and then stamped back to zero afterwards. The soft transition ends up
 * entirely outside the protected area, in the editable region where a soft edge
 * is what we actually want, and every pixel inside a protected rectangle is
 * hard zero. The test suite asserts this directly.
 */
export async function buildLocalizedMask(spec: MaskSpec): Promise<Uint8Array> {
  const { crop } = spec;
  const feather = spec.featherPx ?? LOCALIZED_DEFAULTS.maskFeatherPx;
  const protectFeather = spec.protectFeatherPx ?? LOCALIZED_DEFAULTS.protectFeatherPx;

  const rel = (rect: PixelRect) => ({
    x: rect.left - crop.left,
    y: rect.top - crop.top,
    width: rect.width,
    height: rect.height,
  });

  const editable = rel(spec.maskRect);
  const editableSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${crop.width}" height="${crop.height}">
    <rect width="100%" height="100%" fill="black"/>
    <rect x="${editable.x}" y="${editable.y}" width="${editable.width}" height="${editable.height}" rx="${Math.round(feather * 1.5)}" fill="white"/>
  </svg>`;
  const editableMask = await sharp(Buffer.from(editableSvg))
    .blur(feather)
    .greyscale()
    .raw()
    .toBuffer();

  if (spec.protectedRects.length === 0) {
    return new Uint8Array(editableMask);
  }

  const grow = protectFeather * 3;
  const cuts = spec.protectedRects
    .map((rect) => {
      const r = rel(rect);
      return `<rect x="${r.x - grow}" y="${r.y - grow}" width="${r.width + grow * 2}" height="${r.height + grow * 2}" fill="black"/>`;
    })
    .join("");
  const protectMask = await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${crop.width}" height="${crop.height}">
      <rect width="100%" height="100%" fill="white"/>${cuts}</svg>`)
  )
    .blur(protectFeather)
    .greyscale()
    .raw()
    .toBuffer();

  // Stamp the TRUE rectangles to zero: a hard guarantee, not a gradient.
  for (const rect of spec.protectedRects) {
    const r = rel(rect);
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(crop.width, r.x + r.width);
    const y1 = Math.min(crop.height, r.y + r.height);
    for (let y = y0; y < y1; y += 1) {
      protectMask.fill(0, y * crop.width + x0, y * crop.width + x1);
    }
  }

  const mask = new Uint8Array(editableMask.length);
  for (let i = 0; i < mask.length; i += 1) {
    // Whichever is darker wins, so protection can only ever reduce the edit.
    mask[i] = Math.min(editableMask[i], protectMask[i]);
  }
  return mask;
}

export function maskStats(mask: Uint8Array): MaskStats {
  let editable = 0;
  let full = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] > 0) editable += 1;
    if (mask[i] === 255) full += 1;
  }
  return {
    editablePixels: editable,
    protectedPixels: mask.length - editable,
    fullyEditablePixels: full,
  };
}

export type LocalizedEditLayer = {
  id: string;
  crop: PixelRect;
  mask: Uint8Array;
  /** The model's returned crop, any size — resized to the crop before use. */
  editedCrop: Buffer;
};

/**
 * Lay every successful edit onto ONE copy of the original room.
 *
 * The original is the base for all of them: no layer ever sees another layer's
 * output, which is what keeps two products from blending into each other. The
 * caller guarantees the masks are disjoint, so the order of `layers` cannot
 * change the result.
 */
export async function compositeLocalizedEdits(input: {
  roomImage: Buffer;
  roomWidth: number;
  roomHeight: number;
  layers: LocalizedEditLayer[];
}): Promise<{ image: Buffer; changedPixels: number }> {
  const { roomWidth: W, roomHeight: H } = input;
  const original = await sharp(input.roomImage).removeAlpha().raw().toBuffer();
  const out = Buffer.from(original);

  for (const layer of input.layers) {
    const edited = await sharp(layer.editedCrop)
      .resize(layer.crop.width, layer.crop.height, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer();

    for (let y = 0; y < layer.crop.height; y += 1) {
      const roomY = y + layer.crop.top;
      if (roomY < 0 || roomY >= H) continue;
      for (let x = 0; x < layer.crop.width; x += 1) {
        const alpha = layer.mask[y * layer.crop.width + x] / 255;
        if (alpha === 0) continue;
        const roomX = x + layer.crop.left;
        if (roomX < 0 || roomX >= W) continue;
        const ri = (roomY * W + roomX) * 3;
        const ci = (y * layer.crop.width + x) * 3;
        for (let c = 0; c < 3; c += 1) {
          out[ri + c] = Math.round(original[ri + c] * (1 - alpha) + edited[ci + c] * alpha);
        }
      }
    }
  }

  let changedPixels = 0;
  for (let i = 0; i < original.length; i += 3) {
    if (original[i] !== out[i] || original[i + 1] !== out[i + 1] || original[i + 2] !== out[i + 2]) {
      changedPixels += 1;
    }
  }

  const image = await sharp(out, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();

  return { image, changedPixels };
}

/** Extract one crop from the normalised room. */
export async function extractCrop(roomImage: Buffer, crop: PixelRect): Promise<Buffer> {
  return sharp(roomImage).extract(crop).jpeg({ quality: 95 }).toBuffer();
}
