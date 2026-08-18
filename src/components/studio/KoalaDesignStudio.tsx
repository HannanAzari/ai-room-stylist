"use client";

/* eslint-disable @next/next/no-img-element */

import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  buildReplacementContract,
  selectionToTarget,
  type AssignmentInput,
} from "@/lib/intelligence/replacement-assignment";
import {
  buildReplacementGroups,
  primaryTargetFor,
  toPackageLines,
} from "@/lib/intelligence/replacement-group";
import type { CanonicalCategory } from "@/lib/intelligence/scene-taxonomy";
import { getProductProfiles } from "@/lib/intelligence/product-profile";
import { getAllProducts as getAllCatalogueProducts } from "@/lib/products";
import { CategoryProductShelves } from "./CategoryProductShelves";
import { ReplaceCategoryPicker } from "./ReplaceCategoryPicker";
import { SeatingPlanPicker } from "./SeatingPlanPicker";
import { SurpriseStylePicker } from "./SurpriseStylePicker";
import {
  describeSeatingPlan,
  describeSeatingProducts,
  getCategoryMenu,
  isCategorySupported,
  isSeatingCategory,
  isValidSeatingPlan,
  seatingPlanSlots,
  seatingSlotKey,
  type SeatingPlan,
} from "@/lib/intelligence/room-categories";
import {
  designModeToConceptMode,
  displayCategoryName,
  isDesignMode,
  objectsForSelectedCategories,
  selectionFromDetectedObject,
  type DesignMode,
  type RoomSelection,
  type SelectableObject,
  type SourceImageSize,
} from "@/lib/intelligence/room-selection";
import { RoomObjectSelector } from "./RoomObjectSelector";
import {
  assertStudioGeminiProvider,
  fetchStudioGemini,
  STUDIO_GEMINI_ROUTE,
} from "./studio-gemini-api";
import {
  forgetPendingJob,
  formatElapsed,
  nowMs,
  pollGenerationJob,
  readPendingJob,
  rememberPendingJob,
} from "@/features/room-stylist/services/generation-jobs/client";

const CACHE_KEY = "ai-room-stylist:studio:last-result";
const SHARE_MESSAGE =
  "I created a luxury room concept with Koala Design Studio.";
// Customer-facing progress only. Never prompts, product ids or model internals.
const loadingMessages = [
  "Understanding your room",
  "Choosing your Koala pieces",
  "Balancing colour and materials",
  "Refining layout and lighting",
  "Creating your Koala look",
];
const refineChips = [
  "Make it brighter",
  "More luxury",
  "Add greenery",
  "Larger sofa",
  "More minimal",
  "Warmer palette",
];
function getStylePrompt(style: string, customPrompt: string) {
  return style === "Custom" ? customPrompt.trim() : style.toLowerCase();
}

// Optional light haptic on supported mobile devices. No-op elsewhere.
function triggerHaptic() {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate === "function") navigator.vibrate(8);
}


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

  // The provider and label are reported as the server rendered them. Rewriting
  // them to a fixed vendor here would make the debug view lie about which
  // renderer produced the image, which is exactly what it exists to show.
  return concepts;
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



/**
 * One of the two design intents on the choice screen.
 *
 * The two cards are deliberately identical in weight — neither is a default —
 * and each shows the customer's own room so the choice reads as being about
 * their photo rather than about a setting.
 */
function DesignModeCard({
  title,
  description,
  accent,
  preview,
  selected,
  onClick,
}: {
  title: string;
  description: string;
  accent: string;
  preview: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`v2-surface group flex w-full items-stretch gap-3 overflow-hidden rounded-[24px] p-3 text-left transition active:scale-[0.99] ${
        selected
          ? "ring-1 ring-[#C9A57A]/60"
          : "hover:border-white/25 hover:bg-white/[0.05]"
      }`}
    >
      <span className="relative h-[104px] w-[92px] shrink-0 overflow-hidden rounded-[16px] border border-white/10 bg-[#0B0B0B]">
        {preview ? (
          <img
            src={preview}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover object-center"
          />
        ) : null}
        <span className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center py-1 pr-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C9A57A]">
          {accent}
        </span>
        <span className="mt-1.5 block font-serif text-[22px] leading-tight text-[#F5F3EE]">
          {title}
        </span>
        <span className="mt-1.5 block text-[13px] leading-5 text-[#9a978f]">
          {description}
        </span>
      </span>
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
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  // The customer's explicit intent. Null until they choose on the mode screen;
  // it then persists through generation and into the result.
  const [designMode, setDesignMode] = useState<DesignMode | null>(null);
  // Regions of the room the customer wants changed. The selection UI lands in a
  // later sprint; the model and the plumbing are real from here on.
  const [roomSelections, setRoomSelections] = useState<RoomSelection[]>([]);
  // Objects Smart Select found in the room photo. Empty until detection runs.
  const [detectedObjects, setDetectedObjects] = useState<SelectableObject[]>([]);
  const [detectionState, setDetectionState] = useState<
    "idle" | "loading" | "ready" | "unavailable"
  >("idle");
  const [sourceImageSize, setSourceImageSize] = useState<SourceImageSize>({
    width: 0,
    height: 0,
  });
  // Replace-items has two stages within step 3: pick the objects, then confirm.
  const [replacePhase, setReplacePhase] = useState<
    "categories" | "seating" | "products" | "precision"
  >("categories");
  /** The category the seating configurator is currently editing. */
  const [seatingCategory, setSeatingCategory] =
    useState<CanonicalCategory | null>(null);
  /**
   * What configurable categories should END UP as, keyed by category.
   *
   * Seating is not a swap: two tired sofas can become one L-shape, or a 3-seat
   * plus a 2-seat. The plan states the destination and the pipeline works out
   * the difference from what the room actually holds.
   */
  const [categoryPlans, setCategoryPlans] = useState<
    Partial<Record<CanonicalCategory, SeatingPlan>>
  >({});
  /**
   * One chosen product per seating SLOT — per physical piece, not per shape
   * and not per canonical category.
   *
   * Keyed by slot (`sofa-3-seater#1`, `sofa-3-seater#2`) for the reason
   * `SeatingSlot` documents: "2 × 3-seater" is two independent choices, which
   * may be the same sofa twice or two different models. Keying by shape — as
   * this map used to — could only ever express the first, and silently
   * collapsed a two-sofa request onto one product.
   */
  const [chosenSeatingProducts, setChosenSeatingProducts] = useState<
    Record<string, string | undefined>
  >({});
  /** The look chosen for Surprise me. Null until the customer picks one. */
  const [surpriseStyle, setSurpriseStyle] = useState<string | null>(null);
  /** Furniture TYPES the customer chose to replace. */
  const [selectedCategories, setSelectedCategories] = useState<
    CanonicalCategory[]
  >([]);
  /** Set only while the advanced picker is narrowing one type. */
  const [precisionCategory, setPrecisionCategory] =
    useState<CanonicalCategory | null>(null);
  /**
   * One chosen Koala product per canonical category, keyed by category.
   *
   * The customer picks "this sofa", not a product per sofa instance. How that
   * choice applies across the individual objects they selected is decided by
   * the replacement groups, never configured by hand.
   */
  const [chosenProductByCategory, setChosenProductByCategory] = useState<
    Record<string, string | undefined>
  >({});
  /**
   * Units required per product id for the generated room. Survives with the
   * result so the basket charges for two sofas when the room needs two.
   */
  const [productQuantities, setProductQuantities] = useState<
    Record<string, number>
  >({});
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
  /**
   * Wall-clock since the current generation started, so the processing screen
   * shows real elapsed time instead of an unmoving spinner. A render is 2-3
   * minutes; a progress bar we cannot measure would be a fiction, but the time
   * actually spent is true and is what makes the wait feel accounted for.
   */
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(
    null
  );
  const [generationElapsedMs, setGenerationElapsedMs] = useState(0);
  /** Set when a job from a previous page load is being picked back up. */
  const [resumedGeneration, setResumedGeneration] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const resultSwipeStartXRef = useRef<number | null>(null);
  const suppressResultViewerOpenRef = useRef(false);
  const toastTimeoutRef = useRef<number | null>(null);
  const summaryViewedRef = useRef(false);
  /**
   * The app shell is `h-dvh overflow-hidden`, so the window never scrolls —
   * THIS element is the scroll owner. `window.scrollTo` would silently do
   * nothing here.
   */
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  /**
   * Bumped for every new primary result. The scroll reset keys off this rather
   * than the image bytes, so a regenerate that happens to return an identical
   * image still starts the customer at the top.
   */
  const [resultEpoch, setResultEpoch] = useState(0);
  /**
   * The identity of the screen currently on show — the single source of truth
   * for "the customer has navigated somewhere new".
   *
   * The wizard's `step` is NOT that identity: step 3 alone hosts four distinct
   * screens (the category menu, the seating configurator, the product shelves
   * and the advanced picker), and moving between them is navigation as far as
   * the customer is concerned. Everything that should happen on a screen change
   * — currently the scroll reset and the enter animation — keys off this, so a
   * new screen never has to remember to do it for itself.
   */
  const screenKey = [
    step,
    designMode ?? "-",
    step === 3 && designMode === "replace-items" ? replacePhase : "-",
    seatingCategory ?? "-",
    precisionCategory ?? "-",
  ].join("/");
  /**
   * `screenKey` plus the result epoch. A regenerate or refine keeps the customer
   * on the same screen — so it must NOT remount the result subtree and replay
   * its enter animation — but it does produce a new room to look at, which must
   * start at the top. The scroll reset therefore watches this; the DOM key
   * watches `screenKey` alone.
   */
  const viewKey = `${screenKey}/${resultEpoch}`;
  const [loadingIndex, resetLoadingIndex] = useProgressIndex(
    loading || refining,
    loadingMessages.length,
    2600
  );
  const selectedProducts = selectedIdsToProducts(selectedProductIds);
  // Full catalogue, so each region can offer only its own category.
  const allCatalogueProducts = getAllCatalogueProducts();
  /**
   * The menu of things that can be replaced.
   *
   * Written from the room TYPE, not the photo, so it is on screen the instant
   * the customer arrives. A living room has sofas and a rug whether or not we
   * have looked at this particular one — and nobody should wait half a minute
   * to be shown a list we could have written in advance.
   */
  const menuCategories = getCategoryMenu(roomType);
  /**
   * Types the menu offers that the catalogue cannot fill yet. Shown, because
   * the menu should read like a whole room, but never selectable — a tap that
   * leads to an empty shelf is worse than an honest "coming soon".
   */
  const unavailableCategories = menuCategories
    .filter(
      (entry) =>
        !isCategorySupported(entry.canonicalCategory, allCatalogueProducts)
    )
    .map((entry) => entry.canonicalCategory);
  /** True once the room has actually been looked at. */
  const hasDetections = detectionState === "ready" && detectedObjects.length > 0;

  /**
   * The objects a category choice resolves to.
   *
   * Choosing "Sofas" means every sofa — that is what the words mean. The
   * advanced picker can narrow a type to specific pieces, and those overrides
   * win where they exist.
   */
  const precisionOverrides = roomSelections.reduce<Record<string, string[]>>(
    (map, selection) => {
      if (!selection.sceneItemId) return map;
      const list = map[selection.canonicalCategory] ?? [];
      list.push(selection.sceneItemId);
      map[selection.canonicalCategory] = list;
      return map;
    },
    {}
  );
  const effectiveObjects = objectsForSelectedCategories(
    selectedCategories,
    detectedObjects,
    precisionOverrides
  );
  /** Hand-drawn areas are their own targets and bypass category grouping. */
  const manualSelections = roomSelections.filter(
    (selection) => selection.selectionMethod === "manual"
  );
  const effectiveSelections: RoomSelection[] = [
    ...effectiveObjects.map((object) =>
      selectionFromDetectedObject(object, sourceImageSize)
    ),
    ...manualSelections,
  ];

  /**
   * Every seating slot the plan asks for, in contract order.
   *
   * Kept as one flat list because it is the thing three different places need
   * to agree on: the shelves the customer picks from, the payload sent to the
   * server, and the confirmation copy. Deriving each of those from the same
   * list is what stops them drifting apart.
   */
  const seatingSlotsByCategory = selectedCategories
    .filter((canonicalCategory) => isSeatingCategory(roomType, canonicalCategory))
    .flatMap((canonicalCategory) => {
      const plan = categoryPlans[canonicalCategory];
      if (!plan) return [];
      return seatingPlanSlots(plan).map((slot) => ({
        canonicalCategory,
        slot,
      }));
    });

  /**
   * Seating shelves — ALWAYS one per desired SLOT, from the plan directly.
   *
   * Unlike every other category, seating's shelf count must never come from
   * detected-instance counting: the whole point of the plan is that it states
   * the DESIRED final layout independent of how many sofas the room actually
   * holds. If detection happened to run for some other category in the same
   * visit, that must not silently switch the sofa shelves over to counting
   * real objects — "1 L-shape" means one shelf wanting one L-shape, whether
   * or not anything has looked at the photo yet.
   *
   * One shelf per slot rather than per shape, so "2 × 3-seater" is genuinely
   * two choices. Each shelf therefore covers exactly one piece; the second and
   * later slots of a shape carry a "same as the previous one" shortcut so a
   * matching pair stays a single tap.
   */
  /** Slots the customer has not chosen a sofa for yet. */
  const unfilledSeatingSlots = seatingSlotsByCategory.filter(
    ({ slot }) => !chosenSeatingProducts[slot.key]
  ).length;

  const seatingShelfCategories = seatingSlotsByCategory.map(
    ({ canonicalCategory, slot }) => ({
      canonicalCategory,
      key: slot.key,
      label: slot.label,
      targetCount: 1,
      quantityIsExplicit: true,
      ...(slot.index > 1
        ? {
            sameAs: {
              key: seatingSlotKey(slot.kind, slot.index - 1),
              // Short on purpose — see the `sameAs.label` note on
              // CategorySelection. The heading above already names the piece.
              label: slot.index === 2 ? "the first" : `number ${slot.index - 1}`,
            },
          }
        : {}),
    })
  );

  /**
   * One shelf per other chosen type, carrying how many pieces it covers.
   *
   * Without an analysis there are no instances to count, so these shelves
   * default to one each. Once the advanced picker has analysed the room, the
   * real instance counts take over.
   */
  const simpleShelfCategories = (
    hasDetections
      ? [
          ...effectiveSelections.reduce((counts, selection) => {
            counts.set(
              selection.canonicalCategory,
              (counts.get(selection.canonicalCategory) || 0) + 1
            );
            return counts;
          }, new Map<CanonicalCategory, number>()),
        ].map(([canonicalCategory, targetCount]) => ({
          canonicalCategory,
          targetCount,
        }))
      : selectedCategories.map((canonicalCategory) => ({
          canonicalCategory,
          targetCount: 1,
        }))
  ).filter(
    ({ canonicalCategory }) =>
      !isSeatingCategory(roomType, canonicalCategory) &&
      // A shelf nothing can fill is an empty shelf. The menu already marks
      // these unavailable, so this is belt-and-braces rather than the fix.
      isCategorySupported(canonicalCategory, allCatalogueProducts)
  );

  const shelfCategories = [...seatingShelfCategories, ...simpleShelfCategories];

  /**
   * Shelves the customer has been shown but not chosen a product for.
   *
   * Found in mobile QA: selecting "Coffee table" and then generating without
   * picking one silently dropped it — `buildCategoryIntents` omits a category
   * with no product, so the request faithfully asked for the sofas and said
   * nothing at all about the coffee table the customer had ticked. Same defect
   * class as an unfilled seating slot, and the same rule applies: the request
   * must match what the customer was told they were getting, so an empty shelf
   * blocks generation and is named in the button rather than being dropped.
   */
  const unfilledSimpleShelves = simpleShelfCategories.filter(
    ({ canonicalCategory }) => !chosenProductByCategory[canonicalCategory]
  );
  const unfilledShelfCount = unfilledSeatingSlots + unfilledSimpleShelves.length;

  /** Replacement groups: one chosen product applied across its objects. */
  /**
   * The advanced picker (real, detected instances) needs ONE product per
   * canonical category — a model `replacementGroups` still assumes. Seating
   * products now live per SHAPE, which can genuinely be ambiguous here: if
   * the plan bound two different products to two different shapes, there is
   * no single "the sofa product" to hand the advanced picker. In that case
   * this deliberately contributes nothing for sofa, rather than guessing —
   * the precision path is secondary, and a real product chosen through it
   * must never be silently swapped for the wrong one of two candidates.
   */
  const unambiguousSeatingProductId = (() => {
    const chosen = Object.values(chosenSeatingProducts).filter(
      (id): id is string => Boolean(id)
    );
    const distinct = new Set(chosen);
    return distinct.size === 1 ? chosen[0] : undefined;
  })();

  const replacementGroups = buildReplacementGroups({
    targetsByCategory: effectiveSelections.reduce((map, selection, index) => {
      const list = map.get(selection.canonicalCategory) ?? [];
      list.push(selectionToTarget(selection, index));
      map.set(selection.canonicalCategory, list);
      return map;
    }, new Map<CanonicalCategory, ReturnType<typeof selectionToTarget>[]>()),
    productByCategory: (() => {
      const map = Object.entries(chosenProductByCategory).reduce(
        (map, [category, productId]) => {
          const product = productId
            ? allCatalogueProducts.find((p) => p.id === productId)
            : undefined;
          if (product) map.set(category as CanonicalCategory, product);
          return map;
        },
        new Map<CanonicalCategory, Product>()
      );
      if (unambiguousSeatingProductId) {
        const product = allCatalogueProducts.find(
          (p) => p.id === unambiguousSeatingProductId
        );
        if (product) map.set("sofa", product);
      }
      return map;
    })(),
  });

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
  // Physical units per product, so a room needing two of the same sofa is one
  // card but two units in the basket.
  const packagePricing = getPackagePricing(
    packageProducts,
    undefined,
    productQuantities
  );
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
      reviewStatus:
        (aiDebug?.reviewStatus as AiEvalRecord["reviewStatus"]) ?? null,
      reviewUnavailableReason:
        (aiDebug?.reviewUnavailableReason as string) ?? null,
      referenceManifest:
        (aiDebug?.referenceManifest as AiEvalRecord["referenceManifest"]) ??
        null,
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
        // The intent survives into the restored result so the Shop screen
        // always knows which journey produced the room.
        if (isDesignMode(parsed.designMode)) setDesignMode(parsed.designMode);

        if (cachedConcepts.length > 0) {
          setSelectedConceptIndex(0);
          setResultEpoch((epoch) => epoch + 1);
          setStep(4);
        }
      }, 0);

      return () => window.clearTimeout(timeout);
    } catch {
      localStorage.removeItem(CACHE_KEY);
    }
  }, []);

  /**
   * EVERY new screen must open at the very top.
   *
   * This is deliberately keyed off `viewKey` — one derived identity for "which
   * screen is the customer looking at" — rather than off `step` alone. Most of
   * this flow's screens are phases WITHIN step 3 (categories, seating, the
   * product shelves, the advanced picker), so a step-only dependency reset the
   * scroll on one transition in four and left the rest carrying the previous
   * screen's offset. Anything that adds a screen later gets this for free by
   * contributing to `viewKey`, instead of remembering to patch its own reset in.
   *
   * `useLayoutEffect` runs before paint so the customer never sees the old
   * offset. The extra frame afterwards defends against the browser restoring or
   * anchoring the previous position once images finish decoding — that late
   * shift was the "second jump" the original result-page bug produced. On iOS
   * Safari it also lands after any in-flight momentum scroll has been cancelled
   * by the DOM swap, which a single synchronous write can miss.
   */
  /**
   * Tick the elapsed clock while a generation is in flight.
   *
   * One second is plenty — this drives a human-readable "1m 20s", not an
   * animation — and the interval is torn down as soon as the wait ends so it
   * never keeps running behind the result page.
   */
  useEffect(() => {
    if (!loading || generationStartedAt === null) return;

    const update = () =>
      setGenerationElapsedMs(nowMs() - generationStartedAt);
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [loading, generationStartedAt]);

  /**
   * Pick a generation back up if the page was reloaded while one was running.
   *
   * Without this the customer returns to a blank capture screen while a render
   * they have already paid for finishes into nothing. `readPendingJob` only
   * returns jobs that are recent AND durable, so this can never strand anyone
   * on a processing screen waiting for a job that cannot be found.
   */
  useEffect(() => {
    const pending = readPendingJob();
    if (!pending) return;

    let cancelled = false;

    void (async () => {
      // Yield before touching state. An async body runs synchronously up to its
      // first await, so setting state here without this is still an
      // effect-synchronous setState and triggers a cascading render. The resume
      // screen does not need to appear a frame sooner.
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setResumedGeneration(true);
      setGenerationStartedAt(pending.startedAt);

      const finalStatus = await pollGenerationJob({ jobId: pending.jobId });
      if (cancelled) return;
      forgetPendingJob();
      setLoading(false);
      setResumedGeneration(false);

      if (finalStatus.status !== "succeeded") {
        setError(
          finalStatus.error ||
            "We lost track of that generation. Please try again."
        );
        return;
      }

      const data = (finalStatus.result ?? {}) as {
        images?: unknown;
        imageBase64?: string;
        products?: Product[];
      };
      const concepts = normalizeStudioGeminiConcepts(
        data.images,
        data.imageBase64
      );
      if (concepts.length === 0) {
        setError(
          "That generation finished without an image. Please try again."
        );
        return;
      }
      setGeneratedConcepts(concepts);
      setProducts(data.products || []);
      setSelectedConceptIndex(0);
      setResultEpoch((epoch) => epoch + 1);
      setStep(4);
    })();

    return () => {
      cancelled = true;
    };
    // Runs once on mount: resuming is a page-load concern, not a state one.
  }, []);

  useLayoutEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) return;

    element.scrollTop = 0;
    const frame = requestAnimationFrame(() => {
      element.scrollTop = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [viewKey]);

  // Fire room_summary_viewed once each time a result summary becomes visible.
  useEffect(() => {
    const showingSummary =
      step === 4 && products.length > 0 && Boolean(activeImage);

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
        designMode,
        createdAt: new Date().toISOString(),
      })
    );
  }

  /** True pixel dimensions of a photo, for resolution-independent selections. */
  function measureImageSize(url: string): Promise<SourceImageSize> {
    return new Promise((resolve) => {
      const probe = new window.Image();
      probe.onload = () =>
        resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
      probe.onerror = () => resolve({ width: 0, height: 0 });
      probe.src = url;
    });
  }

  /**
   * Run Smart Select against the uploaded photo.
   *
   * Fallback-safe: any failure leaves detection "unavailable" and the customer
   * draws manually instead. Detection never blocks the flow.
   */
  async function detectRoomObjects() {
    if (!image) return;

    setDetectionState("loading");
    try {
      const formData = new FormData();
      formData.append("image", image);
      formData.append("roomType", roomType);

      const response = await fetch("/api/studio/detect-objects", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !Array.isArray(data.objects)) {
        setDetectedObjects([]);
        setDetectionState("unavailable");
        return;
      }

      setDetectedObjects(data.objects as SelectableObject[]);
      setDetectionState(data.analysed ? "ready" : "unavailable");
    } catch {
      setDetectedObjects([]);
      setDetectionState("unavailable");
    }
  }

  async function handleImageChange(file: File | null) {
    setError("");

    if (!file) return;

    try {
      const normalizedFile = await normalizeRoomPhoto(file);

      if (previewUrl) URL.revokeObjectURL(previewUrl);

      const objectUrl = URL.createObjectURL(normalizedFile);
      setImage(normalizedFile);
      setPreviewUrl(objectUrl);
      // A new photo invalidates everything selected against the old one.
      setRoomSelections([]);
      setChosenProductByCategory({});
      setChosenSeatingProducts({});
    setProductQuantities({});
      setDetectedObjects([]);
      setDetectionState("idle");
      // Record the photo's true pixel size so selections stay resolution
      // independent — they are stored normalised against these dimensions.
      void measureImageSize(objectUrl).then(setSourceImageSize);
    } catch (normalizationError) {
      setImage(null);
      setPreviewUrl("");
      setRoomSelections([]);
      setDetectedObjects([]);
      setDetectionState("idle");
      setError(
        normalizationError instanceof Error
          ? normalizationError.message
          : UNSUPPORTED_UPLOAD_ERROR
      );
    }
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
    if (!image || !previewUrl || !roomType || !selectedStylePrompt) return false;
    if (!designMode) return false;

    // "Surprise me" needs no picks — that is the whole point of it. "Replace
    // items" needs at least one region with an actual product assigned to it,
    // because that flow only ever executes explicit assignments.
    //
    // Only the advanced picker actually resolves category choices into real
    // objects client-side (`replacementGroups`, from real detections). The
    // ordinary journey has no detections yet — that is the entire point of
    // the instant menu — so the gate there has to be "would there be
    // anything to send", i.e. the same category intents `handleGenerate`
    // would actually build, not a signal that only ever exists once the
    // photo has been analysed.
    // Every shelf the customer was shown must have a product before generating.
    //
    // Without this a plan asking for two 3-seaters could be sent with only one
    // of them chosen, and the request would faithfully replace one sofa — the
    // customer having asked for two and been told "2 in your new layout" on
    // the previous screen. The same applied to a ticked category with no
    // product picked, which was dropped from the payload entirely. Under-
    // delivering against the stated plan is the same defect as the renderer
    // dropping a task; it just happens earlier.
    if (unfilledShelfCount > 0) return false;

    if (designMode === "replace-items") {
      return hasDetections
        ? replacementGroups.length > 0
        : buildCategoryIntents().length > 0;
    }
    return true;
  }

  /** Add or remove a furniture type from the replace list. */
  function toggleCategory(category: CanonicalCategory) {
    setSelectedCategories((current) =>
      current.includes(category)
        ? current.filter((entry) => entry !== category)
        : [...current, category]
    );
    // Dropping a type also drops any product chosen for it, so a stale choice
    // cannot survive into the plan.
    setChosenProductByCategory((current) => {
      if (!selectedCategories.includes(category)) return current;
      const next = { ...current };
      delete next[category];
      return next;
    });
    // The arrangement goes with it — a plan for a type nobody is replacing
    // would quietly reappear if the type were chosen again later. Only
    // "sofa" is a seating category today, so clearing the whole seating
    // product map is exactly as scoped as clearing categoryPlans[category].
    if (isSeatingCategory(roomType, category)) {
      setChosenSeatingProducts({});
    }
    setCategoryPlans((current) => {
      if (!selectedCategories.includes(category)) return current;
      const next = { ...current };
      delete next[category];
      return next;
    });
  }

  /**
   * Choose (or clear) a product for a shelf.
   *
   * `key` addresses the shelf: for a plain category it is the canonical
   * category itself, for seating it is the SLOT key — two different state
   * buckets, dispatched on which kind of category this is.
   */
  function chooseProductForShelf(
    key: string,
    productId: string | null,
    canonicalCategory: CanonicalCategory
  ) {
    if (isSeatingCategory(roomType, canonicalCategory)) {
      setChosenSeatingProducts((current) => ({
        ...current,
        [key]: productId ?? undefined,
      }));
      return;
    }
    setChosenProductByCategory((current) => ({
      ...current,
      [key]: productId ?? undefined,
    }));
  }

  /**
   * Build the explicit replacement contract from the customer's regions and
   * product choices. Returns null when there is nothing explicit to send.
   */
  /**
   * A full contract, but only when the room has actually been analysed.
   *
   * A contract names INSTANCES — this sofa, at these coordinates — so it can
   * only be built once something has looked at the photo. In the ordinary
   * journey nothing has, and the server builds the contract instead from the
   * category intent below, using the scene graph it was going to compute
   * anyway. This path exists for the advanced picker, where the customer
   * singled out specific pieces and the browser already holds the detections.
   */
  function buildContract() {
    if (
      designMode !== "replace-items" ||
      replacementGroups.length === 0 ||
      // Hand-drawn areas have no category the server could resolve — they ARE
      // the geometry — so they always travel as a contract, even when
      // detection was unavailable and drawing was the only option left.
      (!hasDetections && manualSelections.length === 0)
    ) {
      return null;
    }
    // Groups decide which objects each chosen product covers; a combined
    // sectional clears every seat it absorbs but is only PLACED once.
    const assignments: AssignmentInput[] = replacementGroups.flatMap((group) => {
      const acting =
        group.strategy === "replace-group-with-single"
          ? [primaryTargetFor(group)]
          : group.targets;
      const entries: AssignmentInput[] = [];
      for (const target of acting) {
        const selection = effectiveSelections.find(
          (candidate, index) =>
            selectionToTarget(candidate, index).targetId === target.targetId
        );
        if (!selection) continue;
        entries.push({
          selectionId: selection.selectionId,
          productId: group.selectedProductId,
          // Scope is decided by the group's strategy, never asked of the
          // customer — the old "this one / all of them" question is gone.
          scope: "this-only",
        });
      }
      return entries;
    });

    return buildReplacementContract({
      selections: effectiveSelections,
      assignments,
      profiles: getProductProfiles(allCatalogueProducts),
      allDetected: detectedObjects.map((object) => ({
        sceneItemId: object.sceneItemId,
        canonicalCategory: object.canonicalCategory,
        displayName: object.displayName,
      })),
      sourceImage: sourceImageSize,
    });
  }

  function appendRoomMeasurements(formData: FormData) {
    Object.entries(studioRoomMeasurementPayload).forEach(([key, value]) => {
      if (typeof value === "string" && value.trim()) {
        formData.append(key, value.trim());
      }
    });
  }

  /**
   * Generate the room.
   *
   * `modeOverride` exists because Surprise me starts generation in the same tap
   * that chooses the mode, and a `setState` has not landed by then — reading
   * `designMode` here would see the previous value.
   */
  /**
   * What the customer asked for, as types rather than regions.
   *
   * This is the ordinary path: the browser states the intent, and the server —
   * which is analysing the room regardless — decides which pieces that means.
   *
   * A simple category becomes one intent carrying its one product. Seating
   * becomes ONE intent per seating category carrying every bound piece —
   * kind, count and product — so the server can reconcile the whole desired
   * layout in one pass rather than being handed pieces one at a time with no
   * view of the total.
   */
  function buildCategoryIntents() {
    const simple = selectedCategories
      .filter((category) => !isSeatingCategory(roomType, category))
      .flatMap((category) => {
        const productId = chosenProductByCategory[category];
        if (!productId) return [];
        // Narrow to named pieces only where the customer explicitly did so.
        const sceneItemIds = roomSelections
          .filter(
            (selection) =>
              selection.canonicalCategory === category && selection.sceneItemId
          )
          .map((selection) => selection.sceneItemId as string);

        return [
          {
            canonicalCategory: category,
            productId,
            ...(sceneItemIds.length > 0 ? { sceneItemIds } : {}),
          },
        ];
      });

    const seating = selectedCategories
      .filter((category) => isSeatingCategory(roomType, category))
      .flatMap((category) => {
        const plan = categoryPlans[category];
        if (!plan) return [];
        /**
         * ONE ENTRY PER SLOT, each with `count: 1` — never one entry with
         * `count: 2`.
         *
         * The server flattens these into individual desired pieces in order,
         * so a per-slot list is what lets two 3-seaters be two DIFFERENT
         * sofas. Emitting `count: 2` against a single product would flatten to
         * the same thing for a matching pair, but it cannot represent a mixed
         * pair at all — so slots are always sent one at a time and the wire
         * shape has exactly one meaning.
         */
        const seatingSelection = seatingPlanSlots(plan)
          .map((slot) => {
            const productId = chosenSeatingProducts[slot.key];
            const product = productId
              ? allCatalogueProducts.find((p) => p.id === productId)
              : undefined;
            return productId && product
              ? {
                  kind: slot.kind,
                  count: 1,
                  productId,
                  productName: product.name,
                }
              : null;
          })
          .filter(
            (entry): entry is NonNullable<typeof entry> => entry !== null
          );
        if (seatingSelection.length === 0) return [];

        return [{ canonicalCategory: category, seatingSelection }];
      });

    return [...simple, ...seating];
  }

  async function handleGenerate(modeOverride?: DesignMode) {
    const mode = modeOverride ?? designMode;
    if (!image || !roomType || !selectedStylePrompt || !mode) return;

    const validationError = getRoomPhotoValidationError(image);

    if (validationError) {
      setError(validationError);
      return;
    }

    setError("");
    // Captured once and reused for both the elapsed clock and the remembered
    // job, so the processing screen and the resume record cannot disagree
    // about when this render began.
    const generationStart = nowMs();
    setLoading(true);
    setGenerationStartedAt(generationStart);
    setGenerationElapsedMs(0);
    setResumedGeneration(false);
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
      // In replace-items the products sent are exactly those the contract
      // assigns — not a loose basket for the pipeline to interpret.
      const contract = mode === "replace-items" ? buildContract() : null;
      // Surprise me sends the curated package chosen before this request; it is
      // the complete product set, so generation cannot reach past it into the
      // wider catalogue.
      // Surprise me lets the server choose the package from the analysed room;
      // the client sends no product set at all.
      const surpriseMe = mode === "surprise-me";
      const contractProductIdList = contract
        ? [...new Set(contract.assignments.map((a) => a.productId))]
        : selectedProductIds;

      formData.append(
        "selectedProductIds",
        JSON.stringify(contractProductIdList)
      );
      if (contract) {
        formData.append("replacementContract", JSON.stringify(contract));
      } else if (mode === "replace-items") {
        // No contract means nothing has analysed the room yet, which is the
        // normal case. Send the intent; the server resolves it.
        formData.append(
          "replaceCategories",
          JSON.stringify(buildCategoryIntents())
        );
        formData.append("sourceImageSize", JSON.stringify(sourceImageSize));
      }
      // Record the units this room needs before the request, so the basket is
      // correct even if the response is restored from cache later.
      setProductQuantities(
        Object.fromEntries(
          toPackageLines(replacementGroups).map((line) => [
            line.productId,
            line.quantity,
          ])
        )
      );
      // Superseded below by the server's counts when it resolved the intent —
      // it saw how many sofas the room has and the browser did not.

      if (surpriseMe) {
        formData.append("surpriseMe", "true");
        if (surpriseStyle) formData.append("surpriseStyle", surpriseStyle);
      }
      // The pipeline's wire contract is unchanged — the intent is translated to
      // the concept-mode flag at this boundary. `designMode` is sent alongside
      // for debugging and future use; the route ignores unknown fields.
      formData.append("aiConceptMode", String(designModeToConceptMode(mode)));
      formData.append("designMode", mode);
      if (style === "Custom") {
        formData.append("customPrompt", customPrompt.trim());
      }
      appendRoomMeasurements(formData);

      /**
       * Async generation.
       *
       * The request returns a job id in milliseconds and the render continues
       * server-side, so a refresh — or iOS Safari discarding a backgrounded
       * tab, which it does readily — no longer throws away a render the
       * customer has already waited minutes for.
       */
      const startResponse = await fetchStudioGemini(
        `${STUDIO_GEMINI_ROUTE}?async=1`,
        { method: "POST", body: formData }
      );
      const startData = await startResponse.json().catch(() => ({}));

      if (!startResponse.ok || typeof startData.jobId !== "string") {
        const reason =
          typeof startData.error === "string"
            ? startData.error
            : "Generation failed to start.";
        setError(reason);
        void logAiEvaluation(undefined, null, reason);
        return;
      }

      // Remembered BEFORE polling begins, so a refresh one second later can
      // still find the job. Only a durable job is remembered — see
      // readPendingJob: offering to resume one that cannot be found would
      // strand the customer on a screen that never resolves.
      if (startData.durable === true) {
        rememberPendingJob({
          jobId: startData.jobId,
          startedAt: generationStart,
          durable: true,
          roomType,
          designMode: mode,
        });
      }

      const finalStatus = await pollGenerationJob({ jobId: startData.jobId });
      forgetPendingJob();

      if (finalStatus.status !== "succeeded") {
        const reason =
          finalStatus.error ||
          (finalStatus.status === "unknown"
            ? "We lost track of this generation. Please try again."
            : "Generation failed.");
        setError(reason);
        void logAiEvaluation(undefined, null, reason);
        return;
      }

      // Shaped exactly as the synchronous response body was, so everything
      // downstream of here is untouched by the async change.
      const data = (finalStatus.result ?? {}) as {
        images?: unknown;
        imageBase64?: string;
        products?: Product[];
        aiDebug?: Record<string, unknown>;
        productQuantities?: unknown;
        [key: string]: unknown;
      };

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

      if (
        data.productQuantities &&
        typeof data.productQuantities === "object"
      ) {
        setProductQuantities(data.productQuantities as Record<string, number>);
      }

      setGeneratedConcepts(nextConcepts);
      setProducts(nextProducts);
      setSelectedConceptIndex(0);
      // A new primary result — open it at the top.
      setResultEpoch((epoch) => epoch + 1);
      setStep(4);
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
          : "Room generation failed. Please try again.";
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
      // A refined room is a new primary result; show it from the top.
      setResultEpoch((epoch) => epoch + 1);
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
          : "Room refinement failed. Please try again."
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
    setSelectedProductIds([]);
    setDesignMode(null);
    setRoomSelections([]);
    setChosenProductByCategory({});
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

  /**
   * "Replace items" — the customer picks furniture TYPES.
   *
   * Three phases: choose what to replace, choose the new pieces, and an
   * advanced picker that only appears if someone explicitly asks to single out
   * one piece. The room analysis stays invisible: no boxes, no dots, no labels
   * over the photo, no "Sofa 1 / Sofa 2" in the ordinary journey.
   */
  function renderReplaceItemsStep() {
    if (replacePhase === "seating") return renderSeatingStep();
    if (replacePhase === "products") return renderReplaceProductsStep();
    if (replacePhase === "precision") return renderPrecisionStep();

    return (
      <section className="space-y-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-[#9C9C94]">
            Replace items
          </p>
          <h1 className="mt-2 font-serif text-[26px] font-semibold leading-tight text-[#F5F3EE]">
            What would you like to change?
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#9a978f]">
            Tell us what you want your room to end up with. Anything you
            don&apos;t choose stays exactly as it is.
          </p>
        </div>

        {/* Context, not an interface: the photo carries no markings. */}
        {previewUrl && (
          <div className="v2-hero-shadow relative w-full overflow-hidden rounded-[22px] border border-white/10 bg-[#0B0B0B]">
            <img
              src={previewUrl}
              alt="Your room"
              className="h-[22vh] w-full object-cover object-center"
            />
          </div>
        )}

        <ReplaceCategoryPicker
          categories={menuCategories}
          selected={selectedCategories}
          unavailable={unavailableCategories}
          planSummaries={Object.fromEntries(
            Object.entries(categoryPlans).map(([category, plan]) => [
              category,
              plan ? describeSeatingPlan(plan) : "",
            ])
          )}
          onToggle={toggleCategory}
          onConfigure={(category) => {
            setSeatingCategory(category);
            setReplacePhase("seating");
          }}
          onRefine={(category) => {
            setPrecisionCategory(category);
            setReplacePhase("precision");
            // The ONE path that needs the room looked at before generating:
            // singling out a specific piece means naming it, and pieces only
            // have names once something has seen them.
            if (detectionState === "idle") void detectRoomObjects();
          }}
        />

        <button
          type="button"
          onClick={() => {
            setPrecisionCategory(null);
            setReplacePhase("precision");
            if (detectionState === "idle") void detectRoomObjects();
          }}
          className="w-full text-center text-xs font-semibold text-[#9a978f] underline underline-offset-4 transition hover:text-[#C9A57A]"
        >
          Something missing? Mark an area yourself
        </button>
      </section>
    );
  }

  /** "What should your seating be?" — the destination, not a swap. */
  function renderSeatingStep() {
    const category = seatingCategory;
    if (!category) return null;

    return (
      <section className="space-y-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-[#9C9C94]">
            Seating
          </p>
          <h1 className="mt-2 font-serif text-[26px] font-semibold leading-tight text-[#F5F3EE]">
            What should your seating be?
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#9a978f]">
            Tell us what you want the room to end up with — we&apos;ll work out
            what that means for what&apos;s there now.
          </p>
        </div>

        <SeatingPlanPicker
          plan={categoryPlans[category]}
          onChange={(plan) =>
            setCategoryPlans((current) => ({ ...current, [category]: plan }))
          }
        />
      </section>
    );
  }

  /** "What look are you after?" — the one question Surprise me asks. */
  function renderSurpriseStyleStep() {
    return (
      <section className="space-y-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-[#9C9C94]">
            Surprise me
          </p>
          <h1 className="mt-2 font-serif text-[26px] font-semibold leading-tight text-[#F5F3EE]">
            What look are you after?
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#9a978f]">
            One question, then we&apos;ll design the whole room for you.
          </p>
        </div>

        {previewUrl && (
          <div className="v2-hero-shadow relative w-full overflow-hidden rounded-[22px] border border-white/10 bg-[#0B0B0B]">
            <img
              src={previewUrl}
              alt="Your room"
              className="h-[18vh] w-full object-cover object-center"
            />
          </div>
        )}

        <SurpriseStylePicker
          selected={surpriseStyle}
          onSelect={setSurpriseStyle}
        />
      </section>
    );
  }

  /** "Choose your new pieces" — one visual shelf per chosen type. */
  function renderReplaceProductsStep() {
    // Named models, not shapes. "2 3-seater sofas" is true of a matching pair
    // and of two different sofas alike, so it is the wrong thing to confirm
    // against now that those are genuinely different orders.
    const seatingChoiceSummary = describeSeatingProducts(
      seatingSlotsByCategory.map(({ slot }) => slot),
      (key) => {
        const productId = chosenSeatingProducts[key];
        const product = productId
          ? allCatalogueProducts.find((p) => p.id === productId)
          : undefined;
        return product ? getShortProductName(product) : undefined;
      }
    );

    return (
      <section className="space-y-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-[#9C9C94]">
            Replace items
          </p>
          <h1 className="mt-2 font-serif text-[26px] font-semibold leading-tight text-[#F5F3EE]">
            Choose your new pieces
          </h1>
          {seatingSlotsByCategory.length > 0 && (
            <p className="mt-2 text-sm leading-6 text-[#9a978f]">
              {seatingChoiceSummary ? (
                <>
                  Your seating:{" "}
                  <span className="text-[#F5F3EE]">{seatingChoiceSummary}</span>
                  {unfilledSeatingSlots > 0 && (
                    <>
                      {" "}
                      — {unfilledSeatingSlots} still to choose.
                    </>
                  )}
                  {unfilledSeatingSlots === 0 && "."}
                </>
              ) : (
                <>
                  Pick a sofa for each of your {seatingSlotsByCategory.length}{" "}
                  seating pieces. They can be the same model or different ones.
                </>
              )}
            </p>
          )}
        </div>

        <CategoryProductShelves
          categories={shelfCategories}
          catalogue={allCatalogueProducts}
          // Seating products are keyed by piece kind, everything else by
          // canonical category — the two maps never share a key, so they can
          // sit side by side here without colliding.
          chosenByCategory={{
            ...chosenProductByCategory,
            ...chosenSeatingProducts,
          }}
          // Without an analysis the counts describe the layout the customer
          // asked for, not the room we looked at.
          countsAreFromRoom={hasDetections}
          onChoose={chooseProductForShelf}
        />
      </section>
    );
  }

  /**
   * Advanced picker — deliberately off the main path. Reached only by asking
   * for a specific piece, or by marking an area by hand.
   */
  function renderPrecisionStep() {
    return (
      <section className="flex flex-1 flex-col justify-center space-y-2.5">
        <h1 className="font-serif text-[22px] font-semibold leading-tight text-[#F5F3EE]">
          {precisionCategory
            ? `Which ${displayCategoryName(precisionCategory).toLowerCase()}?`
            : "Mark the area to replace"}
        </h1>

        {previewUrl && (
          <RoomObjectSelector
            imageUrl={previewUrl}
            objects={
              precisionCategory
                ? detectedObjects.filter(
                    (object) => object.canonicalCategory === precisionCategory
                  )
                : detectedObjects
            }
            selections={roomSelections}
            onSelectionsChange={setRoomSelections}
            sourceImage={sourceImageSize}
            detectionState={detectionState}
          />
        )}
      </section>
    );
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

    // The fork. Two genuinely different jobs, presented as a real choice
    // rather than a setting with a default.
    if (step === 2) {
      return (
        <section className="flex flex-1 flex-col justify-center space-y-4 py-1">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-[#9C9C94]">
              What would you like to do?
            </p>
            <h1 className="mt-2 font-serif text-[28px] font-semibold leading-tight text-[#F5F3EE]">
              Two ways to design
            </h1>
          </div>

          <DesignModeCard
            title="Replace items"
            description="Choose exactly what you want to change."
            selected={designMode === "replace-items"}
            onClick={() => {
              // No analysis here. The list of things you can replace is known
              // from the room type, so it appears instantly; the room is only
              // looked at once the customer has said what they want.
              setDesignMode("replace-items");
              setReplacePhase("categories");
              setStep(3);
            }}
            preview={previewUrl}
            accent="Your choice"
          />

          <DesignModeCard
            title="Surprise me"
            description="Let Koala create a complete look for your room."
            selected={designMode === "surprise-me"}
            onClick={() => {
              // One question — the look — and then the room is designed. The
              // package itself is still chosen server-side and never shown for
              // approval: being asked to sign off a package is the opposite of
              // being surprised.
              setDesignMode("surprise-me");
              setStep(3);
            }}
            preview={previewUrl}
            accent="Koala designs it"
          />
        </section>
      );
    }

    if (step === 3 && designMode === "replace-items") {
      return renderReplaceItemsStep();
    }

    if (step === 3 && designMode === "surprise-me") {
      return renderSurpriseStyleStep();
    }

    if (step === 3) return null;

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
              onClick: () => void handleGenerate(),
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

            {/*
              Honest waiting copy. A render is 2-3 minutes, so a step counter
              that finishes long before the image does reads as a stall. The
              elapsed time is true, keeps moving, and sets the expectation the
              wait actually needs.
            */}
            <p className="mt-5 text-sm font-medium text-[#F5F3EE]">
              {refining
                ? "Updating your room"
                : resumedGeneration
                  ? "Still creating your Koala look"
                  : "Creating your Koala look"}
            </p>
            <p className="mt-1 text-xs leading-5 text-[#9C9C94]">
              {resumedGeneration
                ? "We picked this back up where you left off — it can take a couple of minutes."
                : "This can take a couple of minutes."}
            </p>
            {generationStartedAt !== null && (
              <p className="mt-2 text-[11px] tabular-nums tracking-[0.14em] text-[#6f6d67]">
                {formatElapsed(generationElapsedMs)} elapsed
              </p>
            )}
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
            step === 4
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
              className={step === 4 ? "h-auto w-24" : "h-auto w-28"}
            />
            <button
              type="button"
              onClick={resetWizard}
              className="rounded-full border border-white/15 bg-white/[0.05] px-4 py-1.5 text-xs font-medium text-[#F5F3EE] shadow-sm transition hover:border-white/25 hover:bg-white/10"
            >
              {step === 4 ? "New room" : "Reset"}
            </button>
          </div>
          <div
            className={`flex items-end gap-2 ${step === 4 ? "mt-3" : "mt-5"}`}
          >
            {[
              { n: 1, label: "Capture" },
              { n: 2, label: "Choose" },
              { n: 3, label: "Design" },
              { n: 4, label: "Shop" },
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
          ref={scrollContainerRef}
          // Scroll anchoring would re-adjust the offset as images decode,
          // undoing the reset a frame or two later.
          style={{ overflowAnchor: "none" }}
          className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${
            step === 4
              ? "px-5 pb-6 pt-4"
              : step === 1
                ? "px-6 pb-4 pt-4"
                : // The object-selection step is a single non-scrolling screen,
                  // so it keeps only enough bottom padding to clear the sticky
                  // footer. The generous padding below is for steps that scroll.
                  designMode === "replace-items" &&
                    replacePhase === "precision" &&
                    step === 3
                  ? "px-6 pb-4 pt-3"
                  : "px-6 pb-32 pt-4"
          }`}
        >
          {/* min-h-full lets a short step (the choice screen) centre itself
              vertically, while taller steps still grow and scroll normally. */}
          <div
            key={screenKey}
            className="flex min-h-full flex-col animate-[stepIn_360ms_ease-out]"
          >
            {renderStep()}
          </div>

          {error && (
            <p className="mt-4 rounded-2xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
              {error}
            </p>
          )}
        </div>

        {step !== 4 && (
          <footer
            className={`sticky bottom-0 z-40 grid shrink-0 gap-3 border-t border-white/10 bg-[#0b0b0d]/90 px-6 pb-[calc(env(safe-area-inset-bottom)_+_20px)] pt-4 backdrop-blur ${
              step === 1 ? "grid-cols-1" : "grid-cols-[auto_1fr]"
            }`}
          >
            {step > 1 && (
              <StudioButton
                variant="ghost"
                onClick={() => {
                  // Inside replace-items, Back steps between its two phases
                  // before it leaves the flow.
                  if (step === 3 && designMode === "replace-items") {
                    if (replacePhase === "products") {
                      setReplacePhase("categories");
                      return;
                    }
                    if (replacePhase === "seating") {
                      setSeatingCategory(null);
                      setReplacePhase("categories");
                      return;
                    }
                    if (replacePhase === "precision") {
                      // Leaving the advanced picker discards its narrowing so
                      // the type-level choice is what applies again.
                      setRoomSelections([]);
                      setPrecisionCategory(null);
                      setReplacePhase("categories");
                      return;
                    }
                  }
                  if (step === 3) {
                    // Leaving a flow clears its intent so the choice screen is
                    // a genuine fork rather than a remembered setting.
                    setDesignMode(null);
                    setRoomSelections([]);
                    setChosenProductByCategory({});
                    setChosenSeatingProducts({});
                    setSelectedCategories([]);
                    setPrecisionCategory(null);
                    setSeatingCategory(null);
                    setCategoryPlans({});
                    setSurpriseStyle(null);
                    setReplacePhase("categories");
                  }
                  setStep(step - 1);
                }}
                disabled={loading || refining}
                className="min-w-20 rounded-2xl"
              >
                Back
              </StudioButton>
            )}
            {step === 1 && (
              <StudioButton
                onClick={() => setStep(2)}
                disabled={!canContinue()}
                className="min-h-14 rounded-2xl text-base"
              >
                Continue
              </StudioButton>
            )}
            {/* Choose what to replace, then what to replace it with. */}
            {step === 3 &&
              designMode === "replace-items" &&
              replacePhase === "categories" && (
                <StudioButton
                  onClick={() => setReplacePhase("products")}
                  disabled={selectedCategories.length === 0}
                  className="min-h-14 rounded-2xl text-base"
                >
                  {selectedCategories.length === 0
                    ? "Choose what to replace"
                    : `Continue with ${selectedCategories.length}`}
                </StudioButton>
              )}
            {step === 3 &&
              designMode === "replace-items" &&
              replacePhase === "seating" && (
                <StudioButton
                  onClick={() => {
                    // Confirming the plan is what selects the category — the
                    // tick and the arrangement are one decision.
                    if (seatingCategory && !selectedCategories.includes(seatingCategory)) {
                      toggleCategory(seatingCategory);
                    }
                    setSeatingCategory(null);
                    setReplacePhase("categories");
                  }}
                  disabled={
                    !seatingCategory ||
                    !categoryPlans[seatingCategory] ||
                    !isValidSeatingPlan(categoryPlans[seatingCategory]!)
                  }
                  className="min-h-14 rounded-2xl text-base"
                >
                  {seatingCategory &&
                  categoryPlans[seatingCategory] &&
                  isValidSeatingPlan(categoryPlans[seatingCategory]!)
                    ? "Confirm seating"
                    : "Choose at least one piece"}
                </StudioButton>
              )}
            {step === 3 && designMode === "surprise-me" && (
              <StudioButton
                onClick={() => void handleGenerate("surprise-me")}
                disabled={!surpriseStyle || loading}
                className="min-h-14 rounded-2xl text-base"
              >
                {loading
                  ? "Designing..."
                  : surpriseStyle
                    ? "Design my room"
                    : "Choose a look"}
              </StudioButton>
            )}
            {step === 3 &&
              designMode === "replace-items" &&
              replacePhase === "precision" && (
                <StudioButton
                  onClick={() => setReplacePhase("products")}
                  disabled={roomSelections.length === 0}
                  className="min-h-14 rounded-2xl text-base"
                >
                  {roomSelections.length === 0
                    ? "Choose a piece"
                    : `Continue with ${roomSelections.length}`}
                </StudioButton>
              )}
            {step === 3 &&
              designMode === "replace-items" &&
              replacePhase === "products" && (
                <StudioButton
                  onClick={() => void handleGenerate()}
                  disabled={!canGenerateConcept() || loading}
                  className="min-h-14 rounded-2xl text-base"
                >
                  {loading
                    ? "Generating..."
                    : // Naming what is missing, rather than a dead button the
                      // customer has to work out for themselves.
                      unfilledShelfCount > 0
                      ? `Choose ${unfilledShelfCount} more ${unfilledShelfCount > 1 ? "pieces" : "piece"}`
                      : "Generate my room"}
                </StudioButton>
              )}
          </footer>
        )}
      </div>
    </main>
  );
}
