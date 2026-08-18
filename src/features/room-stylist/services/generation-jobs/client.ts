/**
 * Client-side generation job handling.
 *
 * ---------------------------------------------------------------------------
 * WHY
 * ---------------------------------------------------------------------------
 * A render takes 2-3 minutes. The old flow held one long fetch open behind a
 * full-screen spinner, which meant a refresh — or iOS Safari discarding a
 * backgrounded tab, which it does readily — silently threw away a render the
 * customer had already paid for and waited minutes for.
 *
 * The async path returns a job id immediately. This module owns the small
 * amount of client state that makes that useful: remember the id, poll it, and
 * pick the job back up when the page is re-opened.
 *
 * Deliberately framework-free (no hooks, no React import) so it is testable in
 * a plain script — the restoration logic is the part most worth testing and the
 * part least worth mounting a component for.
 */

const PENDING_JOB_KEY = "koala-studio-pending-generation";

/**
 * How long a remembered job stays worth resuming. Comfortably longer than a
 * slow render, far shorter than the server's 1h TTL, so a stale id from
 * yesterday never resurrects a processing screen.
 */
export const PENDING_JOB_MAX_AGE_MS = 15 * 60 * 1000;

const POLL_INTERVAL_MS = 3000;

export type PendingJob = {
  jobId: string;
  startedAt: number;
  /** Whether the server said the job survives across instances. */
  durable: boolean;
  /** Echoed back so a restored screen can describe what is being made. */
  roomType?: string;
  designMode?: string;
};

export type JobStatusResponse = {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "unknown";
  stage?: string | null;
  durable?: boolean;
  result?: unknown;
  error?: string;
  reason?: string;
};

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Safari private mode throws on access rather than returning null.
    return null;
  }
}

/**
 * Current time, owned by this module because job timing is this module's
 * concern — the elapsed clock and the remembered `startedAt` must come from
 * one source or a resumed screen shows a different elapsed time than the one
 * it replaced.
 */
export function nowMs(): number {
  return Date.now();
}

export function rememberPendingJob(job: PendingJob) {
  try {
    storage()?.setItem(PENDING_JOB_KEY, JSON.stringify(job));
  } catch {
    // A full or unavailable store must never break generation itself.
  }
}

export function forgetPendingJob() {
  try {
    storage()?.removeItem(PENDING_JOB_KEY);
  } catch {
    // Ignore.
  }
}

/**
 * The job worth resuming on load, if any.
 *
 * Returns null for anything malformed, too old, or non-durable: a non-durable
 * job cannot be found from a fresh page load, so offering to resume it would
 * strand the customer on a processing screen that never resolves.
 */
export function readPendingJob(now = Date.now()): PendingJob | null {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(PENDING_JOB_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    forgetPendingJob();
    return null;
  }

  const job = parsed as Partial<PendingJob>;
  if (typeof job?.jobId !== "string" || job.jobId.length === 0) {
    forgetPendingJob();
    return null;
  }
  if (typeof job.startedAt !== "number" || !Number.isFinite(job.startedAt)) {
    forgetPendingJob();
    return null;
  }
  if (now - job.startedAt > PENDING_JOB_MAX_AGE_MS) {
    forgetPendingJob();
    return null;
  }
  if (job.durable !== true) {
    // Honest rather than hopeful — see the doc comment above.
    forgetPendingJob();
    return null;
  }

  return {
    jobId: job.jobId,
    startedAt: job.startedAt,
    durable: true,
    roomType: typeof job.roomType === "string" ? job.roomType : undefined,
    designMode: typeof job.designMode === "string" ? job.designMode : undefined,
  };
}

export function generationStatusUrl(jobId: string) {
  return `/api/studio/generate-gemini/status?jobId=${encodeURIComponent(jobId)}`;
}

/**
 * Poll until the job reaches a terminal state.
 *
 * `onUpdate` fires on every tick so the processing screen can show progress.
 * A transient network blip is retried rather than treated as failure — the
 * render is still running server-side, and giving up on it here would discard
 * it for no reason. `unknown` IS terminal: the job is genuinely not there.
 */
export async function pollGenerationJob(options: {
  jobId: string;
  signal?: AbortSignal;
  onUpdate?: (status: JobStatusResponse) => void;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
  /** Wall-clock ceiling, so a stuck job cannot poll forever. */
  timeoutMs?: number;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}): Promise<JobStatusResponse> {
  const {
    jobId,
    signal,
    onUpdate,
    intervalMs = POLL_INTERVAL_MS,
    fetchImpl = fetch,
    timeoutMs = PENDING_JOB_MAX_AGE_MS,
    now = () => Date.now(),
    wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  const startedAt = now();
  let consecutiveNetworkFailures = 0;

  for (;;) {
    if (signal?.aborted) {
      return { jobId, status: "unknown", reason: "Polling was cancelled." };
    }
    if (now() - startedAt > timeoutMs) {
      return {
        jobId,
        status: "failed",
        error: "This is taking longer than expected. Please try again.",
      };
    }

    let status: JobStatusResponse | null = null;
    try {
      const response = await fetchImpl(generationStatusUrl(jobId), {
        signal,
        cache: "no-store",
      });
      const body = (await response.json()) as JobStatusResponse;
      status = { ...body, jobId };
      consecutiveNetworkFailures = 0;
    } catch {
      consecutiveNetworkFailures += 1;
      // The render is still running server-side; only give up after several
      // consecutive failures rather than on one dropped request.
      if (consecutiveNetworkFailures >= 5) {
        return {
          jobId,
          status: "failed",
          error: "Lost connection while creating your room. Please try again.",
        };
      }
    }

    if (status) {
      onUpdate?.(status);
      if (
        status.status === "succeeded" ||
        status.status === "failed" ||
        status.status === "unknown"
      ) {
        return status;
      }
    }

    await wait(intervalMs);
  }
}

/** Elapsed-time copy for the processing screen. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
