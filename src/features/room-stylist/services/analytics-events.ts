import { trackEvent } from "@/lib/analytics";
import type { Product } from "../types";

type GenerateContext = {
  roomType: string;
  style: string;
  selectedProductIds: string[];
  roomMeasurements: {
    roomWidthM: string | null;
    roomLengthM: string | null;
    ceilingHeightM: string | null;
  };
};

export function trackGenerateStarted({
  roomType,
  style,
  selectedProductIds,
  roomMeasurements,
}: GenerateContext) {
  trackEvent("generate_started", {
    roomType,
    style,
    selectedProductIds,
    selectedProductCount: selectedProductIds.length,
    roomMeasurements,
  });
}

export function trackGenerateCompleted({
  roomType,
  style,
  products,
  imageCount,
  roomMeasurements,
}: {
  roomType: string;
  style: string;
  products: Product[];
  imageCount: number;
  roomMeasurements: GenerateContext["roomMeasurements"];
}) {
  trackEvent("generate_completed", {
    roomType,
    style,
    imageCount,
    productCount: products.length,
    productIds: products.map((product) => product.id),
    roomMeasurements,
  });
}

export function trackConceptSelection(isSelected: boolean, conceptIndex: number) {
  trackEvent(isSelected ? "concept_deselected" : "concept_selected", {
    conceptIndex,
  });
}

export function trackRefineStarted({
  conceptIndex,
  changeRequest,
  refinementProductIds,
}: {
  conceptIndex: number;
  changeRequest: string;
  refinementProductIds: string[];
}) {
  trackEvent("refine_started", {
    conceptIndex,
    hasTextInstruction: Boolean(changeRequest.trim()),
    refinementProductIds,
    refinementProductCount: refinementProductIds.length,
  });
}

export function trackRefineCompleted({
  conceptIndex,
  refinedConceptIndex,
  changeRequest,
  refinementProductIds,
  mergedProductCount,
}: {
  conceptIndex: number;
  refinedConceptIndex: number;
  changeRequest: string;
  refinementProductIds: string[];
  mergedProductCount: number;
}) {
  trackEvent("refine_completed", {
    conceptIndex,
    refinedConceptIndex,
    hasTextInstruction: Boolean(changeRequest.trim()),
    refinementProductIds,
    refinementProductCount: refinementProductIds.length,
    mergedProductCount,
  });
}

export function trackDownloadClicked(conceptIndex: number) {
  trackEvent("download_clicked", { conceptIndex });
}

export function trackShareClicked(conceptIndex: number, shareMethod: string) {
  trackEvent("share_clicked", {
    conceptIndex,
    shareMethod,
  });
}

export function trackFavouriteClicked({
  productId,
  productName,
  action,
}: {
  productId: string;
  productName: string;
  action: "added" | "removed";
}) {
  trackEvent("favourite_clicked", {
    productId,
    productName,
    action,
  });
}

export function trackAddToCartClicked(product: Product) {
  trackEvent("add_to_cart_clicked", {
    productId: product.id,
    productName: product.name,
    category: product.category,
  });
}

export function trackBundleAddToCartClicked(products: Product[]) {
  trackEvent("bundle_add_to_cart_clicked", {
    productCount: products.length,
    productIds: products.map((product) => product.id),
  });
}
