"use client";

import { SURPRISE_STYLES } from "@/lib/intelligence/room-categories";

/**
 * "What look are you after?"
 *
 * The one question worth asking before we surprise someone. Everything else —
 * which pieces, how they go together, what stays — we decide. Single-select,
 * one tap, and "No preference" is a real answer that takes its cue from the
 * room the customer already has rather than imposing a look on it.
 */
export function SurpriseStylePicker({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (styleId: string) => void;
}) {
  return (
    <ul className="grid grid-cols-2 gap-2">
      {SURPRISE_STYLES.map((style) => {
        const isSelected = style.id === selected;
        // "No preference" closes the list, so it gets the full width.
        const isWide = style.styleTags.length === 0;

        return (
          <li key={style.id} className={isWide ? "col-span-2" : undefined}>
            <button
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(style.id)}
              className={`flex min-h-[56px] w-full items-center justify-center rounded-2xl border px-4 py-3 text-center text-[15px] font-semibold transition active:scale-[0.99] ${
                isSelected
                  ? "border-[#C9A57A]/60 bg-[#C9A57A]/10 text-[#F5F3EE]"
                  : "border-white/10 bg-white/[0.02] text-[#F5F3EE] hover:border-white/25"
              }`}
            >
              {style.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
