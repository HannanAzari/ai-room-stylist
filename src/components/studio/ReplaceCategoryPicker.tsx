"use client";

import type { DetectedCategory } from "@/lib/intelligence/room-selection";
import type { CanonicalCategory } from "@/lib/intelligence/scene-taxonomy";

/**
 * "What would you like to replace?"
 *
 * The customer chooses furniture TYPES, not detected objects. Everything the
 * room analysis worked out — where each piece is, how many there are, which are
 * fixed — stays behind this screen. No boxes, no dots, no labels over the photo,
 * no "Sofa 1 / Sofa 2".
 *
 * Picking a type means every piece of that type changes, which is what
 * "replace my sofas" means to a person. Choosing one specific piece is possible
 * but deliberately secondary — see the advanced picker.
 */
export function ReplaceCategoryPicker({
  categories,
  selected,
  onToggle,
  onRefine,
}: {
  categories: DetectedCategory[];
  selected: CanonicalCategory[];
  onToggle: (category: CanonicalCategory) => void;
  /** Opens the advanced picker for a type with more than one piece. */
  onRefine?: (category: CanonicalCategory) => void;
}) {
  return (
    <ul className="space-y-2">
      {categories.map((category) => {
        const isSelected = selected.includes(category.canonicalCategory);

        return (
          <li key={category.canonicalCategory}>
            <button
              type="button"
              aria-pressed={isSelected}
              onClick={() => onToggle(category.canonicalCategory)}
              className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition active:scale-[0.99] ${
                isSelected
                  ? "border-[#C9A57A]/60 bg-[#C9A57A]/10"
                  : "border-white/10 bg-white/[0.02] hover:border-white/25"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${
                  isSelected
                    ? "border-[#C9A57A] bg-[#C9A57A] text-[#0b0b0d]"
                    : "border-white/25"
                }`}
              >
                {isSelected && (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5">
                    <path
                      d="m5 12 4.5 4.5L19 7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-[#F5F3EE]">
                  {category.label}
                </span>
                <span className="mt-0.5 block text-xs text-[#9a978f]">
                  {category.count} in your room
                </span>
              </span>
            </button>

            {/* Advanced, and only where it can possibly matter. */}
            {isSelected && category.count > 1 && onRefine && (
              <button
                type="button"
                onClick={() => onRefine(category.canonicalCategory)}
                className="mt-1.5 pl-[52px] text-xs font-semibold text-[#9a978f] underline underline-offset-4 transition hover:text-[#C9A57A]"
              >
                Choose a specific one instead
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
