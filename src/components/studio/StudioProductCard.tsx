"use client";

import { ProductImage } from "@/features/room-stylist/components/ProductImage";
import {
  formatPrice,
  getCategoryLabel,
  getShortProductName,
} from "@/features/room-stylist/services/product-helpers";
import type { Product } from "@/features/room-stylist/types";

/**
 * The Netflix-style product card used across the Studio's horizontal shelves.
 *
 * Extracted so the browse shelves and the replacement shelves are literally the
 * same card, rather than two implementations drifting apart.
 */

function triggerHaptic() {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate === "function") navigator.vibrate(8);
}

export function StudioProductCard({
  product,
  selected,
  onToggle,
  /** Physical units required, shown as "× 2" when a room needs more than one. */
  quantity = 1,
  /** Replaces the category line when the room needs a specific explanation. */
  footnote,
}: {
  product: Product;
  selected: boolean;
  onToggle: () => void;
  quantity?: number;
  footnote?: string;
}) {
  const price = formatPrice(product.price);
  const hasRealPrice = typeof product.price === "number";

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
      className={`relative flex h-[248px] min-w-0 flex-col overflow-hidden rounded-2xl border bg-[#111111] p-2.5 text-left transition-all duration-200 ease-out active:scale-[0.985] ${
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
        {selected && quantity > 1 && (
          <span className="absolute left-1.5 top-1.5 rounded-full bg-[#0b0b0d]/85 px-2 py-0.5 text-[10px] font-semibold text-[#F5F3EE] backdrop-blur">
            × {quantity}
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col pt-2">
        <p className="line-clamp-2 min-h-9 break-words text-xs font-semibold leading-snug text-[#F7F7F2]">
          {getShortProductName(product)}
        </p>
        {/* Price only when it is real. Never invented — an unpriced product
            says so rather than showing a plausible-looking number. */}
        <p
          className={`mt-1 text-[11px] leading-4 ${
            hasRealPrice
              ? "font-semibold text-[#F5F3EE]"
              : "text-[#7d7a73]"
          }`}
        >
          {price}
        </p>
        <p className="mt-auto truncate text-[10px] uppercase tracking-[0.14em] text-[#9C9C94]">
          {footnote ?? getCategoryLabel(product.category)}
        </p>
      </div>
    </button>
  );
}
