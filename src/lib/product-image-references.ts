import { readFile } from "fs/promises";
import type { Product } from "./products";
import { getProductReferenceViewUrls } from "./intelligence/product-references";

// Feed multiple reference views per product (front / 45° / side / lifestyle /
// detail) so the image model has richer product context.
const MAX_PRODUCT_IMAGES_PER_PRODUCT = 3;
const MAX_TOTAL_PRODUCT_IMAGES = 8;

/**
 * Image MIME types the Gemini image model accepts as inline input. AVIF is
 * deliberately absent — it is a valid image format but not an accepted input
 * type, so AVIF files are reported as skipped-with-reason rather than sent.
 */
export const GEMINI_SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * Detect an image's real type from its magic bytes.
 *
 * The catalogue stores files named `main.jpg` that are actually WebP or AVIF.
 * Trusting the file extension therefore produced `image/jpeg`, which then
 * failed a JPEG signature check and silently dropped EVERY product reference
 * image before it could reach the model. Sniffing the content instead means the
 * declared MIME type always matches the bytes we send.
 */
export function detectImageMimeType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  // ISO-BMFF container (AVIF / HEIC / HEIF): "ftyp" at offset 4, brand at 8.
  if (buffer.toString("ascii", 4, 8) === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12).toLowerCase();
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (["heic", "heix", "hevc", "heim", "mif1", "msf1"].includes(brand)) {
      return "image/heic";
    }
    return null;
  }

  return null;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function devLog(logPrefix: string, message: string, details?: unknown) {
  if (process.env.NODE_ENV !== "development") return;

  console.log(`${logPrefix} ${message}`, details);
}

/** One successfully loaded, Gemini-transmittable reference image. */
export type LoadedProductReference = {
  productId: string;
  productName: string;
  /** Reference view name, e.g. "main", "side". */
  view: string;
  file: File;
  mimeType: string;
  bytes: number;
};

/** A reference image that exists but cannot be sent, with the reason why. */
export type SkippedProductReference = {
  productId: string;
  productName: string;
  view: string;
  url: string;
  reason: string;
};

export type ProductReferenceLoad = {
  loaded: LoadedProductReference[];
  skipped: SkippedProductReference[];
};

/**
 * Load reference images grouped per product, preserving the order of
 * `products` (which the pipeline keeps in customer-selection order).
 *
 * Unlike the flat loader this reports BOTH what loaded and what was skipped and
 * why, so a dropped reference is always visible rather than silent.
 */
export async function loadProductReferenceImages(
  products: Product[],
  logPrefix: string,
  options: { maxViewsPerProduct?: number } = {}
): Promise<ProductReferenceLoad> {
  const maxViews = options.maxViewsPerProduct ?? MAX_PRODUCT_IMAGES_PER_PRODUCT;
  const loaded: LoadedProductReference[] = [];
  const skipped: SkippedProductReference[] = [];

  for (const product of products) {
    const views = getProductReferenceViewUrls(product);

    if (views.length === 0) {
      skipped.push({
        productId: product.id,
        productName: product.name,
        view: "main",
        url: "",
        reason: "no reference image URL for this product",
      });
      continue;
    }

    let loadedForProduct = 0;
    // Conventional per-view paths are probed speculatively and usually miss, so
    // a "not found" is only worth reporting if the product ends up with no
    // usable reference at all.
    const missedCandidates: SkippedProductReference[] = [];

    for (const { view, url } of views) {
      if (loadedForProduct >= maxViews) break;

      if (!url.startsWith("/")) {
        // Remote/scraped URLs are not fetched here; only local public assets.
        continue;
      }

      const imagePath = `${process.cwd()}/public${url.split(/[?#]/)[0]}`;

      let fileBuffer: Buffer;
      try {
        fileBuffer = await readFile(imagePath);
      } catch {
        missedCandidates.push({
          productId: product.id,
          productName: product.name,
          view,
          url,
          reason: "file not found on disk",
        });
        continue;
      }

      const mimeType = detectImageMimeType(fileBuffer);

      if (!mimeType) {
        skipped.push({
          productId: product.id,
          productName: product.name,
          view,
          url,
          reason: "unrecognised image format (magic bytes did not match)",
        });
        continue;
      }

      if (!GEMINI_SUPPORTED_IMAGE_TYPES.has(mimeType)) {
        skipped.push({
          productId: product.id,
          productName: product.name,
          view,
          url,
          reason: `image is ${mimeType}, which the image model does not accept as input; re-encode to JPEG, PNG or WebP`,
        });
        devLog(logPrefix, "unsupported product image format", {
          productId: product.id,
          imagePath,
          mimeType,
        });
        continue;
      }

      loaded.push({
        productId: product.id,
        productName: product.name,
        view,
        mimeType,
        bytes: fileBuffer.length,
        file: new File(
          [new Uint8Array(fileBuffer)],
          `${product.id}-${view}.${extensionForMimeType(mimeType)}`,
          { type: mimeType }
        ),
      });
      loadedForProduct += 1;
    }

    if (loadedForProduct === 0) {
      // Only now are the misses meaningful: this product reached the model with
      // no visual reference.
      skipped.push(...missedCandidates.slice(0, 1));
      devLog(logPrefix, "product has no usable reference image", {
        productId: product.id,
      });
    }
  }

  return { loaded, skipped };
}

/**
 * Flat loader kept for the legacy generation/refinement routes. Applies the
 * historical global cap and returns plain Files.
 */
export async function loadProductReferenceImageFiles(
  products: Product[],
  logPrefix: string
) {
  const { loaded } = await loadProductReferenceImages(products, logPrefix);

  return loaded.slice(0, MAX_TOTAL_PRODUCT_IMAGES).map((entry) => entry.file);
}
