"use client";

import {
  SEATING_PRESETS,
  buildSeatingPlan,
  describeSeatingPlan,
  type SeatingPlan,
} from "@/lib/intelligence/room-categories";

/**
 * "What should the seating be?"
 *
 * Seating is the one thing in the room that isn't a one-for-one swap. Two
 * tired two-seaters might want to become one L-shape; a big empty corner might
 * want a sofa and two armchairs. So this asks what the room should END UP
 * with, and the pipeline works out the difference from what is there now.
 *
 * Kept to four recognisable answers plus an armchair count. A person
 * redecorating wants to recognise their room, not operate a configurator.
 */
export function SeatingPlanPicker({
  plan,
  armchairsAvailable = true,
  onChange,
}: {
  plan: SeatingPlan | undefined;
  /**
   * Whether the catalogue can actually supply an armchair. It cannot today —
   * everything filed under "chairs" is a dining chair — so the stepper is
   * hidden rather than letting someone ask for two of something that would
   * arrive as dining chairs.
   */
  armchairsAvailable?: boolean;
  onChange: (plan: SeatingPlan) => void;
}) {
  const activePresetId = plan?.presetId ?? SEATING_PRESETS[0].id;
  const activePreset =
    SEATING_PRESETS.find((preset) => preset.id === activePresetId) ??
    SEATING_PRESETS[0];
  const armchairCount =
    plan?.pieces.find((piece) => piece.kind === "armchair")?.count ?? 0;

  function setPreset(presetId: string) {
    const preset = SEATING_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) return;
    onChange(buildSeatingPlan(preset, armchairCount));
  }

  function setArmchairs(next: number) {
    const clamped = Math.max(0, Math.min(4, next));
    onChange(buildSeatingPlan(activePreset, clamped));
  }

  // Only once a plan actually exists. Describing the default before anyone has
  // touched it would promise a room the customer never asked for.
  const preview = plan ? describeSeatingPlan(plan) : "";

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9a978f]">
          Your new seating
        </p>
        <ul className="space-y-2">
          {SEATING_PRESETS.map((preset) => {
            const isActive = preset.id === activePresetId && plan !== undefined;
            return (
              <li key={preset.id}>
                <button
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setPreset(preset.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition active:scale-[0.99] ${
                    isActive
                      ? "border-[#C9A57A]/60 bg-[#C9A57A]/10"
                      : "border-white/10 bg-white/[0.02] hover:border-white/25"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-4 w-4 shrink-0 rounded-full border transition ${
                      isActive
                        ? "border-[#C9A57A] bg-[#C9A57A]"
                        : "border-white/25"
                    }`}
                  />
                  <span className="text-[15px] font-semibold text-[#F5F3EE]">
                    {preset.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {armchairsAvailable && activePreset.armchairsAdjustable && (
        <div className="v2-surface flex items-center justify-between rounded-2xl p-4">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-[#F5F3EE]">
              Armchairs
            </p>
            <p className="mt-0.5 text-xs text-[#9a978f]">Optional</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              aria-label="One fewer armchair"
              disabled={armchairCount === 0}
              onClick={() => setArmchairs(armchairCount - 1)}
              className="grid h-11 w-11 place-items-center rounded-full border border-white/15 text-lg text-[#F5F3EE] transition active:scale-95 disabled:opacity-30"
            >
              −
            </button>
            <span className="w-5 text-center text-[15px] font-semibold tabular-nums text-[#F5F3EE]">
              {armchairCount}
            </span>
            <button
              type="button"
              aria-label="One more armchair"
              disabled={armchairCount === 4}
              onClick={() => setArmchairs(armchairCount + 1)}
              className="grid h-11 w-11 place-items-center rounded-full border border-white/15 text-lg text-[#F5F3EE] transition active:scale-95 disabled:opacity-30"
            >
              +
            </button>
          </div>
        </div>
      )}

      {preview && (
        <p className="text-sm leading-6 text-[#9a978f]">
          Your room will end up with{" "}
          <span className="text-[#F5F3EE]">{preview}</span>.
        </p>
      )}
    </div>
  );
}
