"use client";

import {
  MAX_SEATING_PIECES,
  SEATING_PIECE_KINDS,
  buildSeatingPlan,
  describeSeatingPlan,
  seatingPlanPieceCount,
  type SeatingPieceKind,
  type SeatingPlan,
} from "@/lib/intelligence/room-categories";

/**
 * "What should your seating be?"
 *
 * A quantity stepper per shape, not a single radio choice — real living rooms
 * are frequently a 3-seater AND a 2-seater, or two matching sofas, and a
 * "pick one arrangement" screen has no way to say that. This describes the
 * DESIRED FINAL layout directly: however many sofas the room holds today,
 * the pipeline works out the difference from what is asked for here.
 *
 * Capped at three pieces total — a fourth stops reading as a considered
 * living room and starts reading as a furniture showroom — and at least one
 * piece is required before the arrangement can be confirmed.
 */
export function SeatingPlanPicker({
  plan,
  onChange,
}: {
  plan: SeatingPlan | undefined;
  onChange: (plan: SeatingPlan) => void;
}) {
  const counts: Partial<Record<SeatingPieceKind, number>> = Object.fromEntries(
    (plan?.pieces ?? []).map((piece) => [piece.kind, piece.count])
  );
  const total = plan ? seatingPlanPieceCount(plan) : 0;
  const atMax = total >= MAX_SEATING_PIECES;

  function setCount(kind: SeatingPieceKind, next: number) {
    const clamped = Math.max(0, next);
    // The total across every kind may never exceed the max — clamp against
    // room actually left, not just against a per-row ceiling.
    const otherTotal = total - (counts[kind] ?? 0);
    const bounded = Math.min(clamped, MAX_SEATING_PIECES - otherTotal);
    onChange(buildSeatingPlan({ ...counts, [kind]: bounded }));
  }

  const preview = plan ? describeSeatingPlan(plan) : "";

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9a978f]">
          Your new seating
        </p>
        <ul className="space-y-2">
          {SEATING_PIECE_KINDS.map(({ kind, label }) => {
            const count = counts[kind] ?? 0;
            return (
              <li key={kind}>
                <div className="v2-surface flex items-center justify-between rounded-2xl p-4">
                  <p className="min-w-0 truncate text-[15px] font-semibold text-[#F5F3EE]">
                    {label}
                  </p>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      aria-label={`One fewer ${label}`}
                      disabled={count === 0}
                      onClick={() => setCount(kind, count - 1)}
                      className="grid h-11 w-11 place-items-center rounded-full border border-white/15 text-lg text-[#F5F3EE] transition active:scale-95 disabled:opacity-30"
                    >
                      −
                    </button>
                    <span className="w-5 text-center text-[15px] font-semibold tabular-nums text-[#F5F3EE]">
                      {count}
                    </span>
                    <button
                      type="button"
                      aria-label={`One more ${label}`}
                      disabled={atMax}
                      onClick={() => setCount(kind, count + 1)}
                      className="grid h-11 w-11 place-items-center rounded-full border border-white/15 text-lg text-[#F5F3EE] transition active:scale-95 disabled:opacity-30"
                    >
                      +
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="text-xs leading-5 text-[#7d7a73]">
        Up to {MAX_SEATING_PIECES} pieces total
        {atMax ? " — you're at the limit." : "."}
      </p>

      {preview && (
        <p className="text-sm leading-6 text-[#9a978f]">
          Your room will end up with{" "}
          <span className="text-[#F5F3EE]">{preview}</span>.
        </p>
      )}
    </div>
  );
}
