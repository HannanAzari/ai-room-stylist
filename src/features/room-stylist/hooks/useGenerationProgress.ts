/**
 * Waiting-screen progress, driven by real elapsed time.
 *
 * ---------------------------------------------------------------------------
 * WHY THE OLD ONE FELT FAKE
 * ---------------------------------------------------------------------------
 * The previous version advanced a stage every 2.6 seconds regardless of what
 * was happening, so five stages completed in about ten seconds and the last one
 * then sat there for the remaining thirty to seventy. Fast-then-stall is the
 * exact shape that reads as a progress bar lying to you.
 *
 * Two changes fix that without pretending to know something we do not:
 *
 *  - stages have their OWN durations, weighted to what actually takes time, so
 *    the early ones no longer race;
 *  - the bar approaches completion asymptotically and never reaches 100% until
 *    the image really arrives. A bar that fills and stops is a broken promise;
 *    one that keeps creeping is honest about an open-ended wait.
 *
 * Everything here is a pure function of elapsed milliseconds, so the pacing can
 * be tested at any point on the curve without rendering anything or waiting.
 */

export type GenerationStage = {
  /** Customer-facing label. Never mentions models, prompts or providers. */
  label: string;
  /** Roughly how long this stage tends to take, in milliseconds. */
  durationMs: number;
};

/**
 * The stages of a generation, in order.
 *
 * Durations are shaped from measured renders — a localized three-edit room ran
 * 77s wall clock, a single few-shot edit around 20-45s — and are weighted so
 * the longest stage is the one that really is longest. The last stage has no
 * duration in practice: it holds until the image lands.
 */
export const GENERATION_STAGES: ReadonlyArray<GenerationStage> = [
  { label: "Understanding your room", durationMs: 9_000 },
  { label: "Mapping your chosen pieces", durationMs: 11_000 },
  { label: "Placing them in your space", durationMs: 18_000 },
  { label: "Creating your Koala look", durationMs: 24_000 },
  { label: "Finalising your design", durationMs: Number.POSITIVE_INFINITY },
];

/** Shorter, because a refinement edits an image that already exists. */
export const REFINEMENT_STAGES: ReadonlyArray<GenerationStage> = [
  { label: "Reading your room", durationMs: 6_000 },
  { label: "Applying your change", durationMs: 14_000 },
  { label: "Finalising your design", durationMs: Number.POSITIVE_INFINITY },
];

export type GenerationProgress = {
  /** Index into the stage list. */
  stageIndex: number;
  label: string;
  /** 0–1 across the whole wait. Never reaches 1 while still running. */
  fraction: number;
  /** 0–1 within the current stage. 1 for the open-ended final stage. */
  stageFraction: number;
};

/**
 * How far along a wait of `elapsedMs` is.
 *
 * The final stage is deliberately open-ended: rather than stall at a fixed
 * number, the bar keeps easing towards — but never reaches — `CEILING`, so a
 * long wait still shows movement and a finished render is the only thing that
 * completes it.
 */
const CEILING = 0.97;
/** How quickly the final stage's creep decays. Larger = slower creep. */
const TAIL_TAU_MS = 45_000;

export function generationProgress(
  elapsedMs: number,
  stages: ReadonlyArray<GenerationStage> = GENERATION_STAGES
): GenerationProgress {
  const elapsed = Math.max(0, elapsedMs);
  const finite = stages.filter((stage) => Number.isFinite(stage.durationMs));
  const finiteTotal = finite.reduce((sum, stage) => sum + stage.durationMs, 0);
  /** How much of the bar the timed stages are allowed to consume. */
  const timedShare = 0.75;

  let consumed = 0;
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index];

    if (!Number.isFinite(stage.durationMs)) {
      // The open-ended tail: ease from wherever the timed stages ended towards
      // the ceiling, and never arrive.
      const intoTail = elapsed - consumed;
      const remaining = CEILING - timedShare;
      return {
        stageIndex: index,
        label: stage.label,
        fraction: timedShare + remaining * (1 - Math.exp(-intoTail / TAIL_TAU_MS)),
        stageFraction: 1,
      };
    }

    if (elapsed < consumed + stage.durationMs) {
      const intoStage = elapsed - consumed;
      const stageFraction = intoStage / stage.durationMs;
      // Progress within the timed stages is proportional to their real
      // durations, so a long stage moves the bar further than a short one.
      const before = finiteTotal === 0 ? 0 : consumed / finiteTotal;
      const width = finiteTotal === 0 ? 0 : stage.durationMs / finiteTotal;
      return {
        stageIndex: index,
        label: stage.label,
        fraction: timedShare * (before + width * stageFraction),
        stageFraction,
      };
    }

    consumed += stage.durationMs;
  }

  // Every stage was finite and all of them elapsed — hold at the last one.
  const last = stages[stages.length - 1];
  return {
    stageIndex: stages.length - 1,
    label: last?.label ?? "",
    fraction: timedShare,
    stageFraction: 1,
  };
}
