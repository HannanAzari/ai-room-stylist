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
  trackGenerateCompleted,
  trackGenerateStarted,
  trackRefineCompleted,
  trackRefineStarted,
  trackShareClicked,
} from "@/features/room-stylist/services/analytics-events";
import type { Product } from "@/features/room-stylist/types";

const CACHE_KEY = "ai-room-stylist:last-result";
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

function formatRoomType(roomType: string) {
  return roomTypes.find((item) => item.id === roomType)?.label.toLowerCase() ||
    "room";
}

function formatStyleName(style: string, customPrompt: string) {
  if (style === "Custom" && customPrompt.trim()) return "custom design";

  return designStyles.find((item) => item.id === style)?.title || "selected";
}

function buildWhyDesignWorksBullets({
  roomType,
  style,
  customPrompt,
  selectedProducts,
}: {
  roomType: string;
  style: string;
  customPrompt: string;
  selectedProducts: Product[];
}) {
  const roomLabel = formatRoomType(roomType);
  const styleLabel = formatStyleName(style, customPrompt);
  const primaryProduct = selectedProducts[0];
  const primaryCategory = primaryProduct
    ? getCategoryLabel(primaryProduct.category).toLowerCase()
    : "";
  const productCount = selectedProducts.length;
  const bullets: string[] = [];

  if (primaryProduct) {
    bullets.push(
      `The selected ${primaryCategory || "product"} anchors the ${roomLabel} layout.`
    );
  } else {
    bullets.push(
      `The concept uses the ${roomLabel} photo as the main layout reference.`
    );
  }

  bullets.push(
    `Warm neutral tones support the ${styleLabel} direction without overclaiming exact colour accuracy.`
  );
  bullets.push(
    `The concept keeps the main focal wall and furniture zone visually balanced.`
  );

  if (productCount > 1) {
    bullets.push(
      `${productCount} selected Koala products guide the styling and bundle direction.`
    );
  } else if (productCount === 1) {
    bullets.push(
      `The selected Koala product gives the preview a clear shopping anchor.`
    );
  }

  bullets.push(
    "The product bundle supports a complete-room shopping journey."
  );

  return bullets;
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

function SliderHandleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        d="M9 7 5 12l4 5M15 7l4 5-4 5M12 5v14"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function CompareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        d="M12 4v16M5 7.5h5M5 12h5M5 16.5h5M14 7.5h5M14 12h5M14 16.5h5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
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

function WhyDesignWorks({
  roomType,
  style,
  customPrompt,
  selectedProducts,
}: {
  roomType: string;
  style: string;
  customPrompt: string;
  selectedProducts: Product[];
}) {
  const bullets = buildWhyDesignWorksBullets({
    roomType,
    style,
    customPrompt,
    selectedProducts,
  });

  return (
    <section className="rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#111111] p-5 shadow-2xl">
      <p className="text-xs uppercase tracking-[0.28em] text-[#9C9C94]">
        AI-estimated preview
      </p>
      <h2 className="mt-2 font-serif text-2xl font-semibold text-[#F7F7F2]">
        Why this design works
      </h2>
      <ul className="mt-4 grid gap-3">
        {bullets.map((item) => (
          <li
            key={item}
            className="flex items-start gap-3 text-sm leading-6 text-[#F7F7F2]"
          >
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#F4C430]" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ImageViewerModal({
  imageBase64,
  beforeImageUrl,
  onClose,
}: {
  imageBase64: string;
  beforeImageUrl: string;
  onClose: () => void;
}) {
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const canShowBefore = Boolean(beforeImageUrl);
  const showComparison = canShowBefore && compareEnabled;
  const generatedImageUrl = `data:image/png;base64,${imageBase64}`;

  function updateSliderPosition(clientX: number) {
    const rect = sliderRef.current?.getBoundingClientRect();

    if (!rect) return;

    const nextPosition = ((clientX - rect.left) / rect.width) * 100;

    setSliderPosition(Math.min(92, Math.max(8, nextPosition)));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Generated design preview"
      className="fixed inset-0 z-50 overflow-hidden bg-[#050505] text-[#F7F7F2]"
    >
      <div className="mx-auto flex h-full w-full max-w-[430px] overflow-hidden bg-[#050505]">
        <div
          ref={sliderRef}
          className="relative min-h-0 flex-1 overflow-hidden bg-[#050505]"
          style={{ touchAction: showComparison ? "none" : "pinch-zoom" }}
          onPointerDown={(event) => {
            if (!showComparison) return;

            setIsDragging(true);
            event.currentTarget.setPointerCapture(event.pointerId);
            updateSliderPosition(event.clientX);
          }}
          onPointerMove={(event) => {
            if (!isDragging || !showComparison) return;

            updateSliderPosition(event.clientX);
          }}
          onPointerUp={(event) => {
            if (!showComparison) return;

            setIsDragging(false);
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => setIsDragging(false)}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close fullscreen preview"
            className="absolute left-4 top-[calc(env(safe-area-inset-top)_+_16px)] z-30 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-[#050505]/75 text-[#F7F7F2] shadow-2xl backdrop-blur transition hover:bg-[#111111]"
          >
            <CloseIcon />
          </button>

          {canShowBefore && (
            <button
              type="button"
              onClick={() => setCompareEnabled((current) => !current)}
              aria-label={
                compareEnabled
                  ? "Hide before and after comparison"
                  : "Compare before and after"
              }
              aria-pressed={compareEnabled}
              className={`absolute right-4 bottom-[calc(env(safe-area-inset-bottom)_+_18px)] z-30 flex h-11 w-11 items-center justify-center rounded-full border shadow-2xl backdrop-blur transition ${
                compareEnabled
                  ? "border-[#F4C430]/70 bg-[#050505]/85 text-[#F4C430]"
                  : "border-white/15 bg-[#050505]/75 text-[#F7F7F2]"
              }`}
            >
              <CompareIcon />
            </button>
          )}

          {showComparison ? (
            <>
              <img
                src={beforeImageUrl}
                alt="Uploaded room before design"
                className="absolute inset-0 h-full w-full object-contain"
              />
              <img
                src={generatedImageUrl}
                alt="Generated room design"
                className="absolute inset-0 h-full w-full object-contain"
                style={{
                  clipPath: `inset(0 0 0 ${sliderPosition}%)`,
                }}
              />
              <div
                className="absolute inset-y-0 z-10 w-px bg-[#F4C430]"
                style={{ left: `${sliderPosition}%` }}
              />
              <div
                className="absolute top-1/2 z-20 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#F4C430]/80 bg-[#050505]/90 text-[#F4C430] shadow-2xl"
                style={{ left: `${sliderPosition}%` }}
                aria-hidden="true"
              >
                <SliderHandleIcon />
              </div>
            </>
          ) : (
            <img
              src={generatedImageUrl}
              alt="Generated room design"
              className="h-full w-full object-contain"
            />
          )}
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
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
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
  const [loadingIndex, resetLoadingIndex] = useProgressIndex(
    loading || refining,
    loadingMessages.length,
    2600
  );
  const selectedProducts = selectedIdsToProducts(selectedProductIds);
  const activeImage = generatedImages[selectedConceptIndex] || "";
  const selectedStylePrompt = getStylePrompt(style, customPrompt);

  useEffect(() => {
    const cached = localStorage.getItem(CACHE_KEY);

    if (!cached) return;

    try {
      const parsed = JSON.parse(cached);
      const timeout = window.setTimeout(() => {
        setGeneratedImages(parsed.generatedImages || []);
        setProducts(parsed.products || []);

        if (parsed.generatedImages?.length) {
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

  function canContinue() {
    if (step === 1) return Boolean(image && previewUrl);
    if (step === 2) return Boolean(roomType);
    if (step === 3) {
      return style === "Custom" ? Boolean(customPrompt.trim()) : Boolean(style);
    }
    if (step === 4) return letAiRecommendBundle || selectedProductIds.length > 0;
    return generatedImages.length > 0;
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
      if (style === "Custom") {
        formData.append("customPrompt", customPrompt.trim());
      }
      appendRoomMeasurements(formData);

      const response = await fetch("/api/generate-room", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Generation failed.");
        return;
      }

      const nextImages = (data.images || []).map(
        (item: { b64_json: string }) => item.b64_json
      );
      const nextProducts = (data.products || []) as Product[];

      setGeneratedImages(nextImages);
      setProducts(nextProducts);
      setSelectedConceptIndex(0);
      trackGenerateCompleted({
        roomType,
        style: selectedStylePrompt,
        products: nextProducts,
        imageCount: nextImages.length,
        roomMeasurements: studioRoomMeasurementPayload,
      });
      saveResultCache(nextImages, nextProducts);
    } catch {
      setError("Failed to connect to the generation service.");
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
      const response = await fetch("/api/refine-room", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageBase64: activeImage,
          changeRequest,
          refinementProductIds: selectedRefinementProductIds,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Refinement failed.");
        return;
      }

      const refinedImage = data.image?.b64_json;

      if (!refinedImage) {
        setError("Refinement completed but no image was returned.");
        return;
      }

      const updatedImages = [...generatedImages, refinedImage];
      const refinedIndex = updatedImages.length - 1;
      const refinementProducts = selectedIdsToProducts(
        selectedRefinementProductIds
      );
      const updatedProducts = mergeUniqueProducts(products, refinementProducts);

      setGeneratedImages(updatedImages);
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
      saveResultCache(updatedImages, updatedProducts);
    } catch {
      setError("Failed to connect to refinement service.");
    } finally {
      setRefining(false);
    }
  }

  function downloadImage() {
    if (!activeImage) return;

    trackDownloadClicked(selectedConceptIndex);

    const binary = window.atob(activeImage);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    const link = document.createElement("a");

    link.href = url;
    link.download = `koala-design-studio-${selectedConceptIndex + 1}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function shareImage() {
    const navigatorWithShare = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
    };
    const shareMethod =
      typeof navigatorWithShare.share === "function" ? "native" : "clipboard";

    trackShareClicked(selectedConceptIndex, shareMethod);

    if (typeof navigatorWithShare.share === "function") {
      try {
        await navigatorWithShare.share({
          title: "Koala Design Studio concept",
          text: SHARE_MESSAGE,
          url: window.location.href,
        });
      } catch {
        // User cancelled the native sheet.
      }

      return;
    }

    await navigator.clipboard.writeText(SHARE_MESSAGE);
  }

  function deleteResult() {
    setGeneratedImages([]);
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
    setGeneratedImages([]);
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
                  Let AI recommend bundle
                </span>
                <span className="mt-1 block text-xs opacity-70">
                  You can still select products manually.
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
            <button
              type="button"
              onClick={() => setImageViewerOpen(true)}
              className="aspect-[4/5] max-h-[46vh] w-full overflow-hidden rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#111111] text-left shadow-2xl"
            >
              <img
                src={`data:image/png;base64,${activeImage}`}
                alt={`Generated concept ${selectedConceptIndex + 1}`}
                className="h-full w-full object-cover"
              />
            </button>

            <StudioButton
              onClick={() => trackBundleAddToCartClicked(products)}
              className="min-h-12 w-full rounded-xl text-base"
            >
              Shop this room
            </StudioButton>

            {generatedImages.length > 1 && (
              <div className="grid grid-cols-4 gap-2">
                {generatedImages.map((imageBase64, index) => (
                  <button
                    key={`${index}-${imageBase64.slice(0, 8)}`}
                    type="button"
                    onClick={() => setSelectedConceptIndex(index)}
                    className={`aspect-square overflow-hidden rounded-xl border ${
                      selectedConceptIndex === index
                        ? "border-[#F4C430]/55"
                        : "border-[rgba(255,255,255,0.12)]"
                    }`}
                  >
                    <img
                      src={`data:image/png;base64,${imageBase64}`}
                      alt={`Concept thumbnail ${index + 1}`}
                      className="h-full w-full object-cover"
                    />
                  </button>
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

            <WhyDesignWorks
              roomType={roomType}
              style={style}
              customPrompt={customPrompt}
              selectedProducts={selectedProducts}
            />

            {products.length > 0 && (
              <section className="rounded-3xl border border-[rgba(255,255,255,0.12)] bg-[#111111] p-5 shadow-2xl">
                <p className="text-xs uppercase tracking-[0.28em] text-[#9C9C94]">
                  Complete the look
                </p>
                <h2 className="mt-2 font-serif text-2xl">Shop this room</h2>
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
                            <button
                              type="button"
                              onClick={() => trackAddToCartClicked(product)}
                              className="rounded-xl bg-[#F7F7F2] px-3 py-1 text-xs font-semibold text-[#050505]"
                            >
                              Add
                            </button>
                            {productUrl && (
                              <a
                                href={productUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-xl border border-[rgba(255,255,255,0.12)] px-3 py-1 text-xs text-[#F7F7F2]"
                              >
                                View
                              </a>
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

      {imageViewerOpen && activeImage && (
        <ImageViewerModal
          imageBase64={activeImage}
          beforeImageUrl={previewUrl}
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
