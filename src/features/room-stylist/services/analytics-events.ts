import { trackEvent } from "@/lib/analytics";
import type {
  GeneratedConcept,
  ImageProviderId,
  Product,
} from "../types";

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

export function trackQuoteRequested({
  productCount,
  productIds,
  hasPricing,
  packageTotal,
}: {
  productCount: number;
  productIds: string[];
  hasPricing: boolean;
  packageTotal: number | null;
}) {
  trackEvent("quote_requested", {
    productCount,
    productIds,
    hasPricing,
    packageTotal,
  });
}

export function trackRoomSummaryViewed({
  roomType,
  style,
  productCount,
  budgetBasis,
}: {
  roomType: string;
  style: string;
  productCount: number;
  budgetBasis: "prices" | "estimate";
}) {
  trackEvent("room_summary_viewed", {
    roomType,
    style,
    productCount,
    budgetBasis,
  });
}

export function trackRecommendationAdded(product: Product) {
  trackEvent("recommendation_added", {
    productId: product.id,
    productName: product.name,
    category: product.category,
  });
}

export function trackRecommendationRemoved(product: Product) {
  trackEvent("recommendation_removed", {
    productId: product.id,
    productName: product.name,
    category: product.category,
  });
}

export function trackQuoteOpened({
  productCount,
  hasPricing,
}: {
  productCount: number;
  hasPricing: boolean;
}) {
  trackEvent("quote_opened", {
    productCount,
    hasPricing,
  });
}

export function trackQuoteSubmitted({
  productCount,
  recommendationCount,
  hasPricing,
  packageTotal,
}: {
  productCount: number;
  recommendationCount: number;
  hasPricing: boolean;
  packageTotal: number | null;
}) {
  trackEvent("quote_submitted", {
    productCount,
    recommendationCount,
    hasPricing,
    packageTotal,
  });
}

export function trackGeneratedProviderCount(concepts: GeneratedConcept[]) {
  trackEvent("generated_provider_count", {
    providerCount: concepts.length,
    providers: concepts.map((concept) => concept.provider),
  });
}

export function trackResultProviderViewed({
  provider,
  conceptIndex,
  source,
}: {
  provider: ImageProviderId;
  conceptIndex: number;
  source: "generated" | "arrow" | "dot" | "swipe" | "refined";
}) {
  trackEvent("result_provider_viewed", {
    provider,
    conceptIndex,
    source,
  });
}

export function trackResultProviderSwiped({
  fromProvider,
  toProvider,
  fromIndex,
  toIndex,
  surface,
}: {
  fromProvider: ImageProviderId;
  toProvider: ImageProviderId;
  fromIndex: number;
  toIndex: number;
  surface: "result" | "fullscreen";
}) {
  trackEvent("result_provider_swiped", {
    fromProvider,
    toProvider,
    fromIndex,
    toIndex,
    surface,
  });
}

export function trackFullscreenProviderViewed({
  provider,
  conceptIndex,
  source,
}: {
  provider: ImageProviderId;
  conceptIndex: number;
  source: "opened" | "swiped" | "selected";
}) {
  trackEvent("fullscreen_provider_viewed", {
    provider,
    conceptIndex,
    source,
  });
}

export function trackProviderWarning(warning: string) {
  trackEvent("provider_warning", {
    provider: "gemini",
    warning,
  });
}
