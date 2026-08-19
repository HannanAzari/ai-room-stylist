/**
 * Phase timing for one generation request.
 *
 * The interesting question is never "how long did it take" but "which phase".
 * A 4-minute wait caused by the provider queueing our request and a 4-minute
 * wait caused by our own preprocessing need opposite fixes, and until now the
 * only number recorded was the render call itself.
 *
 * Deliberately dumb: a map of accumulated milliseconds. No sampling, no
 * hierarchy, no async context — those cost more to reason about than they save
 * on a request that makes at most a handful of calls.
 */
export type GenerationPhase =
  | "room-preprocess"
  | "reference-prepare"
  | "provider-request"
  | "provider-wait"
  | "response-encode";

export type GenerationTimings = {
  /** Accumulated milliseconds per phase. */
  phases: Record<GenerationPhase, number>;
  /** Total wall clock from `start()` to `total()`. */
  totalMs: number;
  /** Provider attempts made, including the one that succeeded. */
  providerAttempts: number;
};

export function createTimings() {
  const startedAt = Date.now();
  const phases: Record<GenerationPhase, number> = {
    "room-preprocess": 0,
    "reference-prepare": 0,
    "provider-request": 0,
    "provider-wait": 0,
    "response-encode": 0,
  };
  let providerAttempts = 0;

  return {
    /** Time an async phase and return its result. */
    async measure<T>(phase: GenerationPhase, work: () => Promise<T>): Promise<T> {
      const at = Date.now();
      try {
        return await work();
      } finally {
        phases[phase] += Date.now() - at;
      }
    },
    /** Add already-measured milliseconds, for work timed inside a provider. */
    add(phase: GenerationPhase, ms: number) {
      phases[phase] += ms;
    },
    recordProviderAttempt() {
      providerAttempts += 1;
    },
    snapshot(): GenerationTimings {
      return {
        phases: { ...phases },
        totalMs: Date.now() - startedAt,
        providerAttempts,
      };
    },
  };
}

export type TimingsCollector = ReturnType<typeof createTimings>;

/**
 * Milliseconds not attributed to any measured phase — route overhead, form
 * parsing, JSON serialisation. Worth surfacing: if this ever dominates, the
 * instrumentation is measuring the wrong things.
 */
export function unattributedMs(timings: GenerationTimings): number {
  const measured = Object.values(timings.phases).reduce((sum, ms) => sum + ms, 0);
  return Math.max(0, timings.totalMs - measured);
}
