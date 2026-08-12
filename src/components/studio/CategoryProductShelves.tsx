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
 * One shelf per category, one chosen product per category — the customer picks
 * "this sofa", not "a product for sofa 1 and another for sofa 2". How that
 * choice applies across the individual objects is a planner concern and is
 * never surfaced as configuration.
 *
 * Cross-category products are not merely hidden: a shelf can only ever list
 * products its region category is locked to.
 */

export type CategorySelection = {
  canonicalCategory: CanonicalCategory;
  /** How many objects of this category the customer selected. */
  targetCount: number;
};

export function CategoryProductShelves({
  categories,
  catalogue,
  chosenByCategory,
  onChoose,
}: {
  categories: CategorySelection[];
  catalogue: Product[];
  chosenByCategory: Record<string, string | undefined>;
  onChoose: (category: CanonicalCategory, productId: string | null) => void;
}) {
  return (
    <div className="space-y-7">
      {categories.map(({ canonicalCategory, targetCount }) => {
        const eligible = catalogue.filter((product) =>
          canAssignProductCategory(canonicalCategory, product.category)
        );
        const chosenId = chosenByCategory[canonicalCategory];
        const chosen = eligible.find((p) => p.id === chosenId);
        const label = displayCategoryName(canonicalCategory);

        // How the chosen product would actually be applied, so the shelf can
        // say "× 2" or explain a combined unit without asking the customer
        // to configure anything.
        const configuration = chosen
          ? classifySofaConfiguration(chosen)
          : "unknown";
        const strategy = decideStrategy({
          canonicalCategory,
          targetCount,
          configuration,
        });
        const combined = strategy === "replace-group-with-single";
        const quantity = combined ? 1 : targetCount;

        return (
          <section key={canonicalCategory}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#F5F3EE]">
                {label}
                {targetCount > 1 ? "s" : ""}
              </h3>
              {targetCount > 1 && (
                <span className="shrink-0 text-[11px] text-[#9a978f]">
                  {combined
                    ? "replaced as one unit"
                    : `${targetCount} in your room`}
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
                          // One product per category: tapping another swaps the
                          // choice rather than adding a second.
                          onToggle={() =>
                            onChoose(
                              canonicalCategory,
                              selected ? null : product.id
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
                    This is a corner/sectional design, so it replaces your{" "}
                    {targetCount} seats as one combined piece.
                  </p>
                )}
                {chosen && !combined && targetCount > 1 && (
                  <p className="mt-1.5 text-[11px] leading-4 text-[#9a978f]">
                    We&apos;ll use {targetCount} of these — one for each{" "}
                    {label.toLowerCase()} in your room.
                  </p>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
