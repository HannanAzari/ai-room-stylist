"use client";

import { useState } from "react";
import {
  allowedProductCategories,
  canAssignProductCategory,
  type AssignmentInput,
  type ReplacementScope,
} from "@/lib/intelligence/replacement-assignment";
import {
  displayCategoryName,
  type RoomSelection,
} from "@/lib/intelligence/room-selection";
import type { Product } from "@/features/room-stylist/types";

/**
 * Assign an exact Koala product to each selected room region.
 *
 * The category lock is enforced here as well as in the contract: the picker
 * only ever lists products whose catalogue category may legally fill the
 * region, so a sofa region cannot be handed a coffee table even by mistake.
 *
 * When the room holds more than one object of the same category, the customer
 * is asked explicitly whether they mean this one or all of them. That decision
 * is never inferred.
 */
export function RegionAssignmentList({
  selections,
  assignments,
  onAssignmentsChange,
  catalogue,
  sameCategoryCounts,
}: {
  selections: RoomSelection[];
  assignments: AssignmentInput[];
  onAssignmentsChange: (next: AssignmentInput[]) => void;
  catalogue: Product[];
  /** How many objects of each canonical category the room contains. */
  sameCategoryCounts: Record<string, number>;
}) {
  const [openSelectionId, setOpenSelectionId] = useState<string | null>(null);

  function assignmentFor(selectionId: string) {
    return assignments.find((a) => a.selectionId === selectionId);
  }

  function setProduct(selectionId: string, productId: string) {
    const existing = assignmentFor(selectionId);
    const next = assignments.filter((a) => a.selectionId !== selectionId);
    next.push({
      selectionId,
      productId,
      scope: existing?.scope ?? "this-only",
    });
    onAssignmentsChange(next);
    setOpenSelectionId(null);
  }

  function setScope(selectionId: string, scope: ReplacementScope) {
    onAssignmentsChange(
      assignments.map((a) =>
        a.selectionId === selectionId ? { ...a, scope } : a
      )
    );
  }

  function clearProduct(selectionId: string) {
    onAssignmentsChange(
      assignments.filter((a) => a.selectionId !== selectionId)
    );
  }

  return (
    <div className="space-y-3">
      {selections.map((selection) => {
        const assignment = assignmentFor(selection.selectionId);
        const chosen = assignment
          ? catalogue.find((p) => p.id === assignment.productId)
          : undefined;
        const categoryName = displayCategoryName(selection.canonicalCategory);
        // Only products locked to this region's category are offerable.
        const eligible = catalogue.filter((product) =>
          canAssignProductCategory(selection.canonicalCategory, product.category)
        );
        const isOpen = openSelectionId === selection.selectionId;
        const siblingCount =
          sameCategoryCounts[selection.canonicalCategory] ?? 1;

        return (
          <div key={selection.selectionId} className="v2-surface rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#F5F3EE]">
                  {selection.displayName}
                </p>
                {selection.originalObjectDescription && (
                  <p className="mt-0.5 truncate text-xs text-[#9a978f]">
                    {selection.originalObjectDescription}
                  </p>
                )}
              </div>
              {chosen && (
                <button
                  type="button"
                  onClick={() => clearProduct(selection.selectionId)}
                  className="shrink-0 text-xs font-semibold text-[#9a978f] underline underline-offset-4"
                >
                  Change
                </button>
              )}
            </div>

            {chosen ? (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-[#C9A57A]/40 bg-[#C9A57A]/10 p-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[#F5F3EE]">
                    {chosen.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[#C9A57A]">
                    Will replace {selection.displayName}
                  </span>
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setOpenSelectionId(isOpen ? null : selection.selectionId)
                }
                disabled={eligible.length === 0}
                className="mt-3 min-h-11 w-full rounded-xl border border-white/12 bg-white/[0.03] px-3 text-sm font-semibold text-[#F5F3EE] transition hover:border-[#C9A57A]/50 disabled:opacity-40"
              >
                {eligible.length === 0
                  ? `No Koala ${categoryName.toLowerCase()} available`
                  : `Choose Koala ${categoryName.toLowerCase()}`}
              </button>
            )}

            {/* Picker, already filtered to the correct category. */}
            {isOpen && eligible.length > 0 && (
              <div className="v2-noscrollbar mt-3 max-h-64 space-y-2 overflow-y-auto">
                {eligible.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => setProduct(selection.selectionId, product.id)}
                    className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-2.5 text-left transition hover:border-[#C9A57A]/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-[#F5F3EE]">
                        {product.name}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Explicit one-vs-all decision, never inferred. */}
            {chosen && siblingCount > 1 && (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <p className="text-xs font-semibold text-[#F5F3EE]">
                  Your room has {siblingCount}{" "}
                  {categoryName.toLowerCase()}s. Replace:
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    aria-pressed={assignment?.scope === "this-only"}
                    onClick={() =>
                      setScope(selection.selectionId, "this-only")
                    }
                    className={`min-h-10 rounded-full border px-3 text-xs font-semibold transition ${
                      assignment?.scope === "this-only"
                        ? "border-[#C9A57A]/60 bg-[#C9A57A]/15 text-[#C9A57A]"
                        : "border-white/12 text-[#9a978f]"
                    }`}
                  >
                    This one only
                  </button>
                  <button
                    type="button"
                    aria-pressed={assignment?.scope === "all-similar"}
                    onClick={() =>
                      setScope(selection.selectionId, "all-similar")
                    }
                    className={`min-h-10 rounded-full border px-3 text-xs font-semibold transition ${
                      assignment?.scope === "all-similar"
                        ? "border-[#C9A57A]/60 bg-[#C9A57A]/15 text-[#C9A57A]"
                        : "border-white/12 text-[#9a978f]"
                    }`}
                  >
                    All {categoryName.toLowerCase()}s
                  </button>
                </div>
              </div>
            )}

            {eligible.length === 0 && (
              <p className="mt-2 text-[11px] leading-4 text-[#7d7a73]">
                Koala doesn&apos;t stock this category yet, so this area will be
                left unchanged.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Categories with no Koala products available at all. */
export function unassignableCategories(
  selections: RoomSelection[],
  catalogue: Product[]
): string[] {
  return [
    ...new Set(
      selections
        .filter(
          (selection) =>
            !catalogue.some((product) =>
              canAssignProductCategory(
                selection.canonicalCategory,
                product.category
              )
            )
        )
        .map((selection) => selection.canonicalCategory)
    ),
  ];
}

export { allowedProductCategories };
