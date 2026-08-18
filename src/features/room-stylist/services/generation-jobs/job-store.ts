/**
 * Generation job storage.
 *
 * ---------------------------------------------------------------------------
 * WHY A STORE AT ALL
 * ---------------------------------------------------------------------------
 * A room render takes 2-3 minutes. Holding the customer on a blocking spinner
 * that long is the UX problem this replaces, but the deeper issue is that a
 * single long request cannot survive a refresh: the in-flight fetch dies with
 * the page and the render is lost with it, having already been paid for.
 *
 * So the job has to live somewhere the NEXT request can find it. This module is
 * that somewhere, behind a deliberately tiny interface — three operations, no
 * queue semantics, no locking. The prototype needs durability across requests,
 * not a job framework.
 *
 * ---------------------------------------------------------------------------
 * BACKENDS
 * ---------------------------------------------------------------------------
 * - Upstash/Vercel KV over its REST API when configured. Chosen over the SDK so
 *   there is no new dependency and both env conventions work: Vercel KV
 *   (`KV_REST_API_*`) and a direct Upstash integration (`UPSTASH_REDIS_REST_*`).
 * - An in-process Map otherwise, so local dev works with no infrastructure.
 *   That is NOT durable on serverless — another instance sees nothing — and
 *   `isDurable` says so, so the UI can avoid promising a restore it cannot
 *   deliver rather than appearing to lose the customer's render.
 */

export type GenerationJobStatus = "queued" | "running" | "succeeded" | "failed";

export type GenerationJob = {
  jobId: string;
  status: GenerationJobStatus;
  /** Epoch ms. */
  createdAt: number;
  updatedAt: number;
  /**
   * Coarse progress for the processing screen. Deliberately a stage name, not
   * a percentage: a percentage we cannot measure would be a lie, and the stage
   * is genuinely known.
   */
  stage?: string;
  /** Present only when status is "succeeded" — the generation response body. */
  result?: unknown;
  /** Present only when status is "failed" — a customer-safe message. */
  error?: string;
};

export type JobStore = {
  /** True when a job survives across requests and instances. */
  isDurable: boolean;
  /** Backend name, for diagnostics. */
  backend: string;
  create(job: GenerationJob): Promise<void>;
  get(jobId: string): Promise<GenerationJob | null>;
  update(
    jobId: string,
    patch: Partial<Omit<GenerationJob, "jobId" | "createdAt">>
  ): Promise<void>;
};

/**
 * Jobs expire on their own. A render is minutes, not days, and a succeeded
 * record holds a full base64 image — leaving those in KV forever would be both
 * expensive and pointless.
 */
const JOB_TTL_SECONDS = 60 * 60;

export function kvCredentials() {
  const url =
    process.env.KV_REST_API_URL?.trim() ||
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    "";
  const token =
    process.env.KV_REST_API_TOKEN?.trim() ||
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    "";
  return { url, token, configured: Boolean(url && token) };
}

const jobKey = (jobId: string) => `koala:generation-job:${jobId}`;

export function createKvStore(url: string, token: string): JobStore {
  async function command(body: unknown[]): Promise<{ result?: unknown }> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      // Never serve a stale job record.
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Job store command failed with status ${response.status}.`);
    }
    return (await response.json()) as { result?: unknown };
  }

  async function read(jobId: string): Promise<GenerationJob | null> {
    const { result } = await command(["GET", jobKey(jobId)]);
    if (typeof result !== "string" || result.length === 0) return null;
    try {
      return JSON.parse(result) as GenerationJob;
    } catch {
      return null;
    }
  }

  async function write(job: GenerationJob) {
    await command([
      "SET",
      jobKey(job.jobId),
      JSON.stringify(job),
      "EX",
      JOB_TTL_SECONDS,
    ]);
  }

  return {
    isDurable: true,
    backend: "kv-rest",
    create: write,
    get: read,
    async update(jobId, patch) {
      // Read-modify-write, safe because exactly ONE writer (the `after`
      // callback that owns the job) ever mutates a record; pollers only read.
      const existing = await read(jobId);
      if (!existing) return;
      await write({ ...existing, ...patch, updatedAt: Date.now() });
    },
  };
}

/** Module-scoped so it survives between requests on one warm instance. */
const memoryJobs = new Map<string, GenerationJob>();

export function createMemoryStore(): JobStore {
  return {
    isDurable: false,
    backend: "memory",
    async create(job) {
      memoryJobs.set(job.jobId, job);
    },
    async get(jobId) {
      return memoryJobs.get(jobId) ?? null;
    },
    async update(jobId, patch) {
      const existing = memoryJobs.get(jobId);
      if (!existing) return;
      memoryJobs.set(jobId, { ...existing, ...patch, updatedAt: Date.now() });
    },
  };
}

let cachedStore: JobStore | null = null;

export function getJobStore(): JobStore {
  if (cachedStore) return cachedStore;
  const { url, token, configured } = kvCredentials();
  cachedStore = configured ? createKvStore(url, token) : createMemoryStore();
  return cachedStore;
}

/** Test seam — lets a suite assert both backends without env juggling. */
export function __setJobStoreForTests(store: JobStore | null) {
  cachedStore = store;
}

export function createJobId(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function newJob(jobId: string): GenerationJob {
  const now = Date.now();
  return { jobId, status: "queued", createdAt: now, updatedAt: now };
}
