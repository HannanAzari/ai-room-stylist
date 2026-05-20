"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { GenerationProgress } from "@/components/GenerationProgress";
import allProducts from "@/data/products.json";
import { trackEvent } from "@/lib/analytics";
import { getPrimaryProductImageUrl, type Product } from "@/lib/products";

const styles = [
  "modern luxury",
  "warm neutral",
  "minimal",
  "hotel style",
  "family living",
];

const roomTypes = ["living room", "dining room", "bedroom"];
const CACHE_KEY = "ai-room-stylist:last-result";
const SHARE_MESSAGE =
  "I created a luxury room concept with AI Room Stylist. Full-room package preview coming soon.";
const HEIC_UPLOAD_ERROR =
  "This iPhone photo format is not supported yet. Please convert to JPG or select a JPG/PNG image.";
const HEIC_CONVERSION_ERROR =
  "This iPhone photo could not be converted. Please export as JPG or choose another image.";
const UNSUPPORTED_UPLOAD_ERROR =
  "Please upload a JPG, PNG, or WebP room photo.";
const supportedRoomPhotoTypes = ["image/jpeg", "image/png", "image/webp"];
const supportedRoomPhotoExtensions = [".jpg", ".jpeg", ".png", ".webp"];
const heicRoomPhotoTypes = ["image/heic", "image/heif"];
const heicRoomPhotoExtensions = [".heic", ".heif"];
const generateProgressMessages = [
  "Analysing room layout...",
  "Reading your selected products...",
  "Composing luxury furniture arrangement...",
  "Rendering final concept...",
];
const refineProgressMessages = [
  "Opening the selected concept",
  "Applying your requested change",
  "Preserving the room perspective",
  "Finishing the refined render",
];
const refineQuickPrompts = [
  "Make it warmer",
  "Add more luxury",
  "Use darker furniture",
  "Add a larger rug",
  "Make it more minimal",
  "Improve lighting",
];
const preferredCategoryOrder = [
  "sofas",
  "coffee-tables",
  "dining-tables",
  "chairs",
  "lighting",
  "decor",
  "rugs",
];
const productList = allProducts as Product[];
const productCategoryIds = Array.from(
  new Set(productList.map((product) => product.category).filter(Boolean))
).sort((a, b) => {
  const aIndex = preferredCategoryOrder.indexOf(a);
  const bIndex = preferredCategoryOrder.indexOf(b);

  if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
  if (aIndex !== -1) return -1;
  if (bIndex !== -1) return 1;

  return a.localeCompare(b);
});
const productsByCategory = productCategoryIds
  .map((categoryId) => ({
    id: categoryId,
    label: categoryId,
    products: productList.filter((product) => product.category === categoryId),
  }))
  .filter((category) => category.products.length > 0);

function getCategoryLabel(category: string) {
  return category;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getShortProductName(product: Product) {
  const descriptors = [
    ...product.colors,
    ...product.materials,
    "antique",
    "ash",
    "beige",
    "black",
    "bronze",
    "brown",
    "brushed",
    "cream",
    "ebony",
    "fabric",
    "finish",
    "gloss",
    "gold",
    "leather",
    "light",
    "matte",
    "mocha",
    "sand",
    "sintered",
    "soft",
    "stone",
    "top",
    "vegan",
    "velvet",
    "velveteen",
    "veneer",
    "walnut",
    "white",
    "wooden",
  ]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  let shortName = product.name
    .replace(/\bwith\b.*$/i, "")
    .replace(/\b\d+(?:\s?x\s?\d+)?\s?(?:cm|mm|m)\b/gi, "");

  descriptors.forEach((descriptor) => {
    shortName = shortName.replace(
      new RegExp(`\\b${escapeRegExp(descriptor)}\\b`, "gi"),
      ""
    );
  });

  shortName = shortName.replace(/\s+/g, " ").trim();

  if (!shortName) {
    shortName = product.name.replace(/\s+/g, " ").trim();
  }

  const words = shortName.split(" ");

  return words.length > 7 ? words.slice(0, 7).join(" ") : shortName;
}

function getProductImageUrl(product: Product): string | null {
  return getPrimaryProductImageUrl(product);
}

function getProductUrl(product: Product): string | null {
  const productUrl = product.url?.trim();

  return productUrl || null;
}

function getProductsFromIds(productIds: string[]): Product[] {
  return productIds
    .map((productId) => productList.find((product) => product.id === productId))
    .filter((product): product is Product => Boolean(product));
}

function mergeUniqueProducts(
  currentProducts: Product[],
  productsToAdd: Product[]
) {
  const seenProductIds = new Set(currentProducts.map((product) => product.id));

  return [
    ...currentProducts,
    ...productsToAdd.filter((product) => {
      if (seenProductIds.has(product.id)) return false;

      seenProductIds.add(product.id);
      return true;
    }),
  ];
}

function formatPrice(price: Product["price"]) {
  return typeof price === "number" ? `$${price.toLocaleString()}` : "Price on request";
}

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

function getRoomPhotoValidationError(file: File): string | null {
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

async function normalizeRoomPhoto(file: File) {
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

function ProductImage({
  product,
  className,
  placeholderClassName,
}: {
  product: Product;
  className: string;
  placeholderClassName: string;
}) {
  const imageUrl = getProductImageUrl(product);

  if (!imageUrl) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg border border-dashed border-neutral-700 bg-neutral-950 text-xs text-neutral-500 ${placeholderClassName}`}
      >
        No image
      </div>
    );
  }

  return (
    <Image
      src={imageUrl}
      alt={product.name}
      width={320}
      height={240}
      className={className}
    />
  );
}

export default function HomePage() {
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [style, setStyle] = useState(styles[0]);
  const [roomType, setRoomType] = useState(roomTypes[0]);
  const [loading, setLoading] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");
  const [selectedConcept, setSelectedConcept] = useState<number | null>(null);
  const [changeRequest, setChangeRequest] = useState("");
  const [refining, setRefining] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [selectedRefinementProductIds, setSelectedRefinementProductIds] =
    useState<string[]>([]);
  const [favouriteProductIds, setFavouriteProductIds] = useState<string[]>([]);
  const [demoMessage, setDemoMessage] = useState("");
  const [generateProgressIndex, setGenerateProgressIndex] = useState(0);
  const [refineProgressIndex, setRefineProgressIndex] = useState(0);
  const [openProductCategoryId, setOpenProductCategoryId] = useState<
    string | null
  >(null);
  const [openRefinementProductCategoryId, setOpenRefinementProductCategoryId] =
    useState<string | null>(null);
  const [lightboxConceptIndex, setLightboxConceptIndex] = useState<
    number | null
  >(null);
  const [isSelectedProductsSheetOpen, setIsSelectedProductsSheetOpen] =
    useState(false);
  const demoMessageTimeoutRef = useRef<number | null>(null);
  const selectedProducts = getProductsFromIds(selectedProductIds);
  const lightboxImage =
    lightboxConceptIndex === null
      ? null
      : generatedImages[lightboxConceptIndex] || null;

  useEffect(() => {
    const cached = localStorage.getItem(CACHE_KEY);

    if (!cached) return;

    try {
      const parsed = JSON.parse(cached);
      const timeout = window.setTimeout(() => {
        setGeneratedImages(parsed.generatedImages || []);
        setProducts(parsed.products || []);
        setStyle(parsed.style || styles[0]);
        setRoomType(parsed.roomType || roomTypes[0]);
      }, 0);

      return () => window.clearTimeout(timeout);
    } catch {
      localStorage.removeItem(CACHE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!loading) return;

    const interval = window.setInterval(() => {
      setGenerateProgressIndex((current) =>
        Math.min(current + 1, generateProgressMessages.length - 1)
      );
    }, 3500);

    return () => window.clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    if (!refining) return;

    const interval = window.setInterval(() => {
      setRefineProgressIndex((current) =>
        Math.min(current + 1, refineProgressMessages.length - 1)
      );
    }, 3000);

    return () => window.clearInterval(interval);
  }, [refining]);

  useEffect(() => {
    return () => {
      if (demoMessageTimeoutRef.current) {
        window.clearTimeout(demoMessageTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (lightboxConceptIndex === null) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setLightboxConceptIndex(null);
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [lightboxConceptIndex]);

  function showDemoMessage(message: string) {
    if (demoMessageTimeoutRef.current) {
      window.clearTimeout(demoMessageTimeoutRef.current);
    }

    setDemoMessage(message);
    demoMessageTimeoutRef.current = window.setTimeout(() => {
      setDemoMessage("");
    }, 2600);
  }

  function saveResultCache(
    nextGeneratedImages: string[],
    nextProducts = products
  ) {
    if (nextGeneratedImages.length === 0) {
      localStorage.removeItem(CACHE_KEY);
      return;
    }

    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        generatedImages: nextGeneratedImages,
        products: nextProducts,
        style,
        roomType,
        createdAt: new Date().toISOString(),
      })
    );
  }

  function toggleProduct(productId: string) {
    setSelectedProductIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    );
  }

  function toggleFavouriteProduct(productId: string, productName: string) {
    const isFavourite = favouriteProductIds.includes(productId);

    setFavouriteProductIds((current) =>
      isFavourite
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    );
    showDemoMessage(
      isFavourite
        ? `${productName} removed from favourites.`
        : `${productName} added to favourites.`
    );
    trackEvent("favourite_clicked", {
      productId,
      productName,
      action: isFavourite ? "removed" : "added",
    });
  }

  function toggleRefinementProduct(productId: string) {
    setSelectedRefinementProductIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    );
  }

  function appendRefinePrompt(instruction: string) {
    setChangeRequest((current) =>
      current.trim() ? `${current.trim()}\n${instruction}` : instruction
    );
  }

  function toggleProductCategory(categoryId: string) {
    setOpenProductCategoryId((current) =>
      current === categoryId ? null : categoryId
    );
  }

  function toggleRefinementProductCategory(categoryId: string) {
    setOpenRefinementProductCategoryId((current) =>
      current === categoryId ? null : categoryId
    );
  }

  function clearSelectedProducts() {
    setSelectedProductIds([]);
    setOpenProductCategoryId(null);
    setIsSelectedProductsSheetOpen(false);
  }

  function clearGeneratedConcepts() {
    localStorage.removeItem(CACHE_KEY);
    setGeneratedImages([]);
    setProducts([]);
    setSelectedConcept(null);
    setChangeRequest("");
    setSelectedRefinementProductIds([]);
    setOpenRefinementProductCategoryId(null);
    setLightboxConceptIndex(null);
  }

  function removeGeneratedConcept(conceptIndex: number) {
    const nextGeneratedImages = generatedImages.filter(
      (_, index) => index !== conceptIndex
    );

    setGeneratedImages(nextGeneratedImages);
    setSelectedConcept((current) => {
      if (current === null) return null;
      if (current === conceptIndex) return null;

      return current > conceptIndex ? current - 1 : current;
    });
    setLightboxConceptIndex((current) => {
      if (current === null) return null;
      if (current === conceptIndex) return null;

      return current > conceptIndex ? current - 1 : current;
    });
    saveResultCache(nextGeneratedImages);
  }

  function downloadGeneratedImage(imageBase64: string, index: number) {
    trackEvent("download_clicked", {
      conceptIndex: index,
    });

    const binary = window.atob(imageBase64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ai-room-stylist-concept-${index + 1}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showDemoMessage(`Concept ${index + 1} downloaded.`);
  }

  async function shareGeneratedConcept(index: number) {
    const conceptShareMessage = `${SHARE_MESSAGE} Concept ${index + 1}.`;
    const canUseNativeShare = "share" in navigator;
    const shareMethod = canUseNativeShare ? "native" : "clipboard";

    trackEvent("share_clicked", {
      conceptIndex: index,
      shareMethod,
    });

    if (canUseNativeShare) {
      try {
        await navigator.share({
          title: "AI Room Stylist concept",
          text: conceptShareMessage,
          url: window.location.href,
        });
        showDemoMessage("Share sheet opened.");
      } catch {
        showDemoMessage("Share cancelled.");
      }

      return;
    }

    try {
      await navigator.clipboard.writeText(conceptShareMessage);
      showDemoMessage("Share message copied to clipboard.");
    } catch {
      window.alert(conceptShareMessage);
    }
  }

  function addProductToCart(product: Product) {
    trackEvent("add_to_cart_clicked", {
      productId: product.id,
      productName: product.name,
      category: product.category,
    });
    showDemoMessage(`${product.name} added to demo cart.`);
  }

  function addFullBundleToCart() {
    trackEvent("bundle_add_to_cart_clicked", {
      productCount: products.length,
      productIds: products.map((product) => product.id),
    });
    showDemoMessage(`${products.length} item bundle added to demo cart.`);
  }

  async function handleImageChange(file: File | null) {
    setImage(null);
    setPreviewUrl("");
    setGeneratedImages([]);
    setProducts([]);
    setError("");
    setSelectedRefinementProductIds([]);
    setLightboxConceptIndex(null);

    if (previewUrl) URL.revokeObjectURL(previewUrl);

    if (!file) {
      return;
    }

    try {
      const normalizedFile = await normalizeRoomPhoto(file);

      setImage(normalizedFile);
      setPreviewUrl(URL.createObjectURL(normalizedFile));
    } catch (normalizationError) {
      setImage(null);
      setPreviewUrl("");
      setError(
        normalizationError instanceof Error
          ? normalizationError.message
          : UNSUPPORTED_UPLOAD_ERROR
      );
    }
  }

  async function handleGenerate() {
    if (!image) {
      setError("Please upload a room photo first.");
      return;
    }

    const validationError = getRoomPhotoValidationError(image);

    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setGenerateProgressIndex(0);
    setError("");
    setGeneratedImages([]);
    setProducts([]);
    setSelectedConcept(null);
    setLightboxConceptIndex(null);
    trackEvent("generate_started", {
      roomType,
      style,
      selectedProductIds,
      selectedProductCount: selectedProductIds.length,
    });

    try {
      const formData = new FormData();
      formData.append("image", image);
      formData.append("style", style);
      formData.append("roomType", roomType);
      formData.append("selectedProductIds", JSON.stringify(selectedProductIds));

      const res = await fetch("/api/generate-room", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      const nextGeneratedImages = data.images.map(
        (img: { b64_json: string }) => img.b64_json
      );

      setGeneratedImages(nextGeneratedImages);
      setProducts(data.products);
      trackEvent("generate_completed", {
        roomType,
        style,
        imageCount: data.images.length,
        productCount: data.products.length,
        productIds: data.products.map((product: Product) => product.id),
      });
      saveResultCache(nextGeneratedImages, data.products);
    } catch {
      setError("Failed to connect to the generation service.");
    } finally {
      setLoading(false);
    }
  }
  async function handleRefine() {
    if (selectedConcept === null) return;
    if (!changeRequest.trim() && selectedRefinementProductIds.length === 0) {
      return;
    }

    setRefining(true);
    setRefineProgressIndex(0);
    setError("");
    trackEvent("refine_started", {
      conceptIndex: selectedConcept,
      hasTextInstruction: Boolean(changeRequest.trim()),
      refinementProductIds: selectedRefinementProductIds,
      refinementProductCount: selectedRefinementProductIds.length,
    });

    try {
      const res = await fetch("/api/refine-room", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageBase64: generatedImages[selectedConcept],
          changeRequest,
          refinementProductIds: selectedRefinementProductIds,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Refinement failed.");
        return;
      }

      const refinedImage = data.image.b64_json;

      const updatedImages = [...generatedImages, refinedImage];
      const refinedConceptIndex = updatedImages.length - 1;
      const refinementProducts = getProductsFromIds(selectedRefinementProductIds);
      const updatedProducts = mergeUniqueProducts(products, refinementProducts);

      setGeneratedImages(updatedImages);
      setProducts(updatedProducts);
      setSelectedConcept(refinedConceptIndex);
      setChangeRequest("");
      setSelectedRefinementProductIds([]);
      setOpenRefinementProductCategoryId(null);
      trackEvent("refine_completed", {
        conceptIndex: selectedConcept,
        refinedConceptIndex,
        hasTextInstruction: Boolean(changeRequest.trim()),
        refinementProductIds: selectedRefinementProductIds,
        refinementProductCount: selectedRefinementProductIds.length,
        mergedProductCount: updatedProducts.length,
      });

      saveResultCache(updatedImages, updatedProducts);
    } catch {
      setError("Failed to connect to refinement service.");
    } finally {
      setRefining(false);
    }
  }
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#080808] text-white">
      {demoMessage && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-center text-sm text-white shadow-2xl"
        >
          {demoMessage}
        </div>
      )}

      {lightboxImage && lightboxConceptIndex !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Generated concept ${lightboxConceptIndex + 1} preview`}
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4"
        >
          <button
            type="button"
            onClick={() => setLightboxConceptIndex(null)}
            aria-label="Close generated concept preview"
            className="absolute inset-0 cursor-default"
          />
          <div className="relative z-10 w-full max-w-5xl rounded-2xl border border-neutral-800 bg-neutral-950 p-4 shadow-2xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                Concept {lightboxConceptIndex + 1}
              </h2>
              <button
                type="button"
                onClick={() => setLightboxConceptIndex(null)}
                className="rounded-full border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-800"
              >
                X Close
              </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-neutral-800 bg-black">
              <img
                src={`data:image/png;base64,${lightboxImage}`}
                alt={`Generated room concept ${lightboxConceptIndex + 1}`}
                className="max-h-[75vh] w-full object-contain"
              />
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() =>
                  downloadGeneratedImage(lightboxImage, lightboxConceptIndex)
                }
                className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-neutral-200"
              >
                Download
              </button>
              <button
                type="button"
                onClick={() => shareGeneratedConcept(lightboxConceptIndex)}
                className="rounded-xl border border-neutral-700 px-5 py-3 text-sm text-neutral-200 hover:bg-neutral-800"
              >
                Share
              </button>
            </div>
          </div>
        </div>
      )}

      {isSelectedProductsSheetOpen && selectedProducts.length > 0 && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Selected products"
          className="fixed inset-0 z-50 flex items-end bg-black/70 px-3 pb-3 md:hidden"
        >
          <button
            type="button"
            onClick={() => setIsSelectedProductsSheetOpen(false)}
            aria-label="Close selected products"
            className="absolute inset-0"
          />
          <section className="relative z-10 max-h-[82vh] w-full max-w-full overflow-y-auto overflow-x-hidden rounded-3xl border border-neutral-800 bg-neutral-950 p-4 shadow-2xl animate-[softRise_220ms_ease-out]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">
                  Selected products
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  {selectedProducts.length} selected
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsSelectedProductsSheetOpen(false)}
                className="rounded-full border border-neutral-700 px-3 py-1 text-sm text-neutral-200"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {selectedProducts.map((product) => (
                <article
                  key={product.id}
                  className="relative max-w-full rounded-2xl border border-neutral-800 bg-neutral-900 p-2"
                >
                  <ProductImage
                    product={product}
                    className="h-24 w-full rounded-xl object-cover"
                    placeholderClassName="h-24 w-full"
                  />
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation();
                      event.currentTarget.blur();
                      setSelectedProductIds((current) =>
                        current.filter((id) => id !== product.id)
                      );
                    }}
                    aria-label={`Deselect ${getShortProductName(product)}`}
                    className="absolute right-4 top-4 rounded-full border border-neutral-700 bg-neutral-950/80 px-2 py-0.5 text-xs text-white"
                  >
                    X
                  </button>
                  <p className="mt-2 line-clamp-2 text-xs font-semibold leading-snug">
                    {getShortProductName(product)}
                  </p>
                </article>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setIsSelectedProductsSheetOpen(false)}
              className="mt-4 w-full rounded-full bg-white px-4 py-3 text-sm font-semibold text-black"
            >
              Done
            </button>
          </section>
        </div>
      )}

      <section className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-10 border-b border-neutral-800 pb-8">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <Image
                src="/koala-logo.png"
                alt="Koala Living"
                width={185}
                height={80}
                priority
                className="h-auto w-44 sm:w-52"
              />
              <p className="mt-5 text-xs uppercase tracking-[0.32em] text-neutral-500">
                AI Room Stylist
              </p>
            </div>

            <p className="max-w-sm text-right text-sm leading-6 text-neutral-400">
              Curate a complete room concept with real furniture references,
              premium styling, and a shoppable bundle.
            </p>
          </div>

          <h1 className="mt-10 max-w-3xl font-serif text-4xl leading-tight text-white sm:text-5xl">
            Redesign your room with luxury furniture
          </h1>
          <p className="mt-4 max-w-2xl text-neutral-300">
            Upload a room photo, choose a style, and generate premium interior
            concepts with matching furniture suggestions.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="rounded-3xl border border-neutral-800 bg-neutral-950/80 p-6 shadow-2xl">
            <label className="mb-2 block text-sm text-neutral-300">
              Upload room photo
            </label>

            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
              onChange={(e) => {
                void handleImageChange(e.target.files?.[0] || null);
              }}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-sm"
            />

            {previewUrl && (
              <div className="mt-5 overflow-hidden rounded-xl border border-neutral-800">
                <img
                  src={previewUrl}
                  alt="Uploaded room preview"
                  className="max-h-[500px] w-full object-contain"
                />
              </div>
            )}

            {selectedProducts.length > 0 && (
              <section className="mt-4 hidden animate-[softRise_260ms_ease-out] rounded-xl border border-neutral-800 bg-neutral-950/60 p-4 md:block">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">Selected products</h2>
                  <span className="rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300">
                    {selectedProducts.length}
                  </span>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {selectedProducts.map((product) => (
                    <article
                      key={product.id}
                      className="relative animate-[softRise_240ms_ease-out] rounded-xl border border-neutral-800 bg-neutral-900 p-3 transition-all duration-200 hover:border-neutral-600"
                    >
                      <ProductImage
                        product={product}
                        className="h-32 w-full rounded-lg object-cover"
                        placeholderClassName="h-32 w-full"
                      />
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => {
                          event.currentTarget.blur();
                          setSelectedProductIds((current) =>
                            current.filter((id) => id !== product.id)
                          );
                        }}
                        aria-label={`Deselect ${getShortProductName(product)}`}
                        className="absolute right-5 top-5 rounded-full border border-neutral-700 bg-neutral-950/80 px-2 py-0.5 text-xs text-white hover:bg-neutral-800"
                      >
                        X
                      </button>
                      <p className="mt-3 line-clamp-2 text-sm font-semibold leading-snug">
                        {getShortProductName(product)}
                      </p>
                      <p className="mt-1 text-xs text-neutral-400">
                        {getCategoryLabel(product.category)}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="rounded-3xl border border-neutral-800 bg-neutral-950/80 p-6 shadow-2xl">
            <label className="mb-2 block text-sm text-neutral-300">
              Room type
            </label>
            <select
              value={roomType}
              onChange={(e) => setRoomType(e.target.value)}
              className="mb-5 w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3"
            >
              {roomTypes.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>

            <label className="mb-2 block text-sm text-neutral-300">
              Style
            </label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="mb-6 w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3"
            >
              {styles.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <div className="mb-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-neutral-300">
                  Select products to include
                </p>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300">
                    {selectedProductIds.length} selected
                  </span>
                  <button
                    type="button"
                    onClick={clearSelectedProducts}
                    disabled={selectedProductIds.length === 0}
                    className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Clear selected products
                  </button>
                </div>
              </div>

              {selectedProducts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsSelectedProductsSheetOpen(true)}
                  className="sticky top-2 z-20 mb-3 flex w-full max-w-full touch-manipulation items-center justify-between gap-3 rounded-full border border-neutral-700 bg-neutral-950/95 px-4 py-3 text-left shadow-2xl backdrop-blur md:hidden"
                >
                  <span className="min-w-0 text-sm font-semibold text-white">
                    {selectedProducts.length} products selected
                  </span>
                  <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-black">
                    View
                  </span>
                </button>
              )}

              <div className="grid gap-3">
                {productsByCategory.map((category) => {
                  const isOpen = openProductCategoryId === category.id;

                  return (
                    <section
                      key={category.id}
                      className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950/60 transition-colors duration-300 hover:border-neutral-700"
                    >
                      <button
                        type="button"
                        onClick={() => toggleProductCategory(category.id)}
                        aria-expanded={isOpen}
                        aria-controls={`product-category-${category.id}`}
                        className="flex w-full items-center justify-between gap-3 p-3 text-left transition-colors duration-200 hover:bg-neutral-900"
                      >
                        <span className="text-xs font-semibold uppercase tracking-widest text-neutral-400">
                          {category.label}
                        </span>
                        <span className="flex items-center gap-2 text-xs text-neutral-500">
                          <span>
                            {
                              category.products.filter((product) =>
                                selectedProductIds.includes(product.id)
                              ).length
                            }
                            /{category.products.length}
                          </span>
                          <span className="text-neutral-600 transition-transform duration-300">
                            {isOpen ? "-" : "+"}
                          </span>
                        </span>
                      </button>

                      <div
                        id={`product-category-${category.id}`}
                        aria-hidden={!isOpen}
                        className={`grid transition-all duration-300 ease-out ${
                          isOpen
                            ? "grid-rows-[1fr] opacity-100"
                            : "grid-rows-[0fr] opacity-0"
                        }`}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div className="grid grid-cols-2 gap-2 px-3 pb-3 animate-[accordionReveal_220ms_ease-out] sm:grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] sm:gap-3">
                            {category.products.map((p) => {
                              const isSelected =
                                selectedProductIds.includes(p.id);

                              return (
                                <button
                                  key={p.id}
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  onClick={(event) => {
                                    event.currentTarget.blur();
                                    toggleProduct(p.id);
                                  }}
                                  type="button"
                                  tabIndex={isOpen ? 0 : -1}
                                  aria-pressed={isSelected}
                                  className={`relative flex min-h-44 touch-manipulation flex-col gap-2 rounded-xl border p-2 text-left transition-all duration-200 hover:-translate-y-0.5 ${
                                    isSelected
                                      ? "border-white bg-neutral-800 ring-1 ring-white"
                                      : "border-neutral-700 bg-neutral-950 hover:border-neutral-500 hover:bg-neutral-900"
                                  }`}
                                >
                                  <ProductImage
                                    product={p}
                                    className="h-24 w-full rounded-lg object-cover"
                                    placeholderClassName="h-24 w-full"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <p
                                      title={p.name}
                                      className="line-clamp-2 text-sm font-semibold leading-snug"
                                    >
                                      {getShortProductName(p)}
                                    </p>
                                    <p className="mt-1 text-[11px] text-neutral-500">
                                      {getCategoryLabel(p.category)}
                                    </p>
                                  </div>
                                  {isSelected && (
                                    <span className="absolute right-3 top-3 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-black">
                                      Selected
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading || !image}
              className="w-full rounded-xl bg-white px-6 py-3 font-semibold text-black shadow-lg shadow-white/10 transition-all duration-200 hover:-translate-y-0.5 hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {loading ? "Generating concept..." : "Generate concept"}
            </button>

            {loading && (
              <div className="mt-4">
                <GenerationProgress
                  title="Generating room concept"
                  message={generateProgressMessages[generateProgressIndex]}
                  steps={generateProgressMessages}
                  activeStep={generateProgressIndex}
                />
              </div>
            )}

            <button
              onClick={clearGeneratedConcepts}
              className="mt-3 w-full rounded-xl border border-neutral-700 px-6 py-3 text-sm text-neutral-300 transition-colors duration-200 hover:bg-neutral-800"
            >
              Clear saved results
            </button>

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          </div>
        </div>

        {loading && (
          <section className="mt-10 animate-[softRise_260ms_ease-out]">
            <h2 className="mb-4 font-serif text-2xl font-semibold">
              Designing your concept
            </h2>
            <div className="overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950 shadow-2xl animate-[luxuryPulse_2.8s_ease-in-out_infinite]">
              <div className="relative flex aspect-square items-center justify-center bg-neutral-950">
                <div className="absolute h-28 w-28 rounded-full border border-white/10" />
                <div className="absolute h-44 w-44 rounded-full border border-white/5 animate-pulse" />
                <div className="h-16 w-16 rounded-full border-2 border-neutral-700 border-t-white animate-spin" />
              </div>
              <div className="p-4">
                <div className="h-10 rounded-lg border border-neutral-800 bg-neutral-900" />
              </div>
            </div>
          </section>
        )}

        {generatedImages.length > 0 && (
          <section className="mt-10">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-semibold">Generated concepts</h2>
              <button
                type="button"
                onClick={clearGeneratedConcepts}
                aria-label="Clear generated concepts"
                className="rounded-full border border-neutral-700 px-3 py-1 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                X Clear concepts
              </button>
            </div>
            {selectedConcept !== null && (
              <section className="mt-10 rounded-2xl bg-neutral-900 p-6">
                <h2 className="text-2xl font-semibold">Refine selected concept</h2>

                <p className="mt-2 text-sm text-neutral-400">
                  Tell the AI what you want to change.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {refineQuickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => appendRefinePrompt(prompt)}
                      className="rounded-full border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>

                <textarea
                  value={changeRequest}
                  onChange={(e) => setChangeRequest(e.target.value)}
                  placeholder="Example: make the sofa darker, add a larger rug, change the coffee table to marble..."
                  className="mt-4 min-h-28 w-full rounded-xl border border-neutral-700 bg-neutral-800 p-4 text-sm text-white"
                />

                <div className="mt-5 rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">
                        Swap/add products
                      </h3>
                      <p className="mt-1 text-xs text-neutral-500">
                        Add product references for this refinement only.
                      </p>
                    </div>
                    <span className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300">
                      {selectedRefinementProductIds.length} selected
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3">
                    {productsByCategory.map((category) => {
                      const isOpen =
                        openRefinementProductCategoryId === category.id;

                      return (
                        <section
                          key={category.id}
                          className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950/60 transition-colors duration-300 hover:border-neutral-700"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              toggleRefinementProductCategory(category.id)
                            }
                            aria-expanded={isOpen}
                            aria-controls={`refinement-product-category-${category.id}`}
                            className="flex w-full items-center justify-between gap-3 p-3 text-left transition-colors duration-200 hover:bg-neutral-900"
                          >
                            <span className="text-xs font-semibold uppercase tracking-widest text-neutral-400">
                              {category.label}
                            </span>
                            <span className="flex items-center gap-2 text-xs text-neutral-500">
                              <span>
                                {
                                  category.products.filter((product) =>
                                    selectedRefinementProductIds.includes(
                                      product.id
                                    )
                                  ).length
                                }
                                /{category.products.length}
                              </span>
                              <span className="text-neutral-600 transition-transform duration-300">
                                {isOpen ? "-" : "+"}
                              </span>
                            </span>
                          </button>

                          <div
                            id={`refinement-product-category-${category.id}`}
                            aria-hidden={!isOpen}
                            className={`grid transition-all duration-300 ease-out ${
                              isOpen
                                ? "grid-rows-[1fr] opacity-100"
                                : "grid-rows-[0fr] opacity-0"
                            }`}
                          >
                            <div className="min-h-0 overflow-hidden">
                              <div className="grid grid-cols-2 gap-2 px-3 pb-3 animate-[accordionReveal_220ms_ease-out] sm:grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] sm:gap-3">
                                {category.products.map((p) => {
                                  const isSelected =
                                    selectedRefinementProductIds.includes(p.id);

                                  return (
                                    <button
                                      key={p.id}
                                      type="button"
                                      tabIndex={isOpen ? 0 : -1}
                                      onMouseDown={(event) =>
                                        event.preventDefault()
                                      }
                                      onClick={(event) => {
                                        event.currentTarget.blur();
                                        toggleRefinementProduct(p.id)
                                      }}
                                      aria-pressed={isSelected}
                                      className={`relative flex min-h-44 touch-manipulation flex-col gap-2 rounded-xl border p-2 text-left transition-all duration-200 hover:-translate-y-0.5 ${
                                        isSelected
                                          ? "border-white bg-neutral-800 ring-1 ring-white"
                                          : "border-neutral-700 bg-neutral-950 hover:border-neutral-500 hover:bg-neutral-900"
                                      }`}
                                    >
                                      <ProductImage
                                        product={p}
                                        className="h-24 w-full rounded-lg object-cover"
                                        placeholderClassName="h-24 w-full"
                                      />
                                      <div className="min-w-0 flex-1">
                                        <p
                                          title={p.name}
                                          className="line-clamp-2 text-sm font-semibold leading-snug"
                                        >
                                          {getShortProductName(p)}
                                        </p>
                                        <p className="mt-1 text-[11px] text-neutral-500">
                                          {getCategoryLabel(p.category)}
                                        </p>
                                      </div>
                                      {isSelected && (
                                        <span className="absolute right-3 top-3 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-black">
                                          Selected
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </div>

                <button
                  onClick={handleRefine}
                  disabled={
                    (!changeRequest.trim() &&
                      selectedRefinementProductIds.length === 0) ||
                    refining
                  }
                  className="mt-4 rounded-xl bg-white px-6 py-3 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {refining ? "Refining concept..." : "Regenerate with changes"}
                </button>

                {refining && (
                  <div className="mt-4">
                    <GenerationProgress
                      title="Refining selected concept"
                      message={refineProgressMessages[refineProgressIndex]}
                      steps={refineProgressMessages}
                      activeStep={refineProgressIndex}
                    />
                  </div>
                )}
              </section>
            )}

            <div className="grid gap-6 md:grid-cols-3">
              {generatedImages.map((img, index) => (
                <div
                  key={index}
                  className="relative animate-[softRise_320ms_ease-out] overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 shadow-xl transition-all duration-300 hover:-translate-y-1 hover:border-neutral-600"
                >
                  <button
                    type="button"
                    onClick={() => removeGeneratedConcept(index)}
                    disabled={refining}
                    aria-label={`Remove concept ${index + 1}`}
                    className="absolute right-3 top-3 z-10 rounded-full border border-neutral-700 bg-neutral-950/80 px-2 py-0.5 text-xs text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    X
                  </button>

                  <button
                    type="button"
                    onClick={() => setLightboxConceptIndex(index)}
                    aria-label={`Open generated room concept ${index + 1}`}
                    className="block w-full text-left"
                  >
                    <img
                      src={`data:image/png;base64,${img}`}
                      alt={`Generated room concept ${index + 1}`}
                      className={`w-full transition hover:opacity-90 ${
                        refining && selectedConcept === index
                          ? "opacity-60"
                          : ""
                      }`}
                    />
                  </button>
                  <div className="p-4">
                    <div className="grid gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const isSelected = selectedConcept === index;

                          setSelectedConcept(isSelected ? null : index);
                          trackEvent(
                            isSelected
                              ? "concept_deselected"
                              : "concept_selected",
                            { conceptIndex: index }
                          );
                        }}
                        className={`w-full rounded-lg border px-4 py-2 text-sm ${
                          selectedConcept === index
                            ? "border-white bg-white text-black"
                            : "border-neutral-700 hover:bg-neutral-800"
                        }`}
                      >
                        {selectedConcept === index ? "Selected" : "Choose this concept"}
                      </button>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => downloadGeneratedImage(img, index)}
                          className="w-full rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
                        >
                          Download
                        </button>

                        <button
                          type="button"
                          onClick={() => shareGeneratedConcept(index)}
                          className="w-full rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
                        >
                          Share
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {generatedImages.length > 0 && products.length > 0 && (
          <section className="mt-10 rounded-3xl border border-neutral-800 bg-neutral-950/80 p-6 shadow-2xl">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.32em] text-neutral-500">
                  Suggested furniture bundle
                </p>
                <h2 className="mt-2 font-serif text-3xl font-semibold">
                  Complete the look
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-400">
                  A curated room package using the furniture references from
                  your concept.
                </p>
                <p className="mt-3 inline-flex rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs text-neutral-200">
                  Bundle offer: 10% off full room package
                </p>
              </div>

              <button
                type="button"
                onClick={addFullBundleToCart}
                className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black shadow-lg shadow-white/10 transition-all duration-200 hover:-translate-y-0.5 hover:bg-neutral-200"
              >
                Add full bundle to cart
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {products.map((p) => {
                const productUrl = getProductUrl(p);

                return (
                  <article
                    key={p.id}
                    className="animate-[softRise_280ms_ease-out] rounded-2xl border border-neutral-800 bg-neutral-900 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-neutral-600"
                  >
                    <div className="relative mb-3">
                      <ProductImage
                        product={p}
                        className="h-48 w-full rounded-lg object-cover"
                        placeholderClassName="h-48 w-full"
                      />
                      <button
                        type="button"
                        onClick={() => toggleFavouriteProduct(p.id, p.name)}
                        aria-pressed={favouriteProductIds.includes(p.id)}
                        className={`absolute right-3 top-3 rounded-full border px-3 py-1 text-sm font-semibold ${
                          favouriteProductIds.includes(p.id)
                            ? "border-white bg-white text-black"
                            : "border-neutral-700 bg-neutral-950/80 text-white hover:bg-neutral-800"
                        }`}
                      >
                        {favouriteProductIds.includes(p.id) ? "♥" : "♡"}
                      </button>
                    </div>

                    <p className="font-semibold">{p.name}</p>
                    <p className="text-sm text-neutral-400">
                      {getCategoryLabel(p.category)}
                    </p>

                    <p className="mt-2 text-neutral-200">
                      {formatPrice(p.price)}
                    </p>

                    <div className="mt-4 grid gap-2">
                      <button
                        type="button"
                        onClick={() => addProductToCart(p)}
                        className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-colors duration-200 hover:bg-neutral-200"
                      >
                        Add to cart
                      </button>
                      {productUrl ? (
                        <a
                          href={productUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-neutral-700 px-4 py-2 text-center text-sm text-neutral-200 transition-colors duration-200 hover:bg-neutral-800"
                        >
                          View product
                        </a>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className="rounded-lg border border-neutral-800 px-4 py-2 text-sm text-neutral-500 disabled:cursor-not-allowed"
                        >
                          Product page unavailable
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </section>

      <footer className="mx-auto max-w-6xl border-t border-neutral-900 px-6 py-6 text-center text-xs text-neutral-500">
        Prototype experience — product availability, pricing and cart
        integration shown for demonstration.
      </footer>
    </main>
  );
}
