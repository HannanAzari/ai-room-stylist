"use client";

import type { MenuCategory } from "@/lib/intelligence/room-categories";
import type { CanonicalCategory } from "@/lib/intelligence/scene-taxonomy";

/**
 * "What would you like to replace?"
 *
 * This list is prebuilt from the room TYPE, not from the photo, so it is on
 * screen the instant the customer arrives. A living room has sofas, a rug, a
 * coffee table — we know that without looking. Looking at the actual room is
 * what happens next, once they have told us what they care about.
 *
 * Because nothing has been analysed yet, there are no counts here and no
 * markings on the photo. Picking a type means every piece of that type
 * changes, which is what "replace my sofas" means to a person.
 */
export function ReplaceCategoryPicker({
  categories,
  selected,
  unavailable,
  planSummaries,
  onToggle,
  onConfigure,
  onRefine,
}: {
  categories: MenuCategory[];
  selected: CanonicalCategory[];
  /** Types the catalogue cannot supply yet. Shown, but not selectable. */
  unavailable?: CanonicalCategory[];
  /** "1 L-shape sofa and 2 armchairs", for configured seating. */
  planSummaries?: Partial<Record<CanonicalCategory, string>>;
  onToggle: (category: CanonicalCategory) => void;
  /** Opens the seating configurator. */
  onConfigure?: (category: CanonicalCategory) => void;
  /** Opens the advanced picker, which analyses just this type. */
  onRefine?: (category: CanonicalCategory) => void;
}) {
  return (
    <ul className="space-y-2">
      {categories.map((category) => {
        const canonical = category.canonicalCategory;
        const isSelected = selected.includes(canonical);
        const isUnavailable = unavailable?.includes(canonical) ?? false;
        const summary = planSummaries?.[canonical];
        const isSeating = category.behaviour === "seating";

        return (
          <li key={canonical}>
            <button
              type="button"
              aria-pressed={isSelected}
              disabled={isUnavailable}
              onClick={() => {
                if (isUnavailable) return;
                // Seating asks what the room should end up with, so choosing
                // it opens the configurator rather than just ticking a box.
                if (isSeating && !isSelected && onConfigure) {
                  onConfigure(canonical);
                  return;
                }
                onToggle(canonical);
              }}
              className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition ${
                isUnavailable
                  ? "cursor-not-allowed border-white/[0.06] bg-white/[0.01] opacity-45"
                  : isSelected
                    ? "border-[#C9A57A]/60 bg-[#C9A57A]/10 active:scale-[0.99]"
                    : "border-white/10 bg-white/[0.02] hover:border-white/25 active:scale-[0.99]"
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
                {isUnavailable ? (
                  <span className="mt-0.5 block text-xs text-[#9a978f]">
                    Coming soon
                  </span>
                ) : (
                  summary && (
                    <span className="mt-0.5 block text-xs text-[#C9A57A]">
                      {summary}
                    </span>
                  )
                )}
              </span>

              {/* Seating leads somewhere, so it says so. */}
              {isSeating && !isUnavailable && !isSelected && (
                <span
                  aria-hidden="true"
                  className="shrink-0 text-[#9a978f]"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4">
                    <path
                      d="m9 6 6 6-6 6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              )}
            </button>

            {isSelected && !isUnavailable && (
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 pl-[52px]">
                {isSeating && onConfigure && (
                  <button
                    type="button"
                    onClick={() => onConfigure(canonical)}
                    className="text-xs font-semibold text-[#9a978f] underline underline-offset-4 transition hover:text-[#C9A57A]"
                  >
                    Change arrangement
                  </button>
                )}
                {/* Advanced. Deliberately quiet, and the only path that needs
                    us to look at the room before generating. */}
                {onRefine && (
                  <button
                    type="button"
                    onClick={() => onRefine(canonical)}
                    className="text-xs font-semibold text-[#9a978f] underline underline-offset-4 transition hover:text-[#C9A57A]"
                  >
                    Choose a specific one instead
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
