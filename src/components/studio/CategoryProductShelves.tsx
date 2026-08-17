"use client";

import { StudioProductCard } from "./StudioProductCard";
import { canAssignProductCategory } from "@/lib/intelligence/replacement-assignment";
import {
  classifySofaConfiguration,
  decideStrategy,
} from "@/lib/intelligence/replacement-group";
import { displayCategoryName } from "@/lib/intelligence/room-selection";
import type { CanonicalCategory } from "@/lib/intelligence/scene-taxonomy";
import type { Product } from "@/features/room-stylist/types";

/**
 * Visual product shelves for the categories the customer actually selected.
 *
 * One shelf per SHELF KEY, one chosen product each. For a plain category that
 * key is the category itself — the customer picks "this rug", and how that
 * choice applies across the individual objects is a planner concern never
 * surfaced as configuration.
 *
 * Seating is the exception, and deliberately so: a plan asking for two
 * 3-seaters draws two shelves, one per physical piece, because a matching pair
 * and two different models are both things people actually want and a single
 * shared shelf can only express the first. The second shelf offers "use the
 * same as the first" so the common case stays one tap.
 *
 * Cross-category products are not merely hidden: a shelf can only ever list
 * products its region category is locked to.
 */

export type CategorySelection = {
  canonicalCategory: CanonicalCategory;
  /** How many objects of this category the customer selected. */
  targetCount: number;
  /**
   * Distinct key for `chosenByCategory` / `onChoose` when more than one
   * shelf shares a canonical category — a mixed seating request ("1
   * 3-seater + 1 2-seater") draws both shelves from the same "sofas"
   * catalogue category but needs two independent product choices. Defaults
   * to `canonicalCategory`.
   */
  key?: string;
  /** Override display label, e.g. "3-seater sofa" instead of the generic "Sofa". */
  label?: string;
  /**
   * True when `targetCount` is already the customer's DECLARED final count
   * for this exact shelf — seating shelves are built one per desired shape,
   * so the count needs no sectional/consolidation guessing; it IS the
   * answer, and the shelf must not re-derive it.
   */
  quantityIsExplicit?: boolean;
  /**
   * Offer "use the same one as before" on this shelf.
   *
   * Set on the second and later slots of a seating shape. Choosing two
   * matching sofas is the common case and scrolling a shelf to find the card
   * you already picked is a chore, so the shortcut is offered explicitly —
   * while leaving the shelf itself fully browsable, which is what makes two
   * DIFFERENT models equally available. Without this the "same or different"
   * choice would be implied by the shelves rather than stated.
   */
  sameAs?: {
    /** Shelf key whose choice this one can copy. */
    key: string;
    /**
     * Short name for the shelf being copied, e.g. "the first". Deliberately
     * short rather than the full shelf label: this appears inside button copy
     * on a 375px screen, directly under a heading that already says which
     * piece this is, so repeating the full "3-seater sofa · 1 of 2" there
     * only costs a line of wrapping.
     */
    label: string;
  };
};

export function CategoryProductShelves({
  categories,
  catalogue,
  chosenByCategory,
  countsAreFromRoom = true,
  onChoose,
}: {
  categories: CategorySelection[];
  catalogue: Product[];
  chosenByCategory: Record<string, string | undefined>;
  /**
   * Whether the counts came from looking at the room, or from what the
   * customer asked for.
   *
   * In the ordinary journey nothing has analysed the photo yet, so saying "2
   * in your room" would be a claim we have not earned. The number is real
   * either way — it just means something different, and the copy has to say
   * which.
   */
  countsAreFromRoom?: boolean;
  onChoose: (
    key: string,
    productId: string | null,
    canonicalCategory: CanonicalCategory
  ) => void;
}) {
  return (
    <div className="space-y-7">
      {categories.map(
        ({
          canonicalCategory,
          targetCount,
          key: keyOverride,
          label: labelOverride,
          quantityIsExplicit = false,
          sameAs,
        }) => {
          const shelfKey = keyOverride ?? canonicalCategory;
          const eligible = catalogue.filter((product) =>
            canAssignProductCategory(canonicalCategory, product.category)
          );
          const chosenId = chosenByCategory[shelfKey];
          const chosen = eligible.find((p) => p.id === chosenId);
          const label = labelOverride ?? displayCategoryName(canonicalCategory);
          // The shortcut is only real once the shelf it copies has a choice,
          // and only worth showing while this shelf does not already match it.
          const sameAsChosenId = sameAs ? chosenByCategory[sameAs.key] : undefined;
          const canCopyPrevious = Boolean(
            sameAsChosenId && sameAsChosenId !== chosenId
          );
          const matchesPrevious = Boolean(
            sameAsChosenId && sameAsChosenId === chosenId
          );

          // How the chosen product would actually be applied, so the shelf can
          // say "× 2" or explain a combined unit without asking the customer
          // to configure anything. Skipped entirely when the count is already
          // explicit (seating) — there is nothing left to infer.
          const configuration =
            !quantityIsExplicit && chosen
              ? classifySofaConfiguration(chosen)
              : "unknown";
          const strategy = quantityIsExplicit
            ? "replace-each"
            : decideStrategy({ canonicalCategory, targetCount, configuration });
          const combined = strategy === "replace-group-with-single";
          const quantity = combined ? 1 : targetCount;

          return (
            <section key={shelfKey}>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#F5F3EE]">
                  {label}
                  {!labelOverride && targetCount > 1 ? "s" : ""}
                </h3>
                {targetCount > 1 && !quantityIsExplicit && (
                  <span className="shrink-0 text-[11px] text-[#9a978f]">
                    {combined
                      ? "replaced as one unit"
                      : countsAreFromRoom
                        ? `${targetCount} in your room`
                        : `${targetCount} in your new layout`}
                  </span>
                )}
              </div>

              {eligible.length === 0 ? (
                <p className="mt-2 text-xs leading-5 text-[#7d7a73]">
                  Koala doesn&apos;t stock this category yet — this area will be
                  left unchanged.
                </p>
              ) : (
                <>
                  {canCopyPrevious && (
                    <button
                      type="button"
                      onClick={() =>
                        onChoose(
                          shelfKey,
                          sameAsChosenId ?? null,
                          canonicalCategory
                        )
                      }
                      className="mt-2 w-full rounded-2xl border border-[#C9A57A]/40 bg-[#C9A57A]/10 px-4 py-2.5 text-[12px] font-semibold text-[#E8D6BC] transition active:scale-[0.99]"
                    >
                      Use the same as {sameAs?.label} — a matching pair
                    </button>
                  )}
                  {matchesPrevious && (
                    <p className="mt-2 text-[11px] leading-4 text-[#9a978f]">
                      Same model as {sameAs?.label} — a matching pair. Pick a
                      different one below to mix two models.
                    </p>
                  )}

                  {/* Full-bleed shelf so the next card peeks past the edge. */}
                  <div className="v2-noscrollbar -mx-6 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-1">
                    {eligible.map((product) => {
                      const selected = product.id === chosenId;
                      return (
                        <div
                          key={product.id}
                          className="w-[152px] shrink-0 snap-start"
                        >
                          <StudioProductCard
                            product={product}
                            selected={selected}
                            quantity={quantity}
                            footnote={
                              selected && combined
                                ? "Replaces both seats"
                                : undefined
                            }
                            // One product per shelf: tapping another swaps the
                            // choice rather than adding a second.
                            onToggle={() =>
                              onChoose(
                                shelfKey,
                                selected ? null : product.id,
                                canonicalCategory
                              )
                            }
                          />
                        </div>
                      );
                    })}
                    <div aria-hidden="true" className="w-1 shrink-0" />
                  </div>

                  {chosen && combined && (
                    <p className="mt-1.5 text-[11px] leading-4 text-[#9a978f]">
                      This is a corner/sectional design, so it works as one
                      combined piece rather than {targetCount} separate seats.
                    </p>
                  )}
                  {chosen && !combined && targetCount > 1 && (
                    <p className="mt-1.5 text-[11px] leading-4 text-[#9a978f]">
                      {quantityIsExplicit || !countsAreFromRoom ? (
                        <>We&apos;ll use {targetCount} of these.</>
                      ) : (
                        <>
                          We&apos;ll use {targetCount} of these — one for each{" "}
                          {label.toLowerCase()} in your room.
                        </>
                      )}
                    </p>
                  )}
                </>
              )}
            </section>
          );
        }
      )}
    </div>
  );
}
