/**
 * Input normalisation for the GPT Image edit endpoint.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Live phone test, on a photo the Gemini pipeline renders happily:
 *
 *   400 Invalid image file or mode for image 1, please check your image file
 *
 * The two providers do genuinely different things with the bytes. Gemini gets
 * them base64'd inline and is forgiving about what it accepts. `images.edit` is
 * a real multipart upload with a much narrower contract: it wants ordinary
 * 8-bit RGB/RGBA JPEG, PNG or WebP, and rejects the request outright otherwise.
 * "or mode" in that message is the giveaway — it is not only about the
 * container, it is about the colour representation inside it.
 *
 * A phone photo can be any of these while still being a perfectly valid
 * `image/jpeg` as far as the browser, the filename and the MIME type are
 * concerned:
 *
 *   - CMYK JPEG                (4 channels, not RGB — verified to decode here)
 *   - greyscale JPEG           (1 channel)
 *   - 16-bit PNG               (ushort depth, not uchar)
 *   - Display P3 / ICC-tagged  (wide gamut, common on modern iPhones)
 *   - HEIC/HEIF/AVIF           (iOS's native format)
 *   - TIFF or GIF with a .jpg name
 *   - EXIF orientation         (portrait photos that are landscape on disk)
 *
 * So this module NEVER trusts `file.type` or the filename. It sniffs the real
 * container from magic bytes, decodes the pixels, and re-encodes to something
 * the endpoint documents as acceptable.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 * It does not crop, and it does not change the aspect ratio. The whole product
 * promise is "this is still YOUR room", so the frame the customer photographed
 * is preserved exactly. Downscaling happens only as a last resort when a single
 * image would otherwise exceed the request budget, and even then it is
 * aspect-preserving (`fit: "inside"`).
 */
import sharp from "sharp";

/** Formats the edit endpoint accepts. Everything else must be converted. */
export const GPT_IMAGE_ACCEPTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * Per-image byte budget.
 *
 * The documented hard limit is 50MB per image, but a room photo plus five
 * product references all near that ceiling makes a multipart body big enough to
 * be its own failure mode. 12MB each is far above anything a normalised phone
 * photo produces (~1-3MB) while leaving the ceiling comfortably clear.
 */
export const MAX_NORMALISED_BYTES = 12 * 1024 * 1024;

/**
 * Only used if the byte budget is still exceeded at the lowest quality step.
 * Well above a phone camera's long edge, so ordinary photos are never touched.
 */
const FALLBACK_MAX_DIMENSION = 4096;

/** JPEG quality ladder, tried in order until the budget is met. */
const JPEG_QUALITY_STEPS = [92, 85, 75];

/** What the bytes actually are, regardless of what they claim to be. */
export type DetectedImageFormat =
  | "jpeg"
  | "png"
  | "webp"
  | "gif"
  | "bmp"
  | "tiff"
  | "heic"
  | "avif"
  | "unknown";

/**
 * Container sniffing from magic bytes.
 *
 * Independent of sharp on purpose: this is what gets REPORTED in the debug log,
 * including for inputs sharp cannot decode at all, which is exactly the case
 * where knowing the real container matters most.
 */
export function detectImageFormat(bytes: Uint8Array): DetectedImageFormat {
  const at = (i: number) => bytes[i];
  const ascii = (start: number, length: number) =>
    Buffer.from(bytes.subarray(start, start + length)).toString("latin1");

  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 8 &&
    at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
    at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    return "webp";
  }
  if (bytes.length >= 6 && ascii(0, 6).startsWith("GIF8")) return "gif";
  if (bytes.length >= 2 && ascii(0, 2) === "BM") return "bmp";
  if (
    bytes.length >= 4 &&
    ((at(0) === 0x49 && at(1) === 0x49 && at(2) === 0x2a && at(3) === 0x00) ||
      (at(0) === 0x4d && at(1) === 0x4d && at(2) === 0x00 && at(3) === 0x2a))
  ) {
    return "tiff";
  }
  // ISO-BMFF family: the brand at offset 8 separates HEIC from AVIF. This is
  // the iPhone case, and the one most likely to arrive mislabelled as JPEG.
  if (bytes.length >= 12 && ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    if (/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/.test(brand)) return "heic";
    if (/^(avif|avis)$/.test(brand)) return "avif";
  }
  return "unknown";
}

/** Metadata only — never pixel data. Safe to log. */
export type NormalisedImageReport = {
  /** 1-based position in the request. Image 1 is the room. */
  inputNumber: number;
  /** "room", or the product id the reference belongs to. */
  role: string;
  /** What the browser/file claimed. */
  originalMimeType: string;
  originalFileName: string;
  /** What the bytes actually are. */
  detectedFormat: DetectedImageFormat;
  width: number | null;
  height: number | null;
  /** Colour space and channel count as decoded — the "mode" in the 400. */
  colourSpace: string | null;
  channels: number | null;
  depth: string | null;
  hasAlpha: boolean | null;
  originalBytes: number;
  normalisedFormat: "jpeg" | "png";
  normalisedBytes: number;
  /** True when the pixels were re-encoded rather than passed through. */
  converted: boolean;
  /** Set only when the byte budget forced an aspect-preserving downscale. */
  downscaledTo?: { width: number; height: number };
};

export type NormalisedImage = {
  file: File;
  report: NormalisedImageReport;
};

function extensionFor(format: "jpeg" | "png") {
  return format === "jpeg" ? "jpg" : "png";
}

function mimeFor(format: "jpeg" | "png") {
  return format === "jpeg" ? "image/jpeg" : "image/png";
}

/** Strip any existing extension so we can attach the true one. */
function baseName(fileName: string, fallback: string) {
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, "").trim();
  const cleaned = withoutExtension.replace(/[^a-zA-Z0-9._-]/g, "-");
  return cleaned || fallback;
}

/**
 * Re-encode one image into something `images.edit` accepts.
 *
 * Alpha decides the target: a transparent product cut-out has to stay PNG or
 * the transparency turns into a black box, while an opaque photograph is far
 * smaller as JPEG. Both are RGB/RGBA 8-bit sRGB by the time they leave here.
 */
async function encode(
  pipeline: sharp.Sharp,
  target: "jpeg" | "png"
): Promise<Buffer> {
  if (target === "png") {
    // compressionLevel 9 keeps the byte budget reachable without touching
    // pixels; PNG is lossless, so this cannot affect render quality.
    return pipeline.png({ compressionLevel: 9, force: true }).toBuffer();
  }
  return pipeline.jpeg({ quality: JPEG_QUALITY_STEPS[0], force: true }).toBuffer();
}

export async function normaliseImageForGptImage(
  file: File,
  options: { inputNumber: number; role: string }
): Promise<NormalisedImage> {
  const originalBuffer = Buffer.from(await file.arrayBuffer());
  const detectedFormat = detectImageFormat(originalBuffer);

  /**
   * `failOn: "none"` — a truncated or slightly malformed phone photo should
   * still render. Failing here would turn a recoverable image into a dead
   * generation, which is the very outcome this module exists to prevent.
   */
  let image = sharp(originalBuffer, { failOn: "none" });
  let metadata: sharp.Metadata;
  try {
    metadata = await image.metadata();
  } catch (error) {
    throw new Error(
      `Image ${options.inputNumber} (${options.role}) could not be decoded. ` +
        `It claims to be "${file.type || "unknown"}" and its bytes look like ` +
        `"${detectedFormat}". ${(error as Error).message}`
    );
  }

  const hasAlpha = Boolean(metadata.hasAlpha);
  const target: "jpeg" | "png" = hasAlpha ? "png" : "jpeg";

  /**
   * `.rotate()` with no argument bakes EXIF orientation into the pixels. It
   * MUST happen before the metadata is dropped, or a portrait phone photo —
   * stored landscape with an orientation tag — would come back rotated, and
   * the customer would not recognise their own room.
   */
  image = image.rotate();

  /**
   * The actual "mode" fix. CMYK, greyscale, 16-bit and wide-gamut inputs all
   * land on 8-bit sRGB here, and the ICC profile is dropped rather than
   * carried, so what the endpoint receives needs no interpretation.
   */
  image = image.toColourspace("srgb");
  if (!hasAlpha) {
    // A greyscale or CMYK source can decode to a channel count JPEG will not
    // accept; flattening onto white guarantees three opaque channels.
    image = image.flatten({ background: { r: 255, g: 255, b: 255 } });
  }

  let output = await encode(image.clone(), target);
  let downscaledTo: { width: number; height: number } | undefined;

  // Budget enforcement — quality first, dimensions only as a last resort, and
  // never a crop.
  if (output.length > MAX_NORMALISED_BYTES && target === "jpeg") {
    for (const quality of JPEG_QUALITY_STEPS.slice(1)) {
      output = await image.clone().jpeg({ quality, force: true }).toBuffer();
      if (output.length <= MAX_NORMALISED_BYTES) break;
    }
  }
  if (output.length > MAX_NORMALISED_BYTES) {
    const resized = image
      .clone()
      // `fit: "inside"` preserves the aspect ratio and never crops;
      // `withoutEnlargement` means a small image is left alone.
      .resize({
        width: FALLBACK_MAX_DIMENSION,
        height: FALLBACK_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      });
    output = await encode(resized, target);
    const resizedMetadata = await sharp(output).metadata();
    downscaledTo = {
      width: resizedMetadata.width ?? 0,
      height: resizedMetadata.height ?? 0,
    };
  }

  const normalisedFile = new File(
    [new Uint8Array(output)],
    `${baseName(file.name, options.role === "room" ? "room" : "product")}.${extensionFor(target)}`,
    { type: mimeFor(target) }
  );

  return {
    file: normalisedFile,
    report: {
      inputNumber: options.inputNumber,
      role: options.role,
      originalMimeType: file.type || "(none)",
      originalFileName: file.name || "(none)",
      detectedFormat,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      colourSpace: metadata.space ?? null,
      channels: metadata.channels ?? null,
      depth: metadata.depth ?? null,
      hasAlpha,
      originalBytes: originalBuffer.length,
      normalisedFormat: target,
      normalisedBytes: output.length,
      /**
       * True when this image needed more than a re-encode to become
       * acceptable — a different container, OR a different colour
       * representation. The colour half matters most: a CMYK JPEG keeps the
       * same container and the same claimed MIME type, so a container-only
       * flag would report the exact input that caused the 400 as unconverted.
       */
      converted:
        detectedFormat !== target ||
        !GPT_IMAGE_ACCEPTED_MIME_TYPES.has(file.type.toLowerCase()) ||
        (metadata.space ?? "srgb") !== "srgb" ||
        (metadata.depth ?? "uchar") !== "uchar",
      ...(downscaledTo ? { downscaledTo } : {}),
    },
  };
}
