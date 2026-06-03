const HEIC_UPLOAD_ERROR =
  "This iPhone photo format is not supported yet. Please convert to JPG or select a JPG/PNG image.";
const HEIC_CONVERSION_ERROR =
  "This iPhone photo could not be converted. Please export as JPG or choose another image.";
export const UNSUPPORTED_UPLOAD_ERROR =
  "Please upload a JPG, PNG, or WebP room photo.";

const supportedRoomPhotoTypes = ["image/jpeg", "image/png", "image/webp"];
const supportedRoomPhotoExtensions = [".jpg", ".jpeg", ".png", ".webp"];
const heicRoomPhotoTypes = ["image/heic", "image/heif"];
const heicRoomPhotoExtensions = [".heic", ".heif"];

function getFileExtension(fileName: string) {
  const extensionIndex = fileName.lastIndexOf(".");

  return extensionIndex === -1
    ? ""
    : fileName.slice(extensionIndex).toLowerCase();
}

function isHeicRoomPhoto(file: File) {
  const fileType = file.type.toLowerCase();
  const fileExtension = getFileExtension(file.name);

  return (
    heicRoomPhotoTypes.includes(fileType) ||
    heicRoomPhotoExtensions.includes(fileExtension)
  );
}

function hasSupportedRoomPhotoType(file: File) {
  return supportedRoomPhotoTypes.includes(file.type.toLowerCase());
}

function hasSupportedRoomPhotoExtension(file: File) {
  return supportedRoomPhotoExtensions.includes(getFileExtension(file.name));
}

export function getRoomPhotoValidationError(file: File): string | null {
  if (isHeicRoomPhoto(file)) {
    return HEIC_UPLOAD_ERROR;
  }

  if (hasSupportedRoomPhotoType(file)) {
    return null;
  }

  return UNSUPPORTED_UPLOAD_ERROR;
}

function loadImageFromUrl(imageUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to preview image."));
    image.src = imageUrl;
  });
}

async function loadCanvasImageSource(file: File, imageUrl: string) {
  if ("createImageBitmap" in window) {
    try {
      const imageBitmap = await window.createImageBitmap(file);

      return {
        source: imageBitmap,
        width: imageBitmap.width,
        height: imageBitmap.height,
        cleanup: () => imageBitmap.close(),
      };
    } catch {
      // Fall back to browser preview decoding below.
    }
  }

  const image = await loadImageFromUrl(imageUrl);

  return {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    cleanup: () => {},
  };
}

function canvasToJpegBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("Unable to convert image."));
      },
      "image/jpeg",
      0.92
    );
  });
}

async function convertRoomPhotoToJpeg(file: File) {
  const sourceUrl = URL.createObjectURL(file);
  let cleanupImageSource = () => {};

  try {
    const imageSource = await loadCanvasImageSource(file, sourceUrl);
    const canvas = document.createElement("canvas");
    const { width, height } = imageSource;

    cleanupImageSource = imageSource.cleanup;

    if (!width || !height) {
      throw new Error("Unable to read image dimensions.");
    }

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Unable to prepare image conversion.");
    }

    context.drawImage(imageSource.source, 0, 0, width, height);

    const jpegBlob = await canvasToJpegBlob(canvas);
    const fileName = file.name.replace(/\.[^/.]+$/, "") || "room-photo";

    return new File([jpegBlob], `${fileName}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } finally {
    cleanupImageSource();
    URL.revokeObjectURL(sourceUrl);
  }
}

export async function normalizeRoomPhoto(file: File) {
  if (isHeicRoomPhoto(file)) {
    try {
      return await convertRoomPhotoToJpeg(file);
    } catch {
      throw new Error(HEIC_CONVERSION_ERROR);
    }
  }

  if (hasSupportedRoomPhotoType(file)) {
    return file;
  }

  if (hasSupportedRoomPhotoExtension(file)) {
    try {
      return await convertRoomPhotoToJpeg(file);
    } catch {
      throw new Error(UNSUPPORTED_UPLOAD_ERROR);
    }
  }

  throw new Error(UNSUPPORTED_UPLOAD_ERROR);
}
