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
  formatPrice,
  getCategoryLabel,
  getProductsFromIds,
  getProductUrl,
  getShortProductName,
  mergeUniqueProducts,
  productsByCategory,
} from "@/features/room-stylist/services/product-helpers";
import {
  trackAddToCartClicked,
  trackBundleAddToCartClicked,
  trackDownloadClicked,
  trackFullscreenProviderViewed,
  trackGenerateCompleted,
  trackGenerateStarted,
  trackGeneratedProviderCount,
  trackRefineCompleted,
  trackRefineStarted,
  trackResultProviderSwiped,
  trackResultProviderViewed,
  trackShareClicked,
} from "@/features/room-stylist/services/analytics-events";
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
  "Analysing room layout",
  "Matching Koala products",
  "Creating design concept",
  "Rendering final image",
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

function RoomTypeIcon({
  type,
  selected,
}: {
  type: string;
  selected: boolean;
}) {
  const stroke = selected ? "#F7F7F2" : "#F7F7F2";
  const commonProps = {
    fill: "none",
    stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };

  if (type === "dining room") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true" className="h-11 w-11">
        <path {...commonProps} d="M13 20h22M16 20l-3 18M32 20l3 18" />
        <path {...commonProps} d="M18 13h12M18 13v7M30 13v7" />
        <path {...commonProps} d="M10 28h9M29 28h9M13 28v10M35 28v10" />
      </svg>
    );
  }

  if (type === "bedroom") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true" className="h-11 w-11">
        <path {...commonProps} d="M9 18v20M39 25v13M9 28h30" />
        <path {...commonProps} d="M12 18h12v10H12zM24 22h11a4 4 0 0 1 4 4v2" />
        <path {...commonProps} d="M9 38h30" />
      </svg>
    );
  }

  if (type === "office") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true" className="h-11 w-11">
        <path {...commonProps} d="M11 20h26v7H11zM15 27v11M33 27v11" />
        <path {...commonProps} d="M18 14h12a4 4 0 0 1 4 4v2H14v-2a4 4 0 0 1 4-4z" />
        <path {...commonProps} d="M20 38h8M24 27v11" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="h-11 w-11">
      <path {...commonProps} d="M12 25v-5a5 5 0 0 1 5-5h14a5 5 0 0 1 5 5v5" />
      <path {...commonProps} d="M10 25h28a3 3 0 0 1 3 3v10H7V28a3 3 0 0 1 3-3z" />
      <path {...commonProps} d="M12 38v3M36 38v3M17 25v-4h14v4" />
    </svg>
  );
}

function RoomTypePreview({
  item,
  selected,
}: {
  item: (typeof roomTypes)[number];
  selected: boolean;
}) {
  return (
    <span className="relative block h-28 overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[#111111]">
      <span className="absolute inset-0" style={{ background: item.visual }} />
      <span className="absolute inset-0 backdrop-blur-[1px]" />
      <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent_42%,rgba(5,5,5,0.76))]" />
      <span className="absolute inset-x-5 bottom-5 h-px bg-white/20" />
      <span
        className={`absolute right-3 top-3 flex h-12 w-12 items-center justify-center rounded-2xl border backdrop-blur-md ${
          selected
            ? "border-[#F4C430]/70 bg-[#050505]/72"
            : "border-[#F7F7F2]/10 bg-[#050505]/52"
        }`}
      >
        <RoomTypeIcon type={item.id} selected={selected} />
      </span>
    </span>
  );
}

function StyleVisualPreview({
  visual,
  selected,
}: {
  visual: string;
  selected: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`relative block h-32 overflow-hidden rounded-2xl border ${
        selected ? "border-[#F4C430]/60" : "border-[rgba(255,255,255,0.12)]"
      }`}
      style={{ background: visual }}
    >
      <span className="absolute inset-0 backdrop-blur-[1px]" />
      <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),transparent_38%,rgba(5,5,5,0.72))]" />
      <span className="absolute inset-x-5 bottom-5 h-px bg-white/20" />
      <span className="absolute left-5 top-5 h-2 w-16 rounded-full bg-white/15" />
    </span>
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
        onToggle();
      }}
      className={`relative flex h-[218px] min-w-0 flex-col overflow-hidden rounded-2xl border bg-[#111111] p-2.5 text-left transition ${
        selected
          ? "border-[#F4C430]/55 bg-[#181818]"
          : "border-[rgba(255,255,255,0.12)] hover:border-white/25"
      }`}
    >
      <ProductImage
        product={product}
        className="h-28 w-full rounded-xl object-cover"
        placeholderClassName="h-28 w-full rounded-xl"
      />
      <div className="flex min-h-0 flex-1 flex-col pt-2">
        <p className="line-clamp-2 min-h-9 break-words text-xs font-semibold leading-snug text-[#F7F7F2]">
          {getShortProductName(product)}
        </p>
        <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
          <p className="truncate text-[11px] uppercase tracking-[0.14em] text-[#9C9C94]">
            {getCategoryLabel(product.category)}
          </p>
          {selected && (
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#F4C430]/90">
              SELECTED
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function ResultIconButton({
  label,
  icon,
  onClick,
  variant = "default",
  compact = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "primary" | "danger";
  compact?: boolean;
}) {
  const variantClassName =
    variant === "primary"
      ? "border-white/25 bg-[#181818] text-[#F7F7F2] hover:border-white/40 hover:bg-[#111111]"
      : variant === "danger"
        ? "border-[rgba(255,255,255,0.12)] bg-[#111111] text-[#9C9C94] hover:border-white/25 hover:text-[#F7F7F2]"
        : "border-[rgba(255,255,255,0.12)] bg-[#111111] text-[#F7F7F2] hover:border-white/25 hover:bg-[#181818]";
  const iconClassName =
    variant === "danger"
      ? "border border-[rgba(255,255,255,0.12)] bg-[#050505] text-[#9C9C94]"
      : variant === "primary"
        ? "bg-[#F7F7F2] text-[#050505]"
        : "border border-[rgba(255,255,255,0.12)] bg-[#050505] text-[#F7F7F2]";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-0 flex-col items-center rounded-2xl border text-center transition ${variantClassName} ${
        compact ? "gap-1.5 px-2 py-2.5" : "gap-2 px-3 py-4"
      }`}
    >
      <span
        className={`flex items-center justify-center rounded-xl ${iconClassName} ${
          compact ? "h-8 w-8" : "h-9 w-9"
        }`}
      >
        {icon}
      </span>
      <span className={compact ? "text-[10px] font-semibold" : "text-xs font-semibold"}>
        {label}
      </span>
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
          className="mt-4 min-h-28 w-full rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#111111] p-4 text-sm text-[#F7F7F2] outline-none focus:border-[#F4C430]"
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
  const [roomType, setRoomType] = useState("");
  const [style, setStyle] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [letAiRecommendBundle, setLetAiRecommendBundle] = useState(true);
  const [openProductCategoryId, setOpenProductCategoryId] = useState<
    string | null
  >(null);
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
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const resultSwipeStartXRef = useRef<number | null>(null);
  const suppressResultViewerOpenRef = useRef(false);
  const [loadingIndex, resetLoadingIndex] = useProgressIndex(
    loading || refining,
    loadingMessages.length,
    2600
  );
  const selectedProducts = selectedIdsToProducts(selectedProductIds);
  const activeConcept = generatedConcepts[selectedConceptIndex] || null;
  const activeImage = activeConcept?.imageBase64 || "";
  const selectedStylePrompt = getStylePrompt(style, customPrompt);

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

        if (cachedConcepts.length > 0) {
          setSelectedConceptIndex(0);
          setStep(5);
        }
      }, 0);

      return () => window.clearTimeout(timeout);
    } catch {
      localStorage.removeItem(CACHE_KEY);
    }
  }, []);

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
    if (step === 1) return Boolean(image && previewUrl);
    if (step === 2) return Boolean(roomType);
    if (step === 3) {
      return style === "Custom" ? Boolean(customPrompt.trim()) : Boolean(style);
    }
    if (step === 4) return letAiRecommendBundle || selectedProductIds.length > 0;
    return generatedConcepts.length > 0;
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
        setError(typeof data.error === "string" ? data.error : "Generation failed.");
        return;
      }

      const nextConcepts = normalizeStudioGeminiConcepts(
        data.images,
        data.imageBase64
      );
      const nextProducts = (data.products || []) as Product[];

      if (nextConcepts.length === 0) {
        setError("Generation completed but no image was returned.");
        return;
      }

      setGeneratedConcepts(nextConcepts);
      setProducts(nextProducts);
      setSelectedConceptIndex(0);
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
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Gemini generation failed. Please try again."
      );
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
    setRoomType("");
    setStyle("");
    setCustomPrompt("");
    setSelectedProductIds([]);
    setLetAiRecommendBundle(true);
    setOpenProductCategoryId(null);
    setGeneratedConcepts([]);
    setProducts([]);
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
        <section className="space-y-4">
          <div className="rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#111111] p-5 shadow-2xl">
            <p className="text-xs uppercase tracking-[0.28em] text-[#9C9C94]">
              Upload Room Photo
            </p>
            <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight">
              Start with your actual room
            </h1>
            <p className="mt-3 text-sm leading-6 text-[#9C9C94]">
              Take a fresh photo or choose one from your gallery. iPhone HEIC
              photos will be converted when the browser supports it.
            </p>

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
              <div className="mt-5 overflow-hidden rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#050505] shadow-inner">
                <img
                  src={previewUrl}
                  alt="Uploaded room preview"
                  className="max-h-[52vh] w-full object-contain"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="mt-5 flex aspect-[4/5] w-full flex-col items-center justify-center rounded-3xl border border-dashed border-[rgba(255,255,255,0.12)] bg-[#111111] p-5 text-center transition hover:border-[#F4C430] hover:bg-[#181818]"
              >
                <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[rgba(255,255,255,0.12)] bg-[#050505] text-2xl text-[#F4C430]">
                  +
                </span>
                <span className="mt-5 text-base font-semibold text-[#F7F7F2]">
                  Add your room photo
                </span>
                <span className="mt-2 max-w-56 text-sm leading-6 text-[#9C9C94]">
                  Use a clear, wide shot facing the main wall or seating area.
                </span>
              </button>
            )}

            <div className="mt-5 grid grid-cols-2 gap-4">
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
        </section>
      );
    }

    if (step === 2) {
      return (
        <section className="rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#111111] p-5 shadow-2xl">
          <p className="text-xs uppercase tracking-[0.28em] text-[#9C9C94]">
            Select Room Type
          </p>
          <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight">
            What are we styling?
          </h1>

          <div className="mt-5 grid grid-cols-2 gap-4">
            {roomTypes.map((item) => {
              const selected = roomType === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setRoomType(item.id)}
                  className={`min-h-44 rounded-3xl border p-3 text-left transition ${
                    selected
                      ? "border-[#F4C430]/55 bg-[#181818] text-[#F7F7F2]"
                      : "border-[rgba(255,255,255,0.12)] bg-[#111111] text-[#F7F7F2]"
                  }`}
                >
                  <RoomTypePreview item={item} selected={selected} />
                  <span className="mt-4 block px-2 text-sm font-semibold">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      );
    }

    if (step === 3) {
      return (
        <section className="rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#111111] p-5 shadow-2xl">
          <p className="text-xs uppercase tracking-[0.28em] text-[#9C9C94]">
            Select Design Style
          </p>
          <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight">
            Choose the mood
          </h1>

          <div className="mt-5 grid gap-4">
            {designStyles.map((item) => {
              const selected = style === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setStyle(item.id)}
                  className={`grid gap-4 rounded-3xl border p-4 text-left transition ${
                    selected
                      ? "border-[#F4C430]/55 bg-[#181818] text-[#F7F7F2]"
                      : "border-[rgba(255,255,255,0.12)] bg-[#111111] text-[#F7F7F2]"
                  }`}
                >
                  <StyleVisualPreview visual={item.visual} selected={selected} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">
                      {item.title}
                    </span>
                    <span className="mt-2 block text-xs leading-5 text-[#9C9C94]">
                      {item.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {style === "Custom" && (
            <textarea
              value={customPrompt}
              onChange={(event) => setCustomPrompt(event.target.value)}
              placeholder="Describe the mood, colours, materials or layout you want..."
              className="mt-4 min-h-28 w-full rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#111111] p-4 text-sm text-[#F7F7F2] outline-none focus:border-[#F4C430]"
            />
          )}
        </section>
      );
    }

    if (step === 4) {
      return (
        <section className="space-y-4">
          <div className="rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#111111] p-5 shadow-2xl">
            <p className="text-xs uppercase tracking-[0.28em] text-[#9C9C94]">
              Select Koala Products
            </p>
            <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight">
              Anchor the concept
            </h1>

            <button
              type="button"
              onClick={() => setLetAiRecommendBundle((current) => !current)}
              className={`mt-5 flex w-full items-center justify-between rounded-xl border p-4 text-left ${
                letAiRecommendBundle
                  ? "border-[#F4C430]/55 bg-[#181818] text-[#F7F7F2]"
                  : "border-[rgba(255,255,255,0.12)] bg-[#111111] text-[#F7F7F2]"
              }`}
            >
              <span>
                <span className="block text-sm font-semibold">
                  AI concept mode
                </span>
                <span className="mt-1 block text-xs opacity-70">
                  {letAiRecommendBundle
                    ? "AI can complete the room using matching Koala products."
                    : "Only selected products will be changed."}
                </span>
              </span>
              <span>{letAiRecommendBundle ? "On" : "Off"}</span>
            </button>

            {selectedProducts.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedSheetOpen(true)}
                className="sticky top-3 z-10 mt-4 flex w-full items-center justify-between rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#050505]/95 px-4 py-3 text-sm font-semibold shadow-2xl backdrop-blur"
              >
                <span>{selectedProducts.length} products selected</span>
                <span className="rounded-xl bg-[#F7F7F2] px-3 py-1 text-xs text-[#050505]">
                  View
                </span>
              </button>
            )}

            <div className="mt-4 grid gap-4">
              {productsByCategory.map((category) => {
                const isOpen = openProductCategoryId === category.id;

                return (
                  <section
                    key={category.id}
                    className="overflow-hidden rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#111111]"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setOpenProductCategoryId((current) =>
                          current === category.id ? null : category.id
                        )
                      }
                      className="flex w-full items-center justify-between p-4 text-left"
                    >
                      <span className="text-xs font-semibold uppercase tracking-widest text-[#9C9C94]">
                        {category.label}
                      </span>
                      <span className="text-xs text-[#9C9C94]">
                        {
                          category.products.filter((product) =>
                            selectedProductIds.includes(product.id)
                          ).length
                        }
                        /{category.products.length} {isOpen ? "-" : "+"}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="grid grid-cols-2 gap-3 px-3 pb-3">
                        {category.products.map((product) => (
                          <StudioProductCard
                            key={product.id}
                            product={product}
                            selected={selectedProductIds.includes(product.id)}
                            onToggle={() => toggleProduct(product.id)}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="space-y-4">
        {activeImage ? (
          <>
            <div
              className="relative aspect-[4/5] max-h-[46vh] w-full overflow-hidden rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#111111] shadow-2xl"
              onTouchStart={(event) => {
                if (
                  generatedConcepts.length < 2 ||
                  event.touches.length !== 1
                ) {
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
                  typeof endX === "number"
                    ? endX - resultSwipeStartXRef.current
                    : 0;

                resultSwipeStartXRef.current = null;

                if (Math.abs(deltaX) < 48) return;

                suppressResultViewerOpenRef.current = true;
                window.setTimeout(() => {
                  suppressResultViewerOpenRef.current = false;
                }, 500);
                selectAdjacentConcept(
                  deltaX < 0 ? 1 : -1,
                  "swipe",
                  "result"
                );
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
                  src={`data:${activeConcept?.mimeType || "image/png"};base64,${activeImage}`}
                  alt={`Generated concept ${selectedConceptIndex + 1}`}
                  className="h-full w-full object-contain object-center"
                />
              </button>

              {activeConcept && (
                <span className="pointer-events-none absolute right-3 top-3 rounded-full border border-white/15 bg-[#050505]/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#F7F7F2] backdrop-blur">
                  {activeConcept.label}
                </span>
              )}

              {generatedConcepts.length > 1 && selectedConceptIndex > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    selectAdjacentConcept(-1, "arrow", "result")
                  }
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
                    onClick={() =>
                      selectAdjacentConcept(1, "arrow", "result")
                    }
                    aria-label="Next generated concept"
                    className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[#050505]/70 text-[#F7F7F2] backdrop-blur"
                  >
                    <ChevronIcon direction="right" />
                  </button>
                )}
            </div>

            <StudioButton
              onClick={() => trackBundleAddToCartClicked(products)}
              className="min-h-12 w-full rounded-xl text-base"
            >
              Prepare room package
            </StudioButton>

            {generatedConcepts.length > 1 && (
              <div className="flex items-center justify-center gap-2">
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
                    aria-current={
                      selectedConceptIndex === index ? "true" : undefined
                    }
                    className={`h-1.5 rounded-full transition-all ${
                      selectedConceptIndex === index
                        ? "w-5 bg-[#F7F7F2]"
                        : "w-1.5 bg-white/35"
                    }`}
                  />
                ))}
              </div>
            )}

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <ResultIconButton
                  label="Edit with AI"
                  icon={<AiEditIcon />}
                  onClick={() => setRefineSheetOpen(true)}
                  variant="primary"
                  compact
                />
                <ResultIconButton
                  label="Regenerate"
                  icon={<RegenerateIcon />}
                  onClick={handleGenerate}
                  compact
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <ResultIconButton
                  label="Save"
                  icon={<SaveIcon />}
                  onClick={downloadImage}
                  compact
                />
                <ResultIconButton
                  label="Share"
                  icon={<ShareIcon />}
                  onClick={shareImage}
                  compact
                />
                <ResultIconButton
                  label="Delete"
                  icon={<DeleteIcon />}
                  onClick={deleteResult}
                  variant="danger"
                  compact
                />
              </div>
            </div>

            {products.length > 0 && (
              <section className="rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#111111] p-5 shadow-2xl">
                <p className="text-xs uppercase tracking-[0.28em] text-[#9C9C94]">
                  Complete the look
                </p>
                <h2 className="mt-2 font-serif text-2xl">Products in this room</h2>
                <div className="mt-4 grid gap-4">
                  {products.slice(0, 4).map((product) => {
                    const productUrl = getProductUrl(product);

                    return (
                      <article
                        key={product.id}
                        className="flex min-h-32 gap-4 rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[#111111] p-3"
                      >
                        <ProductImage
                          product={product}
                          className="h-20 w-20 shrink-0 rounded-xl object-cover"
                          placeholderClassName="h-20 w-20 shrink-0 rounded-xl"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-semibold">
                            {product.name}
                          </p>
                          <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[#9C9C94]">
                            {getCategoryLabel(product.category)}
                          </p>
                          <p className="mt-1 text-xs text-[#9C9C94]">
                            {formatPrice(product.price)}
                          </p>
                          <div className="mt-2 flex gap-2">
                            {productUrl ? (
                              <a
                                href={productUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={() => trackAddToCartClicked(product)}
                                className="rounded-xl bg-[#F7F7F2] px-3 py-1 text-xs font-semibold text-[#050505]"
                              >
                                View product
                              </a>
                            ) : (
                              <span className="rounded-xl border border-[rgba(255,255,255,0.12)] px-3 py-1 text-xs text-[#9C9C94]">
                                Available in store
                              </span>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        ) : (
          <section className="rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#111111] p-5">
            <p className="text-xs uppercase tracking-[0.28em] text-[#9C9C94]">
              Generate / Result
            </p>
            <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight">
              Ready to render
            </h1>
            <p className="mt-3 text-sm leading-6 text-[#9C9C94]">
              The studio will create one pilot concept using your room, style
              and product references.
            </p>
          </section>
        )}
      </section>
    );
  }

  return (
    <main className="h-dvh overflow-hidden bg-[#050505] text-[#F7F7F2]">
      {(loading || refining) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#050505]/95 p-6">
          <div className="w-full max-w-sm rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#111111] p-5 text-center shadow-2xl">
            <p className="text-xs uppercase tracking-[0.28em] text-[#9C9C94]">
              Koala AI Studio
            </p>
            <h2 className="mt-3 font-serif text-3xl font-semibold leading-tight">
              {loadingMessages[loadingIndex]}
            </h2>
            <div className="mt-6 grid gap-4 text-left">
              {loadingMessages.map((message, index) => (
                <div key={message} className="grid gap-2">
                  <div className="flex items-center justify-between gap-4">
                    <span
                      className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                        index <= loadingIndex
                          ? "text-[#F7F7F2]"
                          : "text-[#9C9C94]"
                      }`}
                    >
                      Step {index + 1}
                    </span>
                    <span
                      className={`text-xs ${
                        index <= loadingIndex
                          ? "text-[#F7F7F2]"
                          : "text-[#9C9C94]"
                      }`}
                    >
                      {message}
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.12)]">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        index < loadingIndex
                          ? "w-full bg-[#F4C430]"
                          : index === loadingIndex
                            ? "w-2/3 bg-[#F4C430]"
                            : "w-0 bg-[#F4C430]"
                      }`}
                    />
                  </div>
                </div>
              ))}
            </div>
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

      <div className="mx-auto flex h-dvh w-full max-w-[430px] flex-col overflow-hidden bg-[#050505] px-6 pt-6">
        <header className="mb-4 shrink-0 rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#111111]/80 p-5 shadow-2xl">
          <div className="flex items-center justify-between gap-4">
            <Image
              src="/koala-logo.png"
              alt="Koala Living"
              width={150}
              height={65}
              priority
              className="h-auto w-28"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetWizard}
                className="rounded-xl border border-[rgba(255,255,255,0.12)] px-3 py-1 text-xs text-[#F7F7F2] transition hover:bg-[#181818]"
              >
                Reset
              </button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-5 gap-1">
            {[1, 2, 3, 4, 5].map((item) => (
              <div
                key={item}
                className={`h-1 rounded-full ${
                  item <= step ? "bg-[#F4C430]" : "bg-[rgba(255,255,255,0.12)]"
                }`}
              />
            ))}
          </div>
        </header>

        <div
          className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden transition-all duration-300 ${
            step === 5 && activeImage ? "pb-8" : "pb-32"
          }`}
        >
          {renderStep()}

          {error && (
            <p className="mt-4 rounded-2xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
              {error}
            </p>
          )}
        </div>

        {!(step === 5 && activeImage) && (
          <footer
            className={`sticky bottom-0 z-40 grid shrink-0 gap-4 border-t border-[rgba(255,255,255,0.12)] bg-[#050505]/95 pb-[calc(env(safe-area-inset-bottom)_+_24px)] pt-4 shadow-2xl backdrop-blur ${
              step === 1 ? "grid-cols-1" : "grid-cols-[auto_1fr]"
            }`}
          >
            {step > 1 && (
              <StudioButton
                variant="ghost"
                onClick={() => setStep((current) => Math.max(current - 1, 1))}
                disabled={loading || refining}
                className="min-w-24 rounded-xl"
              >
                Back
              </StudioButton>
            )}
            {step < 5 ? (
              <StudioButton
                onClick={() => setStep((current) => Math.min(current + 1, 5))}
                disabled={!canContinue()}
                className="min-h-14 rounded-xl text-base"
              >
                Continue
              </StudioButton>
            ) : (
              <StudioButton
                onClick={handleGenerate}
                disabled={!canGenerateConcept() || loading}
                className="min-h-14 rounded-xl text-base"
              >
                {loading ? "Generating..." : "Generate concept"}
              </StudioButton>
            )}
          </footer>
        )}
      </div>
    </main>
  );
}
