"use client";

/* eslint-disable @next/next/no-img-element */

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ProductImage } from "@/features/room-stylist/components/ProductImage";
import { useProgressIndex } from "@/features/room-stylist/hooks/useProgressIndex";
import {
  getRoomPhotoValidationError,
  normalizeRoomPhoto,
  UNSUPPORTED_UPLOAD_ERROR,
} from "@/features/room-stylist/services/image-upload";
import {
  formatMoney,
  getCategoryLabel,
  getHeroDemoProducts,
  getPackagePricing,
  getProductsFromIds,
  getProductUrl,
  getShortProductName,
  mergeUniqueProducts,
  productsByCategory,
  type PackagePricing,
} from "@/features/room-stylist/services/product-helpers";
import {
  trackAddToCartClicked,
  trackBundleAddToCartClicked,
  trackDownloadClicked,
  trackFullscreenProviderViewed,
  trackGenerateCompleted,
  trackGenerateStarted,
  trackGeneratedProviderCount,
  trackQuoteOpened,
  trackQuoteRequested,
  trackQuoteSubmitted,
  trackRecommendationAdded,
  trackRecommendationRemoved,
  trackRefineCompleted,
  trackRefineStarted,
  trackResultProviderSwiped,
  trackResultProviderViewed,
  trackRoomSummaryViewed,
  trackShareClicked,
} from "@/features/room-stylist/services/analytics-events";
import {
  buildRoomSummary,
  estimateFurnishingBudget,
  recommendMissingCategoryProducts,
  type RoomSummary,
} from "@/features/room-stylist/services/room-consultant";
import {
  buildLead,
  getLeads,
  saveLead,
  type LeadContactMethod,
} from "@/features/room-stylist/services/leads";
import {
  computePilotMetrics,
  downloadJson,
  getAnalyticsEvents,
  type PilotMetrics,
} from "@/features/room-stylist/services/pilot-metrics";
import {
  fingerprintRoomImage,
  getAiEvalRecords,
  hashString,
  saveAiEvalRecord,
  type AiEvalRecord,
} from "@/features/room-stylist/services/ai-eval-log";
import { normalizeGeneratedConcepts } from "@/features/room-stylist/services/generated-concepts";
import type {
  GeneratedConcept,
  Product,
} from "@/features/room-stylist/types";
import {
  assertStudioGeminiProvider,
  fetchStudioGemini,
  STUDIO_GEMINI_ROUTE,
} from "./studio-gemini-api";

const CACHE_KEY = "ai-room-stylist:studio:last-result";
const SHARE_MESSAGE =
  "I created a luxury room concept with Koala Design Studio.";
const loadingMessages = [
  "Understanding your room",
  "Finding complementary Koala pieces",
  "Balancing colour palette",
  "Refining layout and lighting",
  "Creating your new space",
];
const refineChips = [
  "Make it brighter",
  "More luxury",
  "Add greenery",
  "Larger sofa",
  "More minimal",
  "Warmer palette",
];
const roomTypes = [
  {
    id: "living room",
    label: "Living room",
    visual:
      "radial-gradient(circle at 18% 18%, rgba(255,255,255,0.16), transparent 30%), radial-gradient(circle at 82% 88%, rgba(255,255,255,0.06), transparent 36%), linear-gradient(135deg, #050505 0%, #111111 58%, #181818 100%)",
  },
  {
    id: "dining room",
    label: "Dining room",
    visual:
      "radial-gradient(circle at 78% 20%, rgba(255,255,255,0.14), transparent 30%), radial-gradient(circle at 20% 84%, rgba(255,255,255,0.05), transparent 34%), linear-gradient(135deg, #050505 0%, #111111 54%, #181818 100%)",
  },
  {
    id: "bedroom",
    label: "Bedroom",
    visual:
      "radial-gradient(circle at 32% 24%, rgba(255,255,255,0.13), transparent 34%), radial-gradient(circle at 74% 80%, rgba(255,255,255,0.05), transparent 34%), linear-gradient(135deg, #111111 0%, #050505 58%, #181818 100%)",
  },
  {
    id: "office",
    label: "Office",
    visual:
      "radial-gradient(circle at 72% 24%, rgba(255,255,255,0.12), transparent 30%), radial-gradient(circle at 18% 78%, rgba(255,255,255,0.05), transparent 34%), linear-gradient(135deg, #050505 0%, #111111 56%, #181818 100%)",
  },
];
const designStyles = [
  {
    id: "Modern Luxury",
    title: "Modern Luxury",
    description: "Polished contrast, sculptural silhouettes and warm metallic detail.",
    visual:
      "radial-gradient(circle at 76% 18%, rgba(255,255,255,0.16), transparent 26%), radial-gradient(circle at 22% 88%, rgba(255,255,255,0.05), transparent 34%), linear-gradient(135deg, #050505 0%, #111111 48%, #181818 100%)",
  },
  {
    id: "Contemporary",
    title: "Contemporary",
    description: "Clean furniture lines with soft texture and gallery-like balance.",
    visual:
      "radial-gradient(circle at 74% 24%, rgba(255,255,255,0.11), transparent 28%), linear-gradient(135deg, #050505 0%, #111111 56%, #181818 100%)",
  },
  {
    id: "Minimal",
    title: "Minimal",
    description: "Reduced palette, open floor flow and calm visual rhythm.",
    visual:
      "radial-gradient(circle at 20% 18%, rgba(255,255,255,0.18), transparent 26%), linear-gradient(135deg, #181818 0%, #111111 52%, #050505 100%)",
  },
  {
    id: "Organic Modern",
    title: "Organic Modern",
    description: "Natural materials, curved forms and relaxed layered warmth.",
    visual:
      "radial-gradient(circle at 28% 22%, rgba(255,255,255,0.12), transparent 28%), radial-gradient(circle at 86% 86%, rgba(156,156,148,0.12), transparent 34%), linear-gradient(135deg, #050505 0%, #111111 52%, #181818 100%)",
  },
  {
    id: "Warm Neutral",
    title: "Warm Neutral",
    description: "Soft taupe, timber tones and inviting full-room comfort.",
    visual:
      "radial-gradient(circle at 70% 18%, rgba(255,255,255,0.14), transparent 28%), linear-gradient(135deg, #050505 0%, #111111 50%, #181818 100%)",
  },
  {
    id: "Custom",
    title: "Custom",
    description: "Describe the exact mood, colours and layout direction.",
    visual:
      "radial-gradient(circle at 78% 22%, rgba(255,255,255,0.12), transparent 30%), radial-gradient(circle at 16% 82%, rgba(255,255,255,0.05), transparent 34%), linear-gradient(135deg, #050505 0%, #111111 56%, #181818 100%)",
  },
];
function getStylePrompt(style: string, customPrompt: string) {
  return style === "Custom" ? customPrompt.trim() : style.toLowerCase();
}

// Optional light haptic on supported mobile devices. No-op elsewhere.
function triggerHaptic() {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate === "function") navigator.vibrate(8);
}

// Curated demo products with verified real price + product URL.
const heroDemoProducts = getHeroDemoProducts();

// AI-suggested defaults so the customer can proceed without choosing.
const DEFAULT_ROOM_TYPE = "living room";
const DEFAULT_STYLE = "Modern Luxury";

type QuoteFormState = {
  name: string;
  email: string;
  phone: string;
  postcode: string;
  preferredContact: LeadContactMethod;
  notes: string;
};

const EMPTY_QUOTE_FORM: QuoteFormState = {
  name: "",
  email: "",
  phone: "",
  postcode: "",
  preferredContact: "either",
  notes: "",
};

const studioRoomMeasurementPayload: {
  roomWidthM: string | null;
  roomLengthM: string | null;
  ceilingHeightM: string | null;
} = {
  roomWidthM: null,
  roomLengthM: null,
  ceilingHeightM: null,
};

function selectedIdsToProducts(productIds: string[]) {
  return getProductsFromIds(productIds);
}

function normalizeStudioGeminiConcepts(
  values: unknown,
  fallbackImageBase64?: unknown
) {
  const concepts = normalizeGeneratedConcepts(values, fallbackImageBase64);

  concepts.forEach((concept) => {
    assertStudioGeminiProvider(concept.provider);
  });

  return concepts.map((concept) => ({
    ...concept,
    provider: "gemini",
    label: "Gemini",
  }));
}

function getImageFileExtension(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";

  return "png";
}

function conceptToFile(concept: GeneratedConcept, index: number) {
  const binary = window.atob(concept.imageBase64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const extension = getImageFileExtension(concept.mimeType);

  return new File(
    [bytes],
    `koala-design-studio-${concept.provider}-${index + 1}.${extension}`,
    { type: concept.mimeType }
  );
}

function SuggestionRow({
  label,
  value,
  open,
  onToggle,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="v2-surface-flat mt-3 flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-[0.16em] text-[#9a978f]">
          {label}
        </p>
        <p className="mt-0.5 truncate font-serif text-lg text-[#F5F3EE]">
          {value}
        </p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="shrink-0 rounded-full border border-white/12 px-3.5 py-1.5 text-xs font-medium text-[#F5F3EE] transition hover:bg-white/5"
      >
        {open ? "Done" : "Change"}
      </button>
    </div>
  );
}

function SelectChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-4 py-2 text-xs font-semibold transition ${
        active
          ? "border-[#C9A57A]/50 bg-[#C9A57A]/12 text-[#C9A57A]"
          : "border-white/10 bg-white/[0.03] text-[#9a978f] hover:border-white/25"
      }`}
    >
      {children}
    </button>
  );
}

function StudioButton({
  children,
  onClick,
  disabled,
  variant = "primary",
  className: extraClassName = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  const variantClassName =
    variant === "primary"
      ? "bg-[#F7F7F2] text-[#050505] shadow-lg shadow-white/10 hover:bg-white"
      : variant === "secondary"
        ? "border border-[rgba(255,255,255,0.12)] bg-[#111111] text-[#F7F7F2] hover:border-white/25 hover:bg-[#181818]"
        : "border border-[rgba(255,255,255,0.12)] bg-transparent text-[#F7F7F2] hover:border-white/25 hover:bg-[#111111]";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-12 rounded-xl px-5 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${variantClassName} ${extraClassName}`}
    >
      {children}
    </button>
  );
}

function StudioProductCard({
  product,
  selected,
  onToggle,
}: {
  product: Product;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.currentTarget.blur();
        triggerHaptic();
        onToggle();
      }}
      className={`relative flex h-[220px] min-w-0 flex-col overflow-hidden rounded-2xl border bg-[#111111] p-2.5 text-left transition-all duration-200 ease-out active:scale-[0.985] ${
        selected
          ? "border-[#C9A57A]/70 bg-[#161514]"
          : "border-[rgba(255,255,255,0.12)] hover:border-white/25"
      }`}
    >
      <div className="relative">
        <ProductImage
          product={product}
          className="h-28 w-full rounded-xl object-cover"
          placeholderClassName="h-28 w-full rounded-xl"
        />
        {selected && (
          <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#C9A57A] text-[#050505] shadow-lg">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5">
              <path
                d="m5 12 4.5 4.5L19 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col pt-2">
        <p className="line-clamp-2 min-h-9 break-words text-xs font-semibold leading-snug text-[#F7F7F2]">
          {getShortProductName(product)}
        </p>
        <p className="mt-1 truncate text-[11px] uppercase tracking-[0.14em] text-[#9C9C94]">
          {getCategoryLabel(product.category)}
        </p>
      </div>
    </button>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        d="m7 7 10 10M17 7 7 17"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.9"
      />
    </svg>
  );
}

function AiEditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        d="M5 19h4L18.5 9.5a2.1 2.1 0 0 0-3-3L6 16v3zM14 8l2 2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M6.5 4.5 7.4 6.6 9.5 7.5 7.4 8.4l-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1zM18 15l.55 1.25L20 16.8l-1.45.55L18 18.6l-.55-1.25L16 16.8l1.45-.55L18 15z"
        fill="currentColor"
      />
    </svg>
  );
}

function RegenerateIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        d="M17.5 8.5A6.5 6.5 0 0 0 6 6.5L4.5 8M6.5 15.5A6.5 6.5 0 0 0 18 17.5l1.5-1.5M4.5 4.5V8H8M19.5 19.5V16H16"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        d={direction === "left" ? "m14.5 6-6 6 6 6" : "m9.5 6 6 6-6 6"}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v3h14v-3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        d="M16 8 12 4 8 8m4-4v12M5 13v6h14v-6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        d="M6 7h12M10 7V5h4v2m-6 3 .7 9h6.6l.7-9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function SelectedProductsSheet({
  products,
  onClose,
  onRemove,
}: {
  products: Product[];
  onClose: () => void;
  onRemove: (productId: string) => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Selected Koala products"
      className="fixed inset-0 z-50 flex items-end bg-black/70 px-6 pb-[calc(env(safe-area-inset-bottom)_+_24px)]"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close selected products"
        className="absolute inset-0"
      />
      <section className="relative z-10 max-h-[82vh] w-full overflow-y-auto overflow-x-hidden rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#111111] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-[#9C9C94]">
              Selected products
            </p>
            <h2 className="mt-1 text-lg font-semibold">
              {products.length} selected
            </h2>
          </div>
          <StudioButton variant="ghost" onClick={onClose}>
            Done
          </StudioButton>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {products.map((product) => (
            <article
              key={product.id}
              className="relative h-[184px] rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[#111111] p-2.5"
            >
              <ProductImage
                product={product}
                className="h-28 w-full rounded-xl object-cover"
                placeholderClassName="h-28 w-full rounded-xl"
              />
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation();
                  event.currentTarget.blur();
                  onRemove(product.id);
                }}
                aria-label={`Remove ${getShortProductName(product)}`}
                className="absolute right-4 top-4 rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#050505]/90 px-2 py-0.5 text-xs text-[#F7F7F2]"
              >
                X
              </button>
              <p className="mt-2 line-clamp-2 text-xs font-semibold leading-snug">
                {getShortProductName(product)}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ImageViewerModal({
  concept,
  onClose,
}: {
  concept: GeneratedConcept;
  onClose: () => void;
}) {
  const generatedImageUrl = `data:${concept.mimeType};base64,${concept.imageBase64}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Generated design preview"
      className="fixed inset-0 z-50 overflow-hidden bg-[#050505] text-[#F7F7F2]"
    >
      <div className="mx-auto flex h-full w-full max-w-[430px] overflow-hidden bg-[#050505]">
        <div
          className="relative min-h-0 flex-1 overflow-hidden bg-[#050505]"
          style={{ touchAction: "pinch-zoom" }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close fullscreen preview"
            className="absolute left-4 top-[calc(env(safe-area-inset-top)_+_16px)] z-30 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-[#050505]/75 text-[#F7F7F2] shadow-2xl backdrop-blur transition hover:bg-[#111111]"
          >
            <CloseIcon />
          </button>

          <img
            src={generatedImageUrl}
            alt={`${concept.label} generated room design`}
            className="h-full w-full object-contain object-center"
          />
        </div>
      </div>
    </div>
  );
}

function PackageSummary({ pricing }: { pricing: PackagePricing }) {
  // No priced items — never fabricate a total.
  if (!pricing.hasAnyPrice) {
    return (
      <div className="mt-4 rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[#0B0B0B] p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-[#9C9C94]">Package total</span>
          <span className="text-right text-sm font-semibold text-[#F7F7F2]">
            Pricing available on product pages
          </span>
        </div>
      </div>
    );
  }

  const totalLabel = pricing.hasAllPrices ? "Package total" : "Priced so far";

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-[#C9A57A]/25 bg-gradient-to-b from-[#141210] to-[#0B0B0B]">
      <div className="p-4">
        <p className="text-[11px] uppercase tracking-[0.2em] text-[#C9A57A]">
          Your room package
        </p>

        <div className="mt-3 flex items-center justify-between gap-3 text-sm text-[#9C9C94]">
          <span>Subtotal</span>
          <span>{formatMoney(pricing.subtotal)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-sm text-[#C9A57A]">
          <span>Package saving ({Math.round(pricing.savingRate * 100)}%)</span>
          <span>-{formatMoney(pricing.saving)}</span>
        </div>

        <div className="mt-3 flex items-end justify-between gap-3 border-t border-white/10 pt-3">
          <span className="pb-1 text-sm font-semibold text-[#F7F7F2]">
            {totalLabel}
          </span>
          <span className="font-serif text-3xl leading-none text-[#F7F7F2]">
            {formatMoney(pricing.total)}
          </span>
        </div>
      </div>

      <div className="border-t border-white/10 px-4 py-2.5">
        {pricing.hasAllPrices ? (
          <p className="text-[11px] text-[#9C9C94]">
            Illustrative package saving. Final pricing confirmed on quote.
          </p>
        ) : (
          <p className="text-[11px] text-[#9C9C94]">
            Some pricing available on product pages · {pricing.pricedItems} of{" "}
            {pricing.totalItems} items priced.
          </p>
        )}
      </div>
    </div>
  );
}

function ShoppingSummaryCard({
  productCount,
  pricing,
  onAddToCart,
}: {
  productCount: number;
  pricing: PackagePricing;
  onAddToCart: () => void;
}) {
  return (
    <div className="v2-surface overflow-hidden rounded-[26px]">
      <div className="p-5">
        <p className="text-[11px] uppercase tracking-[0.2em] text-[#C9A57A]">
          Your room package
        </p>
        <h2 className="mt-1 font-serif text-2xl leading-tight text-[#F5F3EE]">
          Designed with {productCount} Koala{" "}
          {productCount === 1 ? "piece" : "pieces"}
        </h2>

        {pricing.hasAnyPrice ? (
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm text-[#9a978f]">
              <span>Subtotal</span>
              <span>{formatMoney(pricing.subtotal)}</span>
            </div>
            {pricing.saving > 0 && (
              <div className="mt-2 flex items-center justify-between text-sm text-[#C9A57A]">
                <span>
                  Package saving ({Math.round(pricing.savingRate * 100)}%)
                </span>
                <span>-{formatMoney(pricing.saving)}</span>
              </div>
            )}
            <div className="mt-3 flex items-end justify-between border-t border-white/10 pt-3">
              <span className="pb-1 text-sm font-semibold text-[#F5F3EE]">
                {pricing.hasAllPrices ? "Package total" : "Priced so far"}
              </span>
              <span className="font-serif text-3xl leading-none text-[#F5F3EE]">
                {formatMoney(pricing.total)}
              </span>
            </div>
            {!pricing.hasAllPrices && (
              <p className="mt-2 text-[11px] text-[#9a978f]">
                Some pricing available on product pages · {pricing.pricedItems}{" "}
                of {pricing.totalItems} items priced.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-[#9a978f]">
            Pricing is shown on each product page.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onAddToCart}
        className="w-full border-t border-white/10 bg-[#F5F3EE] py-4 text-base font-semibold text-[#0b0b0d] transition active:scale-[0.99]"
      >
        Add room package to cart
      </button>
    </div>
  );
}

function ShopProductCard({
  product,
  action,
}: {
  product: Product;
  action?: React.ReactNode;
}) {
  const productUrl = getProductUrl(product);

  return (
    <article className="v2-surface overflow-hidden rounded-2xl">
      <div className="relative aspect-square bg-[#0B0B0B]">
        <ProductImage
          product={product}
          className="h-full w-full object-cover"
          placeholderClassName="h-full w-full"
        />
      </div>
      <div className="p-3">
        <p className="line-clamp-2 min-h-9 text-xs font-semibold leading-snug text-[#F5F3EE]">
          {getShortProductName(product)}
        </p>
        <p className="mt-1 text-sm text-[#C9A57A]">
          {typeof product.price === "number"
            ? formatMoney(product.price)
            : "On product page"}
        </p>
        <div className="mt-2.5">
          {action ??
            (productUrl ? (
              <a
                href={productUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => trackAddToCartClicked(product)}
                className="block rounded-xl bg-[#F5F3EE] px-3 py-1.5 text-center text-xs font-semibold text-[#0b0b0d]"
              >
                View on Koala
              </a>
            ) : (
              <span className="block rounded-xl border border-white/10 px-3 py-1.5 text-center text-xs text-[#9a978f]">
                Available in store
              </span>
            ))}
        </div>
      </div>
    </article>
  );
}

function StudioTextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "email" | "tel";
  autoComplete?: string;
}) {
  return (
    <label className="block text-xs text-[#9C9C94]">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="mt-2 w-full rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#0B0B0B] p-3 text-sm text-[#F7F7F2] outline-none focus:border-[#C9A57A]"
      />
    </label>
  );
}

function QuoteLineItem({ product }: { product: Product }) {
  const priceLabel =
    typeof product.price === "number"
      ? formatMoney(product.price)
      : "On product page";

  return (
    <div className="flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#0B0B0B] px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm text-[#F7F7F2]">
        {getShortProductName(product)}
      </span>
      <span className="shrink-0 whitespace-nowrap text-xs text-[#9C9C94]">
        {priceLabel}
      </span>
    </div>
  );
}

function QuoteSheet({
  imageDataUrl,
  products,
  recommendations,
  pricing,
  summary,
  form,
  onField,
  onSubmit,
  onClose,
}: {
  imageDataUrl: string;
  products: Product[];
  recommendations: Product[];
  pricing: PackagePricing;
  summary: RoomSummary | null;
  form: QuoteFormState;
  onField: (field: keyof QuoteFormState, value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const canSubmit = form.name.trim().length > 0 && emailValid;
  const contactOptions: { id: LeadContactMethod; label: string }[] = [
    { id: "email", label: "Email" },
    { id: "phone", label: "Phone" },
    { id: "either", label: "Either" },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Request a quote"
      className="fixed inset-0 z-[65] flex items-end bg-black/70 px-6 pb-[calc(env(safe-area-inset-bottom)_+_24px)]"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close quote request"
        className="absolute inset-0"
      />
      <section className="relative z-10 max-h-[88vh] w-full overflow-y-auto overflow-x-hidden rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#111111] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-[#9C9C94]">
              Save your design
            </p>
            <h2 className="mt-1 font-serif text-2xl">Your Room Package</h2>
          </div>
          <StudioButton variant="ghost" onClick={onClose}>
            Close
          </StudioButton>
        </div>

        {imageDataUrl && (
          <div className="overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[#050505]">
            <img
              src={imageDataUrl}
              alt="Your generated room concept"
              className="max-h-48 w-full object-cover"
            />
          </div>
        )}

        {summary && (
          <p className="mt-4 text-sm text-[#9C9C94]">
            {summary.roomTypeLabel} · {summary.styleLabel} · {summary.mood}
          </p>
        )}

        {products.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#9C9C94]">
              In your room
            </p>
            <div className="mt-2 grid gap-2">
              {products.map((product) => (
                <QuoteLineItem key={product.id} product={product} />
              ))}
            </div>
          </div>
        )}

        {recommendations.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#9C9C94]">
              Recommended additions
            </p>
            <div className="mt-2 grid gap-2">
              {recommendations.map((product) => (
                <QuoteLineItem key={product.id} product={product} />
              ))}
            </div>
          </div>
        )}

        <PackageSummary pricing={pricing} />

        <div className="mt-4 grid gap-3">
          <StudioTextField
            label="Full name"
            value={form.name}
            onChange={(value) => onField("name", value)}
            placeholder="Your name"
            autoComplete="name"
          />
          <StudioTextField
            label="Email"
            value={form.email}
            onChange={(value) => onField("email", value)}
            placeholder="you@email.com"
            type="email"
            autoComplete="email"
          />
          <div className="grid grid-cols-2 gap-3">
            <StudioTextField
              label="Phone (optional)"
              value={form.phone}
              onChange={(value) => onField("phone", value)}
              placeholder="Mobile number"
              type="tel"
              autoComplete="tel"
            />
            <StudioTextField
              label="Postcode (optional)"
              value={form.postcode}
              onChange={(value) => onField("postcode", value)}
              placeholder="e.g. 2000"
              autoComplete="postal-code"
            />
          </div>

          <div>
            <p className="text-xs text-[#9C9C94]">Preferred contact</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {contactOptions.map((option) => {
                const active = form.preferredContact === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => onField("preferredContact", option.id)}
                    aria-pressed={active}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                      active
                        ? "border-[#C9A57A]/55 bg-[#181818] text-[#F7F7F2]"
                        : "border-[rgba(255,255,255,0.12)] bg-[#0B0B0B] text-[#9C9C94] hover:border-white/25"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block text-xs text-[#9C9C94]">
            Notes (optional)
            <textarea
              value={form.notes}
              onChange={(event) => onField("notes", event.target.value)}
              placeholder="Anything else we should know — timing, budget, questions..."
              className="mt-2 min-h-20 w-full rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#0B0B0B] p-3 text-sm text-[#F7F7F2] outline-none focus:border-[#C9A57A]"
            />
          </label>
        </div>

        <StudioButton
          onClick={onSubmit}
          disabled={!canSubmit}
          className="mt-5 min-h-12 w-full rounded-2xl text-base"
        >
          Send this room package to our team
        </StudioButton>
        <p className="mt-2 text-center text-[11px] leading-5 text-[#9C9C94]">
          A consultant can help confirm availability, pricing and next steps.
        </p>
      </section>
    </div>
  );
}

function AdminMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[#0B0B0B] p-4">
      <p className="text-[11px] uppercase tracking-[0.14em] text-[#9C9C94]">
        {label}
      </p>
      <p className="mt-1 font-serif text-2xl text-[#F7F7F2]">{value}</p>
    </div>
  );
}

function AiEvalCard({ record }: { record: AiEvalRecord }) {
  const score = record.qualityScore;
  return (
    <div className="rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[#0B0B0B] p-3">
      <div className="flex items-start gap-3">
        {record.roomThumbnail ? (
          <img
            src={record.roomThumbnail}
            alt="Room"
            className="h-14 w-14 shrink-0 rounded-lg object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#F7F7F2]">
            {record.roomType} · {record.style}
          </p>
          <p className="text-[11px] text-[#9C9C94]">
            {new Date(record.timestamp).toLocaleString()} ·{" "}
            {record.provider || "—"} · {record.generationAttempts} attempt
            {record.generationAttempts === 1 ? "" : "s"}
            {record.autoRegenerated ? " · regenerated" : ""}
          </p>
        </div>
        {score ? (
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
              score.overall >= 70
                ? "bg-[#C9A57A]/15 text-[#C9A57A]"
                : "bg-red-400/15 text-red-300"
            }`}
          >
            {score.overall}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-[#9C9C94]">no score</span>
        )}
      </div>

      {score && (
        <div className="mt-2 grid grid-cols-5 gap-1 text-center">
          {[
            { k: "Room", v: score.roomPreservation },
            { k: "Prod", v: score.productSimilarity },
            { k: "Full", v: score.fullRoomVisible },
            { k: "Scale", v: score.furnitureScale },
            { k: "Real", v: score.realism },
          ].map((axis) => (
            <div key={axis.k} className="rounded-md bg-white/[0.03] py-1">
              <p className="text-[9px] uppercase tracking-wide text-[#9C9C94]">
                {axis.k}
              </p>
              <p className="text-xs font-semibold text-[#F7F7F2]">{axis.v}</p>
            </div>
          ))}
        </div>
      )}

      {record.selectedProducts.length > 0 && (
        <p className="mt-2 line-clamp-1 text-[11px] text-[#9C9C94]">
          Products: {record.selectedProducts.map((p) => p.name).join(", ")}
        </p>
      )}

      {record.roomAnalysis && (
        <p className="mt-1 text-[11px] text-[#9C9C94]">
          Analysis {record.roomAnalysis.analysed ? "✓" : "(fallback)"} ·{" "}
          {record.roomAnalysis.lighting}
          {record.roomAnalysis.colourPalette.length > 0
            ? ` · ${record.roomAnalysis.colourPalette.join(", ")}`
            : ""}
        </p>
      )}

      {record.failureReason && (
        <p className="mt-1 text-[11px] text-red-300">
          Failure: {record.failureReason}
        </p>
      )}

      {record.prompt && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-[#C9A57A]">
            Prompt preview
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-2 text-[10px] leading-4 text-[#9C9C94]">
            {record.prompt}
          </pre>
        </details>
      )}
    </div>
  );
}

function AdminPanel({
  metrics,
  leadCount,
  aiDebugEnabled,
  aiEvalRecords,
  onRefresh,
  onExportAnalytics,
  onExportLeads,
  onExportEvals,
  onClose,
}: {
  metrics: PilotMetrics | null;
  leadCount: number;
  aiDebugEnabled: boolean;
  aiEvalRecords: AiEvalRecord[];
  onRefresh: () => void;
  onExportAnalytics: () => void;
  onExportLeads: () => void;
  onExportEvals: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pilot admin panel"
      className="fixed inset-0 z-[80] overflow-y-auto bg-[#050505]/95 px-6 py-8 backdrop-blur"
    >
      <div className="mx-auto w-full max-w-[430px]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-[#C9A57A]">
              Pilot admin
            </p>
            <h2 className="mt-1 font-serif text-2xl text-[#F7F7F2]">
              Metrics &amp; export
            </h2>
          </div>
          <StudioButton variant="ghost" onClick={onClose}>
            Close
          </StudioButton>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <AdminMetric label="Generations" value={metrics?.generations ?? 0} />
          <AdminMetric label="Quote submits" value={metrics?.quoteSubmissions ?? 0} />
          <AdminMetric label="Package opens" value={metrics?.quoteOpens ?? 0} />
          <AdminMetric label="Leads stored" value={leadCount} />
          <AdminMetric label="Recs added" value={metrics?.recommendationsAdded ?? 0} />
          <AdminMetric label="Recs removed" value={metrics?.recommendationsRemoved ?? 0} />
        </div>

        <div className="mt-4 rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[#0B0B0B] p-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-[#9C9C94]">
            Most selected products
          </p>
          {metrics && metrics.topProducts.length > 0 ? (
            <ul className="mt-3 grid gap-2">
              {metrics.topProducts.map((product) => (
                <li
                  key={product.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate text-[#F7F7F2]">
                    {product.name}
                  </span>
                  <span className="shrink-0 text-[#C9A57A]">
                    {product.count}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-[#9C9C94]">
              No product selections recorded yet.
            </p>
          )}
        </div>

        <p className="mt-4 text-[11px] text-[#9C9C94]">
          {metrics?.totalEvents ?? 0} analytics events recorded locally.
        </p>

        <div className="mt-3 grid gap-2">
          <StudioButton onClick={onExportLeads} className="w-full rounded-xl">
            Export leads JSON
          </StudioButton>
          <StudioButton
            variant="secondary"
            onClick={onExportAnalytics}
            className="w-full rounded-xl"
          >
            Export analytics JSON
          </StudioButton>
          <StudioButton
            variant="ghost"
            onClick={onRefresh}
            className="w-full rounded-xl"
          >
            Refresh
          </StudioButton>
        </div>

        {aiDebugEnabled && (
          <div className="mt-8">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-[#C9A57A]">
                  AI debug
                </p>
                <h3 className="mt-1 font-serif text-xl text-[#F7F7F2]">
                  Generation evaluations
                </h3>
              </div>
              <span className="text-[11px] text-[#9C9C94]">
                latest {aiEvalRecords.length}
              </span>
            </div>

            {aiEvalRecords.length > 0 ? (
              <>
                <div className="mt-3 grid gap-3">
                  {aiEvalRecords.map((record) => (
                    <AiEvalCard key={record.timestamp} record={record} />
                  ))}
                </div>
                <StudioButton
                  onClick={onExportEvals}
                  className="mt-3 w-full rounded-xl"
                >
                  Export AI evaluations JSON
                </StudioButton>
              </>
            ) : (
              <p className="mt-2 text-sm text-[#9C9C94]">
                No generations recorded yet. Generate a room to capture room
                analysis, prompt and quality scores here.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RefineSheet({
  selectedProductIds,
  openCategoryId,
  changeRequest,
  refining,
  onChangeRequest,
  onToggleCategory,
  onToggleProduct,
  onClose,
  onRefine,
}: {
  selectedProductIds: string[];
  openCategoryId: string | null;
  changeRequest: string;
  refining: boolean;
  onChangeRequest: (value: string) => void;
  onToggleCategory: (categoryId: string) => void;
  onToggleProduct: (productId: string) => void;
  onClose: () => void;
  onRefine: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit with AI"
      className="fixed inset-0 z-50 flex items-end bg-black/75 px-6 pb-[calc(env(safe-area-inset-bottom)_+_24px)]"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close AI editor"
        className="absolute inset-0"
      />
      <section className="relative z-10 max-h-[88vh] w-full overflow-y-auto overflow-x-hidden rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#111111] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-[#9C9C94]">
              Edit with AI
            </p>
            <h2 className="mt-1 text-xl font-semibold">Refine this concept</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[rgba(255,255,255,0.12)] px-3 py-1 text-sm text-[#F7F7F2]"
          >
            Close
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {refineChips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() =>
                onChangeRequest(
                  changeRequest.trim()
                    ? `${changeRequest.trim()}\n${chip}`
                    : chip
                )
              }
              className="rounded-xl border border-[rgba(255,255,255,0.12)] px-3 py-1.5 text-xs text-[#F7F7F2]"
            >
              {chip}
            </button>
          ))}
        </div>

        <textarea
          value={changeRequest}
          onChange={(event) => onChangeRequest(event.target.value)}
          placeholder="Tell the studio what to adjust..."
          className="mt-4 min-h-28 w-full rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#111111] p-4 text-sm text-[#F7F7F2] outline-none focus:border-[#C9A57A]"
        />

        <div className="mt-5 rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#050505]/40 p-5">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-semibold">Extra products</p>
            <span className="rounded-xl border border-[rgba(255,255,255,0.12)] px-3 py-1 text-xs text-[#F7F7F2]">
              {selectedProductIds.length}
            </span>
          </div>

          <div className="mt-4 grid gap-4">
            {productsByCategory.map((category) => {
              const isOpen = openCategoryId === category.id;

              return (
                <section
                  key={category.id}
                  className="overflow-hidden rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#111111]"
                >
                  <button
                    type="button"
                    onClick={() => onToggleCategory(category.id)}
                    className="flex w-full items-center justify-between p-4 text-left"
                  >
                    <span className="text-xs font-semibold uppercase tracking-widest text-[#9C9C94]">
                      {category.label}
                    </span>
                    <span className="text-xs text-[#9C9C94]">
                      {isOpen ? "-" : "+"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="grid grid-cols-2 gap-3 px-3 pb-3">
                      {category.products.slice(0, 8).map((product) => (
                        <StudioProductCard
                          key={product.id}
                          product={product}
                          selected={selectedProductIds.includes(product.id)}
                          onToggle={() => onToggleProduct(product.id)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>

        <div className="sticky bottom-0 mt-4 bg-[#111111] pt-4">
          <StudioButton
            onClick={onRefine}
            disabled={
              refining ||
              (!changeRequest.trim() && selectedProductIds.length === 0)
            }
          >
            {refining ? "Refining..." : "Apply edit"}
          </StudioButton>
        </div>
      </section>
    </div>
  );
}

export function KoalaDesignStudio() {
  const [step, setStep] = useState(1);
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  // Suggested defaults — the user proceeds without choosing unless AI is wrong.
  const [roomType, setRoomType] = useState(DEFAULT_ROOM_TYPE);
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [customPrompt, setCustomPrompt] = useState("");
  const [roomPickerOpen, setRoomPickerOpen] = useState(false);
  const [stylePickerOpen, setStylePickerOpen] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [letAiRecommendBundle, setLetAiRecommendBundle] = useState(true);
  const [generatedConcepts, setGeneratedConcepts] = useState<
    GeneratedConcept[]
  >([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedConceptIndex, setSelectedConceptIndex] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refining, setRefining] = useState(false);
  const [selectedSheetOpen, setSelectedSheetOpen] = useState(false);
  const [refineSheetOpen, setRefineSheetOpen] = useState(false);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [changeRequest, setChangeRequest] = useState("");
  const [selectedRefinementProductIds, setSelectedRefinementProductIds] =
    useState<string[]>([]);
  const [openRefinementCategoryId, setOpenRefinementCategoryId] = useState<
    string | null
  >(null);
  const [quoteSheetOpen, setQuoteSheetOpen] = useState(false);
  const [quoteForm, setQuoteForm] = useState<QuoteFormState>(EMPTY_QUOTE_FORM);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminMetrics, setAdminMetrics] = useState<PilotMetrics | null>(null);
  const [adminLeadCount, setAdminLeadCount] = useState(0);
  const [aiDebugEnabled, setAiDebugEnabled] = useState(false);
  const [aiEvalRecords, setAiEvalRecords] = useState<AiEvalRecord[]>([]);
  const [addedRecommendationIds, setAddedRecommendationIds] = useState<
    string[]
  >([]);
  const [toastMessage, setToastMessage] = useState("");
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const resultSwipeStartXRef = useRef<number | null>(null);
  const suppressResultViewerOpenRef = useRef(false);
  const toastTimeoutRef = useRef<number | null>(null);
  const summaryViewedRef = useRef(false);
  const [loadingIndex, resetLoadingIndex] = useProgressIndex(
    loading || refining,
    loadingMessages.length,
    2600
  );
  const selectedProducts = selectedIdsToProducts(selectedProductIds);
  const activeConcept = generatedConcepts[selectedConceptIndex] || null;
  const activeImage = activeConcept?.imageBase64 || "";
  const activeImageDataUrl = activeConcept
    ? `data:${activeConcept.mimeType || "image/png"};base64,${activeConcept.imageBase64}`
    : "";
  const selectedStylePrompt = getStylePrompt(style, customPrompt);

  // Consultant layer — deterministic, derived from the current room + package.
  const recommendations = recommendMissingCategoryProducts(
    products,
    roomType,
    selectedStylePrompt
  );
  const addedRecommendations = getProductsFromIds(addedRecommendationIds).filter(
    (product) => !products.some((existing) => existing.id === product.id)
  );
  const packageProducts = mergeUniqueProducts(products, addedRecommendations);
  const packagePricing = getPackagePricing(packageProducts);
  const roomSummary =
    products.length > 0
      ? buildRoomSummary(packageProducts, roomType, selectedStylePrompt)
      : null;

  function showToast(message: string) {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }

    setToastMessage(message);
    toastTimeoutRef.current = window.setTimeout(() => {
      setToastMessage("");
    }, 3200);
  }

  function addRecommendation(product: Product) {
    setAddedRecommendationIds((current) =>
      current.includes(product.id) ? current : [...current, product.id]
    );
    trackRecommendationAdded(product);
    showToast(`${getShortProductName(product)} added to your package.`);
  }

  function removeRecommendation(product: Product) {
    setAddedRecommendationIds((current) =>
      current.filter((id) => id !== product.id)
    );
    trackRecommendationRemoved(product);
  }

  function openQuoteSheet() {
    trackBundleAddToCartClicked(packageProducts);
    trackQuoteOpened({
      productCount: packageProducts.length,
      hasPricing: packagePricing.hasAllPrices,
    });
    setQuoteSheetOpen(true);
  }

  function submitQuoteRequest() {
    const packageTotal = packagePricing.hasAllPrices
      ? packagePricing.total
      : null;

    // Persist the lead locally for the pilot (no CRM connected yet).
    saveLead(
      buildLead({
        form: quoteForm,
        roomType,
        style: selectedStylePrompt,
        selectedProducts: products,
        recommendedAdditions: addedRecommendations,
        pricing: packagePricing,
        imageProvider: activeConcept?.provider ?? null,
        imageBase64: activeImage || null,
      })
    );

    // quote_requested retained from Sprint 1 for continuity; quote_submitted
    // is the canonical Sprint 2 event.
    trackQuoteRequested({
      productCount: packageProducts.length,
      productIds: packageProducts.map((product) => product.id),
      hasPricing: packagePricing.hasAllPrices,
      packageTotal,
    });
    trackQuoteSubmitted({
      productCount: products.length,
      recommendationCount: addedRecommendations.length,
      hasPricing: packagePricing.hasAllPrices,
      packageTotal,
    });
    setQuoteSheetOpen(false);
    setQuoteForm(EMPTY_QUOTE_FORM);
    showToast("Quote request sent — our design team will be in touch shortly.");
  }

  function refreshAdminData() {
    setAdminMetrics(computePilotMetrics());
    setAdminLeadCount(getLeads().length);
    setAiEvalRecords(getAiEvalRecords());
  }

  // Record a dev-only AI evaluation entry for each generation (only when AI
  // debug is enabled). Never sent externally.
  async function logAiEvaluation(
    aiDebug: Record<string, unknown> | undefined,
    imageBase64: string | null,
    failureReason: string | null
  ) {
    if (!aiDebugEnabled) return;

    const fingerprint = await fingerprintRoomImage(image);
    const record: AiEvalRecord = {
      timestamp: new Date().toISOString(),
      roomType,
      style: selectedStylePrompt,
      roomHash: fingerprint.hash,
      roomThumbnail: fingerprint.thumbnail,
      selectedProducts: selectedProducts.map((product) => ({
        id: product.id,
        name: product.name,
        category: product.category,
      })),
      provider: (aiDebug?.provider as string) ?? null,
      sceneGraph: (aiDebug?.sceneGraph as AiEvalRecord["sceneGraph"]) ?? null,
      roomAnalysis:
        (aiDebug?.roomAnalysis as AiEvalRecord["roomAnalysis"]) ?? null,
      replacementPlan:
        (aiDebug?.replacementPlan as AiEvalRecord["replacementPlan"]) ?? null,
      prompt: (aiDebug?.prompt as string) ?? null,
      imageHash: imageBase64 ? hashString(imageBase64.slice(0, 512)) : null,
      qualityScore:
        (aiDebug?.qualityScore as AiEvalRecord["qualityScore"]) ?? null,
      qualityReview:
        (aiDebug?.qualityReview as AiEvalRecord["qualityReview"]) ?? null,
      generationAttempts: (aiDebug?.generationAttempts as number) ?? 0,
      autoRegenerated: Boolean(aiDebug?.autoRegenerated),
      referenceViewCount: (aiDebug?.referenceViewCount as number) ?? 0,
      failureReason,
    };
    saveAiEvalRecord(record);
    setAiEvalRecords(getAiEvalRecords());
  }

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    fetch("/api/ai-debug/status")
      .then((res) => (res.ok ? res.json() : { enabled: false }))
      .then((data) => {
        if (!cancelled) setAiDebugEnabled(Boolean(data?.enabled));
      })
      .catch(() => {
        if (!cancelled) setAiDebugEnabled(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isAdmin =
      new URLSearchParams(window.location.search).get("admin") === "1";

    if (!isAdmin) return;

    const timeout = window.setTimeout(() => {
      setAdminMetrics(computePilotMetrics());
      setAdminLeadCount(getLeads().length);
      setAiEvalRecords(getAiEvalRecords());
      setAdminOpen(true);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const cached = localStorage.getItem(CACHE_KEY);

    if (!cached) return;

    try {
      const parsed = JSON.parse(cached);
      const timeout = window.setTimeout(() => {
        const cachedConcepts = normalizeStudioGeminiConcepts(
          parsed.generatedConcepts || parsed.generatedImages,
          parsed.imageBase64
        );

        setGeneratedConcepts(cachedConcepts);
        setProducts(parsed.products || []);

        if (typeof parsed.roomType === "string") setRoomType(parsed.roomType);
        if (typeof parsed.style === "string") setStyle(parsed.style);

        if (cachedConcepts.length > 0) {
          setSelectedConceptIndex(0);
          setStep(3);
        }
      }, 0);

      return () => window.clearTimeout(timeout);
    } catch {
      localStorage.removeItem(CACHE_KEY);
    }
  }, []);

  // Fire room_summary_viewed once each time a result summary becomes visible.
  useEffect(() => {
    const showingSummary =
      step === 3 && products.length > 0 && Boolean(activeImage);

    if (showingSummary && !summaryViewedRef.current) {
      summaryViewedRef.current = true;
      const budget = estimateFurnishingBudget(
        products,
        roomType,
        selectedStylePrompt
      );
      trackRoomSummaryViewed({
        roomType,
        style: selectedStylePrompt,
        productCount: products.length,
        budgetBasis: budget.basis,
      });
    }

    if (!showingSummary) {
      summaryViewedRef.current = false;
    }
  }, [step, products, activeImage, roomType, selectedStylePrompt]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function saveResultCache(
    nextGeneratedConcepts: GeneratedConcept[],
    nextProducts = products
  ) {
    nextGeneratedConcepts.forEach((concept) => {
      assertStudioGeminiProvider(concept.provider);
    });

    if (nextGeneratedConcepts.length === 0) {
      localStorage.removeItem(CACHE_KEY);
      return;
    }

    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        generatedConcepts: nextGeneratedConcepts,
        generatedImages: nextGeneratedConcepts.map(
          (concept) => concept.imageBase64
        ),
        products: nextProducts,
        style: selectedStylePrompt,
        roomType,
        createdAt: new Date().toISOString(),
      })
    );
  }

  async function handleImageChange(file: File | null) {
    setError("");

    if (!file) return;

    try {
      const normalizedFile = await normalizeRoomPhoto(file);

      if (previewUrl) URL.revokeObjectURL(previewUrl);

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

  function toggleProduct(productId: string) {
    setSelectedProductIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    );
  }

  function toggleRefinementProduct(productId: string) {
    setSelectedRefinementProductIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    );
  }

  function selectConcept({
    nextIndex,
    source,
    surface,
  }: {
    nextIndex: number;
    source: "arrow" | "dot" | "swipe";
    surface: "result" | "fullscreen";
  }) {
    const nextConcept = generatedConcepts[nextIndex];
    const currentConcept = generatedConcepts[selectedConceptIndex];

    if (!nextConcept || nextIndex === selectedConceptIndex) return;

    setSelectedConceptIndex(nextIndex);

    if (source === "swipe" && currentConcept) {
      trackResultProviderSwiped({
        fromProvider: currentConcept.provider,
        toProvider: nextConcept.provider,
        fromIndex: selectedConceptIndex,
        toIndex: nextIndex,
        surface,
      });
    }

    if (surface === "fullscreen") {
      trackFullscreenProviderViewed({
        provider: nextConcept.provider,
        conceptIndex: nextIndex,
        source: source === "swipe" ? "swiped" : "selected",
      });
    } else {
      trackResultProviderViewed({
        provider: nextConcept.provider,
        conceptIndex: nextIndex,
        source,
      });
    }
  }

  function selectAdjacentConcept(
    direction: -1 | 1,
    source: "arrow" | "swipe",
    surface: "result" | "fullscreen"
  ) {
    const nextIndex = Math.min(
      generatedConcepts.length - 1,
      Math.max(0, selectedConceptIndex + direction)
    );

    selectConcept({ nextIndex, source, surface });
  }

  function openImageViewer() {
    if (!activeConcept) return;

    trackFullscreenProviderViewed({
      provider: activeConcept.provider,
      conceptIndex: selectedConceptIndex,
      source: "opened",
    });
    setImageViewerOpen(true);
  }

  function canContinue() {
    return Boolean(image && previewUrl);
  }

  function canGenerateConcept() {
    return Boolean(
      image &&
        previewUrl &&
        roomType &&
        selectedStylePrompt &&
        (letAiRecommendBundle || selectedProductIds.length > 0)
    );
  }

  function appendRoomMeasurements(formData: FormData) {
    Object.entries(studioRoomMeasurementPayload).forEach(([key, value]) => {
      if (typeof value === "string" && value.trim()) {
        formData.append(key, value.trim());
      }
    });
  }

  async function handleGenerate() {
    if (!image || !roomType || !selectedStylePrompt) return;

    const validationError = getRoomPhotoValidationError(image);

    if (validationError) {
      setError(validationError);
      return;
    }

    setError("");
    setLoading(true);
    setAddedRecommendationIds([]);
    resetLoadingIndex();
    trackGenerateStarted({
      roomType,
      style: selectedStylePrompt,
      selectedProductIds,
      roomMeasurements: studioRoomMeasurementPayload,
    });

    try {
      const formData = new FormData();

      formData.append("image", image);
      formData.append("style", selectedStylePrompt);
      formData.append("roomType", roomType);
      formData.append("selectedProductIds", JSON.stringify(selectedProductIds));
      formData.append("aiConceptMode", String(letAiRecommendBundle));
      if (style === "Custom") {
        formData.append("customPrompt", customPrompt.trim());
      }
      appendRoomMeasurements(formData);

      const response = await fetchStudioGemini(STUDIO_GEMINI_ROUTE, {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const reason =
          typeof data.error === "string" ? data.error : "Generation failed.";
        setError(reason);
        void logAiEvaluation(undefined, null, reason);
        return;
      }

      const nextConcepts = normalizeStudioGeminiConcepts(
        data.images,
        data.imageBase64
      );
      const nextProducts = (data.products || []) as Product[];

      if (nextConcepts.length === 0) {
        setError("Generation completed but no image was returned.");
        void logAiEvaluation(
          data.aiDebug,
          data.imageBase64 ?? null,
          "no image returned"
        );
        return;
      }

      void logAiEvaluation(data.aiDebug, data.imageBase64 ?? null, null);

      setGeneratedConcepts(nextConcepts);
      setProducts(nextProducts);
      setSelectedConceptIndex(0);
      setStep(3);
      trackGenerateCompleted({
        roomType,
        style: selectedStylePrompt,
        products: nextProducts,
        imageCount: nextConcepts.length,
        roomMeasurements: studioRoomMeasurementPayload,
      });
      trackGeneratedProviderCount(nextConcepts);
      trackResultProviderViewed({
        provider: nextConcepts[0].provider,
        conceptIndex: 0,
        source: "generated",
      });
      saveResultCache(nextConcepts, nextProducts);
    } catch (generationError) {
      const reason =
        generationError instanceof Error
          ? generationError.message
          : "Gemini generation failed. Please try again.";
      setError(reason);
      void logAiEvaluation(undefined, null, reason);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefine() {
    if (!activeImage) return;
    if (!changeRequest.trim() && selectedRefinementProductIds.length === 0) {
      return;
    }

    setError("");
    setRefining(true);
    resetLoadingIndex();
    trackRefineStarted({
      conceptIndex: selectedConceptIndex,
      changeRequest,
      refinementProductIds: selectedRefinementProductIds,
    });

    try {
      const response = await fetchStudioGemini(STUDIO_GEMINI_ROUTE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageBase64: activeImage,
          imageMimeType: activeConcept?.mimeType || "image/png",
          changeRequest,
          refinementProductIds: selectedRefinementProductIds,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Refinement failed.");
        return;
      }

      const refinedConcepts = normalizeStudioGeminiConcepts(
        data.images,
        data.imageBase64
      );
      const refinedConcept = refinedConcepts[0];

      if (!refinedConcept) {
        setError("Refinement completed but no image was returned.");
        return;
      }

      const updatedConcepts = [...generatedConcepts, refinedConcept];
      const refinedIndex = updatedConcepts.length - 1;
      const refinementProducts = selectedIdsToProducts(
        selectedRefinementProductIds
      );
      const updatedProducts = mergeUniqueProducts(products, refinementProducts);

      setGeneratedConcepts(updatedConcepts);
      setProducts(updatedProducts);
      setSelectedConceptIndex(refinedIndex);
      setRefineSheetOpen(false);
      setChangeRequest("");
      setSelectedRefinementProductIds([]);
      setOpenRefinementCategoryId(null);
      trackRefineCompleted({
        conceptIndex: selectedConceptIndex,
        refinedConceptIndex: refinedIndex,
        changeRequest,
        refinementProductIds: selectedRefinementProductIds,
        mergedProductCount: updatedProducts.length,
      });
      trackResultProviderViewed({
        provider: refinedConcept.provider,
        conceptIndex: refinedIndex,
        source: "refined",
      });
      saveResultCache(updatedConcepts, updatedProducts);
    } catch (refinementError) {
      setError(
        refinementError instanceof Error
          ? refinementError.message
          : "Gemini refinement failed. Please try again."
      );
    } finally {
      setRefining(false);
    }
  }

  function downloadImage() {
    if (!activeConcept) return;

    trackDownloadClicked(selectedConceptIndex);

    const imageFile = conceptToFile(activeConcept, selectedConceptIndex);
    const url = URL.createObjectURL(imageFile);
    const link = document.createElement("a");

    link.href = url;
    link.download = imageFile.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function shareImage() {
    if (!activeConcept) return;

    const navigatorWithShare = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
      canShare?: (data: ShareData) => boolean;
    };
    const shareMethod =
      typeof navigatorWithShare.share === "function" ? "native" : "clipboard";
    const imageFile = conceptToFile(activeConcept, selectedConceptIndex);

    trackShareClicked(selectedConceptIndex, shareMethod);

    if (typeof navigatorWithShare.share === "function") {
      try {
        const fileShareData: ShareData = {
          title: `${activeConcept.label} Koala Design Studio concept`,
          text: SHARE_MESSAGE,
          files: [imageFile],
        };
        const canShareFile =
          typeof navigatorWithShare.canShare === "function" &&
          navigatorWithShare.canShare(fileShareData);

        await navigatorWithShare.share(
          canShareFile
            ? fileShareData
            : {
                title: `${activeConcept.label} Koala Design Studio concept`,
                text: `${SHARE_MESSAGE} Created with ${activeConcept.label}.`,
                url: window.location.href,
              }
        );
      } catch {
        // User cancelled the native sheet.
      }

      return;
    }

    await navigator.clipboard.writeText(
      `${SHARE_MESSAGE} Created with ${activeConcept.label}.`
    );
  }

  function deleteResult() {
    setGeneratedConcepts([]);
    setProducts([]);
    setAddedRecommendationIds([]);
    setSelectedConceptIndex(0);
    setRefineSheetOpen(false);
    setImageViewerOpen(false);
    localStorage.removeItem(CACHE_KEY);
  }

  function resetWizard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);

    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (galleryInputRef.current) galleryInputRef.current.value = "";

    setStep(1);
    setImage(null);
    setPreviewUrl("");
    setRoomType(DEFAULT_ROOM_TYPE);
    setStyle(DEFAULT_STYLE);
    setCustomPrompt("");
    setRoomPickerOpen(false);
    setStylePickerOpen(false);
    setSelectedProductIds([]);
    setLetAiRecommendBundle(true);
    setGeneratedConcepts([]);
    setProducts([]);
    setAddedRecommendationIds([]);
    setSelectedConceptIndex(0);
    setError("");
    setLoading(false);
    setRefining(false);
    setSelectedSheetOpen(false);
    setRefineSheetOpen(false);
    setImageViewerOpen(false);
    setChangeRequest("");
    setSelectedRefinementProductIds([]);
    setOpenRefinementCategoryId(null);
    localStorage.removeItem(CACHE_KEY);
  }

  function renderStep() {
    if (step === 1) {
      return (
        <section className="space-y-3">
          <input
            ref={cameraInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
            capture="environment"
            className="hidden"
            onChange={(event) =>
              void handleImageChange(event.target.files?.[0] || null)
            }
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="hidden"
            onChange={(event) =>
              void handleImageChange(event.target.files?.[0] || null)
            }
          />

          {previewUrl ? (
            <>
              <p className="text-[11px] uppercase tracking-[0.28em] text-[#9a978f]">
                Your room
              </p>
              <div className="v2-hero-shadow relative w-full overflow-hidden rounded-[26px] border border-white/10 bg-[#0B0B0B]">
                <img
                  src={previewUrl}
                  alt="Uploaded room preview"
                  className="h-[56vh] w-full object-cover object-center"
                />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-2 bg-gradient-to-t from-black/70 via-black/20 to-transparent p-3">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="rounded-full border border-white/20 bg-black/40 px-4 py-2 text-xs font-semibold text-[#F5F3EE] backdrop-blur transition active:scale-95"
                  >
                    Retake
                  </button>
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="rounded-full border border-white/20 bg-black/40 px-4 py-2 text-xs font-semibold text-[#F5F3EE] backdrop-blur transition active:scale-95"
                  >
                    Change
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="v2-surface rounded-[26px] p-5">
              <p className="text-[11px] uppercase tracking-[0.28em] text-[#9a978f]">
                Design &amp; shop your room
              </p>
              <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight text-[#F5F3EE]">
                Start with your actual room
              </h1>

              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="mt-4 flex aspect-[5/4] max-h-[42vh] w-full flex-col items-center justify-center rounded-3xl border border-dashed border-white/12 bg-white/[0.02] p-5 text-center transition hover:border-[#C9A57A] hover:bg-white/[0.04]"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/12 bg-[#0B0B0B] text-2xl text-[#C9A57A]">
                  +
                </span>
                <span className="mt-4 text-base font-semibold text-[#F5F3EE]">
                  Add your room photo
                </span>
                <span className="mt-1.5 max-w-56 text-xs leading-5 text-[#9a978f]">
                  Use a clear, wide shot facing the main wall or seating area.
                </span>
              </button>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <StudioButton
                  className="rounded-xl"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  Take photo
                </StudioButton>
                <StudioButton
                  variant="secondary"
                  className="rounded-xl"
                  onClick={() => galleryInputRef.current?.click()}
                >
                  Gallery
                </StudioButton>
              </div>
            </div>
          )}
        </section>
      );
    }

    if (step === 2) {
      const roomLabel =
        roomTypes.find((r) => r.id === roomType)?.label || "Living room";
      const styleLabel =
        designStyles.find((s) => s.id === style)?.title ||
        style ||
        "Modern Luxury";

      return (
        <section className="space-y-4">
          <div className="v2-surface rounded-[26px] p-5">
            <p className="text-[11px] uppercase tracking-[0.28em] text-[#9C9C94]">
              Design brief
            </p>
            <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight text-[#F5F3EE]">
              Style your room
            </h1>
            <p className="mt-2 text-sm leading-6 text-[#9a978f]">
              We&apos;ve suggested a direction. Change anything, or just
              continue.
            </p>

            <SuggestionRow
              label="Room"
              value={roomLabel}
              open={roomPickerOpen}
              onToggle={() => {
                setRoomPickerOpen((o) => !o);
                setStylePickerOpen(false);
              }}
            />
            {roomPickerOpen && (
              <div className="mt-2 flex flex-wrap gap-2">
                {roomTypes.map((item) => (
                  <SelectChip
                    key={item.id}
                    active={roomType === item.id}
                    onClick={() => {
                      setRoomType(item.id);
                      setRoomPickerOpen(false);
                    }}
                  >
                    {item.label}
                  </SelectChip>
                ))}
              </div>
            )}

            <SuggestionRow
              label="Style"
              value={styleLabel}
              open={stylePickerOpen}
              onToggle={() => {
                setStylePickerOpen((o) => !o);
                setRoomPickerOpen(false);
              }}
            />
            {stylePickerOpen && (
              <div className="mt-2 flex flex-wrap gap-2">
                {designStyles.map((item) => (
                  <SelectChip
                    key={item.id}
                    active={style === item.id}
                    onClick={() => {
                      setStyle(item.id);
                      if (item.id !== "Custom") setStylePickerOpen(false);
                    }}
                  >
                    {item.title}
                  </SelectChip>
                ))}
              </div>
            )}
            {style === "Custom" && (
              <textarea
                value={customPrompt}
                onChange={(event) => setCustomPrompt(event.target.value)}
                placeholder="Describe the mood, colours, materials or layout you want..."
                className="mt-3 min-h-20 w-full rounded-xl border border-white/10 bg-[#0B0B0B] p-3 text-sm text-[#F5F3EE] outline-none focus:border-[#C9A57A]"
              />
            )}
          </div>

          <button
            type="button"
            onClick={() => setLetAiRecommendBundle((current) => !current)}
            aria-pressed={letAiRecommendBundle}
            className={`v2-surface flex w-full items-center justify-between gap-4 rounded-2xl p-4 text-left transition ${
              letAiRecommendBundle ? "ring-1 ring-[#C9A57A]/40" : ""
            }`}
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[#F5F3EE]">
                AI Concept
              </span>
              <span className="mt-1 block text-xs leading-5 text-[#9a978f]">
                {letAiRecommendBundle
                  ? "Your picks stay fixed — AI completes the rest of the room with matching Koala pieces."
                  : "Only the products you choose are changed. Everything else stays as-is."}
              </span>
            </span>
            <span
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                letAiRecommendBundle
                  ? "bg-[#C9A57A] text-[#0b0b0d]"
                  : "border border-white/12 text-[#9a978f]"
              }`}
            >
              {letAiRecommendBundle ? "On" : "Off"}
            </span>
          </button>

          {heroDemoProducts.length > 0 && (
            <div className="v2-surface rounded-[26px] p-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-[#C9A57A]">
                    Featured collection
                  </p>
                  <h3 className="mt-1 font-serif text-xl text-[#F5F3EE]">
                    Best sellers
                  </h3>
                </div>
              </div>
              <div className="v2-noscrollbar -mx-1 mt-3 flex gap-3 overflow-x-auto px-1 pb-1">
                {heroDemoProducts.map((product) => (
                  <div key={product.id} className="w-[46%] shrink-0">
                    <StudioProductCard
                      product={product}
                      selected={selectedProductIds.includes(product.id)}
                      onToggle={() => toggleProduct(product.id)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-serif text-xl text-[#F5F3EE]">
                Browse products
              </h3>
              {selectedProducts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedSheetOpen(true)}
                  className="rounded-full bg-[#F5F3EE] px-3 py-1.5 text-xs font-semibold text-[#0b0b0d]"
                >
                  {selectedProducts.length} selected
                </button>
              )}
            </div>

            <div className="mt-4 space-y-8">
              {productsByCategory.map((category) => {
                const count = category.products.filter((product) =>
                  selectedProductIds.includes(product.id)
                ).length;

                return (
                  <div key={category.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#F5F3EE]">
                        {category.label}
                      </p>
                      {count > 0 && (
                        <span className="text-[11px] font-semibold text-[#C9A57A]">
                          {count} added
                        </span>
                      )}
                    </div>
                    <div className="v2-noscrollbar -mx-6 mt-3 flex gap-3 overflow-x-auto px-6 pb-1">
                      {category.products.map((product) => (
                        <div key={product.id} className="w-[150px] shrink-0">
                          <StudioProductCard
                            product={product}
                            selected={selectedProductIds.includes(product.id)}
                            onToggle={() => toggleProduct(product.id)}
                          />
                        </div>
                      ))}
                      <div
                        aria-hidden="true"
                        className="w-1 shrink-0"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      );
    }

    if (!activeImage) {
      return (
        <div className="v2-surface rounded-[26px] p-5">
          <p className="text-[11px] uppercase tracking-[0.28em] text-[#9a978f]">
            Result
          </p>
          <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight text-[#F5F3EE]">
            Your room is on the way
          </h1>
        </div>
      );
    }

    const packageAll = [...products, ...addedRecommendations];

    return (
      <div className="space-y-4 animate-[tabFade_300ms_ease-out]">
        <div
          className="v2-hero-shadow relative aspect-[4/5] max-h-[56vh] w-full overflow-hidden rounded-[26px] border border-white/10 bg-[#0B0B0B]"
          onTouchStart={(event) => {
            if (generatedConcepts.length < 2 || event.touches.length !== 1) {
              return;
            }
            resultSwipeStartXRef.current = event.touches[0].clientX;
          }}
          onTouchEnd={(event) => {
            if (
              generatedConcepts.length < 2 ||
              resultSwipeStartXRef.current === null
            ) {
              return;
            }
            const endX = event.changedTouches[0]?.clientX;
            const deltaX =
              typeof endX === "number" ? endX - resultSwipeStartXRef.current : 0;
            resultSwipeStartXRef.current = null;
            if (Math.abs(deltaX) < 48) return;
            suppressResultViewerOpenRef.current = true;
            window.setTimeout(() => {
              suppressResultViewerOpenRef.current = false;
            }, 500);
            selectAdjacentConcept(deltaX < 0 ? 1 : -1, "swipe", "result");
          }}
        >
          <button
            type="button"
            onClick={() => {
              if (suppressResultViewerOpenRef.current) {
                suppressResultViewerOpenRef.current = false;
                return;
              }
              openImageViewer();
            }}
            className="h-full w-full"
          >
            <img
              key={`${selectedConceptIndex}-${activeImage.slice(0, 16)}`}
              src={`data:${activeConcept?.mimeType || "image/png"};base64,${activeImage}`}
              alt={`Generated concept ${selectedConceptIndex + 1}`}
              className="h-full w-full animate-[imageReveal_600ms_ease-out] object-cover object-center"
            />
          </button>

          {generatedConcepts.length > 1 && selectedConceptIndex > 0 && (
            <button
              type="button"
              onClick={() => selectAdjacentConcept(-1, "arrow", "result")}
              aria-label="Previous generated concept"
              className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[#050505]/70 text-[#F7F7F2] backdrop-blur"
            >
              <ChevronIcon direction="left" />
            </button>
          )}
          {generatedConcepts.length > 1 &&
            selectedConceptIndex < generatedConcepts.length - 1 && (
              <button
                type="button"
                onClick={() => selectAdjacentConcept(1, "arrow", "result")}
                aria-label="Next generated concept"
                className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[#050505]/70 text-[#F7F7F2] backdrop-blur"
              >
                <ChevronIcon direction="right" />
              </button>
            )}

          {generatedConcepts.length > 1 && (
            <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2">
              {generatedConcepts.map((concept, index) => (
                <button
                  key={`${concept.provider}-${index}`}
                  type="button"
                  onClick={() =>
                    selectConcept({
                      nextIndex: index,
                      source: "dot",
                      surface: "result",
                    })
                  }
                  aria-label={`View ${concept.label} concept`}
                  className={`h-1.5 rounded-full transition-all ${
                    selectedConceptIndex === index
                      ? "w-5 bg-[#F7F7F2]"
                      : "w-1.5 bg-white/40"
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        <StudioButton
          onClick={() =>
            document
              .getElementById("room-shop-section")
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          className="min-h-13 w-full rounded-2xl text-base"
        >
          Shop this room
        </StudioButton>

        <div className="flex items-center justify-between gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] px-1 py-0.5">
          {[
            {
              label: "Edit with AI",
              icon: <AiEditIcon />,
              onClick: () => setRefineSheetOpen(true),
            },
            {
              label: "Regenerate",
              icon: <RegenerateIcon />,
              onClick: handleGenerate,
            },
            { label: "Save", icon: <SaveIcon />, onClick: downloadImage },
            { label: "Share", icon: <ShareIcon />, onClick: shareImage },
            {
              label: "Delete",
              icon: <DeleteIcon />,
              onClick: deleteResult,
              danger: true,
            },
          ].map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              aria-label={action.label}
              className={`flex h-9 flex-1 items-center justify-center rounded-lg text-[#9a978f] transition active:scale-90 ${
                action.danger
                  ? "hover:text-[#d98266]"
                  : "hover:text-[#F5F3EE]"
              }`}
            >
              <span className="flex h-[18px] w-[18px] items-center justify-center">
                {action.icon}
              </span>
            </button>
          ))}
        </div>

        {packageAll.length > 0 && (
          <section id="room-shop-section" className="space-y-3 pt-2">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#C9A57A]">
                Shop this room
              </p>
              <h2 className="mt-1 font-serif text-2xl text-[#F5F3EE]">
                Products used in this room
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {packageAll.map((product) => (
                <ShopProductCard key={product.id} product={product} />
              ))}
            </div>
          </section>
        )}

        {packageAll.length > 0 && (
          <div className="space-y-2 pt-1">
            <ShoppingSummaryCard
              productCount={packageAll.length}
              pricing={packagePricing}
              onAddToCart={openQuoteSheet}
            />
            <p className="text-center text-[11px] leading-5 text-[#9a978f]">
              No payment taken — a Koala consultant confirms availability,
              pricing and next steps.
            </p>
          </div>
        )}

        {recommendations.length > 0 && (
          <section className="space-y-3 pt-2">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#C9A57A]">
                Recommended additions
              </p>
              <h2 className="mt-1 font-serif text-2xl text-[#F5F3EE]">
                Complete the room
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {recommendations.map((product) => {
                const added = addedRecommendationIds.includes(product.id);
                return (
                  <ShopProductCard
                    key={product.id}
                    product={product}
                    action={
                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic();
                          if (added) {
                            removeRecommendation(product);
                          } else {
                            addRecommendation(product);
                          }
                        }}
                        aria-pressed={added}
                        className={`block w-full rounded-xl px-3 py-1.5 text-center text-xs font-semibold transition ${
                          added
                            ? "border border-[#C9A57A]/50 bg-[#C9A57A]/12 text-[#C9A57A]"
                            : "bg-[#F5F3EE] text-[#0b0b0d]"
                        }`}
                      >
                        {added ? "Added to package" : "Add to package"}
                      </button>
                    }
                  />
                );
              })}
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <main className="h-dvh overflow-hidden bg-[#050505] text-[#F7F7F2]">
      {(loading || refining) && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[#050505] px-8">
          <div className="w-full max-w-[360px] text-center">
            <p className="text-[11px] uppercase tracking-[0.32em] text-[#9C9C94]">
              Koala Design Studio
            </p>
            <h2
              key={loadingIndex}
              className="mx-auto mt-5 min-h-[6.5rem] max-w-[300px] animate-[stepIn_500ms_ease-out] font-serif text-3xl font-medium leading-tight text-[#F7F7F2]"
            >
              {loadingMessages[loadingIndex]}
            </h2>

            <div className="mt-6 flex items-center justify-center gap-2">
              {loadingMessages.map((message, index) => (
                <span
                  key={message}
                  className={`h-1 flex-1 overflow-hidden rounded-full transition-colors duration-500 ${
                    index < loadingIndex
                      ? "bg-[#C9A57A]"
                      : "bg-[rgba(255,255,255,0.12)]"
                  }`}
                >
                  {index === loadingIndex && (
                    <span className="block h-full w-1/2 animate-[progressShimmer_1.4s_ease-in-out_infinite] rounded-full bg-[#C9A57A]" />
                  )}
                </span>
              ))}
            </div>

            <p className="mt-5 text-xs text-[#9C9C94]">
              Step {Math.min(loadingIndex + 1, loadingMessages.length)} of{" "}
              {loadingMessages.length}
            </p>
          </div>
        </div>
      )}

      {selectedSheetOpen && (
        <SelectedProductsSheet
          products={selectedProducts}
          onClose={() => setSelectedSheetOpen(false)}
          onRemove={(productId) =>
            setSelectedProductIds((current) =>
              current.filter((id) => id !== productId)
            )
          }
        />
      )}

      {refineSheetOpen && (
        <RefineSheet
          selectedProductIds={selectedRefinementProductIds}
          openCategoryId={openRefinementCategoryId}
          changeRequest={changeRequest}
          refining={refining}
          onChangeRequest={setChangeRequest}
          onToggleCategory={(categoryId) =>
            setOpenRefinementCategoryId((current) =>
              current === categoryId ? null : categoryId
            )
          }
          onToggleProduct={toggleRefinementProduct}
          onClose={() => setRefineSheetOpen(false)}
          onRefine={handleRefine}
        />
      )}

      {imageViewerOpen && activeConcept && (
        <ImageViewerModal
          concept={activeConcept}
          onClose={() => setImageViewerOpen(false)}
        />
      )}

      {quoteSheetOpen && (
        <QuoteSheet
          imageDataUrl={activeImageDataUrl}
          products={products}
          recommendations={addedRecommendations}
          pricing={packagePricing}
          summary={roomSummary}
          form={quoteForm}
          onField={(field, value) =>
            setQuoteForm((current) => ({ ...current, [field]: value }))
          }
          onSubmit={submitQuoteRequest}
          onClose={() => setQuoteSheetOpen(false)}
        />
      )}

      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)_+_24px)] z-[70] flex justify-center px-6"
        >
          <div className="pointer-events-auto w-full max-w-[382px] rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[#111111] px-4 py-3 text-center text-sm text-[#F7F7F2] shadow-2xl">
            {toastMessage}
          </div>
        </div>
      )}

      {adminOpen && (
        <AdminPanel
          metrics={adminMetrics}
          leadCount={adminLeadCount}
          aiDebugEnabled={aiDebugEnabled}
          aiEvalRecords={aiEvalRecords}
          onRefresh={refreshAdminData}
          onExportAnalytics={() =>
            downloadJson(
              `koala-analytics-${Date.now()}.json`,
              getAnalyticsEvents()
            )
          }
          onExportLeads={() =>
            downloadJson(`koala-leads-${Date.now()}.json`, getLeads())
          }
          onExportEvals={() =>
            downloadJson(`koala-ai-evals-${Date.now()}.json`, getAiEvalRecords())
          }
          onClose={() => setAdminOpen(false)}
        />
      )}

      <div className="v2-canvas mx-auto flex h-dvh w-full max-w-[430px] flex-col overflow-hidden">
        <header
          className={`shrink-0 ${
            step === 3
              ? "px-5 pt-[calc(env(safe-area-inset-top)_+_12px)]"
              : "px-6 pt-[calc(env(safe-area-inset-top)_+_18px)]"
          }`}
        >
          <div className="flex items-center justify-between gap-4">
            <Image
              src="/koala-logo.png"
              alt="Koala Living"
              width={150}
              height={65}
              priority
              className={step === 3 ? "h-auto w-24" : "h-auto w-28"}
            />
            <button
              type="button"
              onClick={resetWizard}
              className="rounded-full border border-white/15 bg-white/[0.05] px-4 py-1.5 text-xs font-medium text-[#F5F3EE] shadow-sm transition hover:border-white/25 hover:bg-white/10"
            >
              {step === 3 ? "New room" : "Reset"}
            </button>
          </div>
          <div
            className={`flex items-end gap-2 ${step === 3 ? "mt-3" : "mt-5"}`}
          >
            {[
              { n: 1, label: "Capture" },
              { n: 2, label: "Design" },
              { n: 3, label: "Shop" },
            ].map((s) => (
              <div key={s.n} className="flex-1">
                <div
                  className={`h-1 rounded-full transition-colors ${
                    step >= s.n ? "bg-[#C9A57A]" : "bg-white/10"
                  }`}
                />
                <p
                  className={`mt-2 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                    step >= s.n ? "text-[#F5F3EE]" : "text-[#9a978f]"
                  }`}
                >
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </header>


        <div
          className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${
            step === 3
              ? "px-5 pb-6 pt-4"
              : step === 1
                ? "px-6 pb-4 pt-4"
                : "px-6 pb-32 pt-4"
          }`}
        >
          <div key={step} className="animate-[stepIn_360ms_ease-out]">
            {renderStep()}
          </div>

          {error && (
            <p className="mt-4 rounded-2xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
              {error}
            </p>
          )}
        </div>

        {step !== 3 && (
          <footer
            className={`sticky bottom-0 z-40 grid shrink-0 gap-3 border-t border-white/10 bg-[#0b0b0d]/90 px-6 pb-[calc(env(safe-area-inset-bottom)_+_20px)] pt-4 backdrop-blur ${
              step === 1 ? "grid-cols-1" : "grid-cols-[auto_1fr]"
            }`}
          >
            {step === 2 && (
              <StudioButton
                variant="ghost"
                onClick={() => setStep(1)}
                disabled={loading || refining}
                className="min-w-20 rounded-2xl"
              >
                Back
              </StudioButton>
            )}
            {step === 1 ? (
              <StudioButton
                onClick={() => setStep(2)}
                disabled={!canContinue()}
                className="min-h-14 rounded-2xl text-base"
              >
                Continue
              </StudioButton>
            ) : (
              <StudioButton
                onClick={handleGenerate}
                disabled={!canGenerateConcept() || loading}
                className="min-h-14 rounded-2xl text-base"
              >
                {loading ? "Generating..." : "Generate my room"}
              </StudioButton>
            )}
          </footer>
        )}
      </div>
    </main>
  );
}
