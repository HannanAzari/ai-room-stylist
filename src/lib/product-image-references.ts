import { readFile } from "fs/promises";
import type { Product } from "./products";

const MAX_PRODUCT_IMAGES_PER_PRODUCT = 2;
const MAX_TOTAL_PRODUCT_IMAGES = 6;
const PRODUCT_IMAGE_TYPES_BY_EXTENSION = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function getFileExtension(fileName: string) {
  const cleanFileName = fileName.split(/[?#]/)[0];
  const extensionIndex = cleanFileName.lastIndexOf(".");

  return extensionIndex === -1
    ? ""
    : cleanFileName.slice(extensionIndex).toLowerCase();
}

function devLog(logPrefix: string, message: string, details?: unknown) {
  if (process.env.NODE_ENV !== "development") return;

  console.log(`${logPrefix} ${message}`, details);
}

function isProductImageBufferValid(buffer: Buffer, imageType: string) {
  if (imageType === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (imageType === "image/png") {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }

  if (imageType === "image/webp") {
    return (
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    );
  }

  return false;
}

function getPriorityScore(imageUrl: string) {
  const cleanImageUrl = imageUrl.split(/[?#]/)[0].toLowerCase();

  if (/\/main\.(?:jpe?g|png|webp)$/.test(cleanImageUrl)) return 0;
  if (/angle|lifestyle/.test(cleanImageUrl)) return 1;

  return 2;
}

function getPrioritizedProductImageUrls(product: Product) {
  const imageUrls = [...(product.imageUrls || []), product.imageUrl || ""];
  const seenImageUrls = new Set<string>();

  return imageUrls
    .map((imageUrl, index) => ({
      imageUrl: imageUrl.trim(),
      index,
    }))
    .filter(({ imageUrl }) => {
      if (!imageUrl || seenImageUrls.has(imageUrl)) return false;

      seenImageUrls.add(imageUrl);
      return true;
    })
    .sort((a, b) => {
      const priorityDelta =
        getPriorityScore(a.imageUrl) - getPriorityScore(b.imageUrl);

      return priorityDelta || a.index - b.index;
    })
    .map(({ imageUrl }) => imageUrl);
}

export async function loadProductReferenceImageFiles(
  products: Product[],
  logPrefix: string
) {
  const productImageFiles: File[] = [];

  for (const product of products) {
    if (productImageFiles.length >= MAX_TOTAL_PRODUCT_IMAGES) break;

    const imageUrls = getPrioritizedProductImageUrls(product);

    if (imageUrls.length === 0) {
      devLog(logPrefix, "skipped product image", {
        productId: product.id,
        reason: "missing image URL",
      });
      continue;
    }

    let loadedImagesForProduct = 0;

    for (const imageUrl of imageUrls) {
      if (productImageFiles.length >= MAX_TOTAL_PRODUCT_IMAGES) break;
      if (loadedImagesForProduct >= MAX_PRODUCT_IMAGES_PER_PRODUCT) break;

      if (!imageUrl.startsWith("/")) {
        devLog(logPrefix, "skipped product image", {
          productId: product.id,
          imageUrl,
          reason: "not a local public image path",
        });
        continue;
      }

      const imageExtension = getFileExtension(imageUrl);
      const imageType = PRODUCT_IMAGE_TYPES_BY_EXTENSION.get(imageExtension);

      if (!imageType) {
        devLog(logPrefix, "skipped product image", {
          productId: product.id,
          imageUrl,
          reason: "unsupported product image type",
        });
        continue;
      }

      const imagePath = `${process.cwd()}/public${imageUrl.split(/[?#]/)[0]}`;

      devLog(logPrefix, "loading product image", {
        productId: product.id,
        imagePath,
      });

      try {
        const fileBuffer = await readFile(imagePath);

        if (!isProductImageBufferValid(fileBuffer, imageType)) {
          devLog(logPrefix, "skipped product image", {
            productId: product.id,
            imagePath,
            reason: "image file signature did not match extension",
          });
          continue;
        }

        productImageFiles.push(
          new File(
            [fileBuffer],
            `${product.id}-${productImageFiles.length + 1}${imageExtension}`,
            {
              type: imageType,
            }
          )
        );
        loadedImagesForProduct += 1;
      } catch (error) {
        devLog(logPrefix, "skipped product image", {
          productId: product.id,
          imagePath,
          reason: error instanceof Error ? error.message : "read failed",
        });
      }
    }
  }

  return productImageFiles;
}
