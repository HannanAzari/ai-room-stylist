/**
 * Async generation jobs — store, polling and restoration.
 *
 * Run with:  npm run test:generation-jobs
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SUITE EXISTS FOR
 * ---------------------------------------------------------------------------
 * A render takes 2-3 minutes behind a blocking spinner. The UX cost is obvious;
 * the real defect is that a refresh — or iOS Safari discarding a backgrounded
 * tab, which it does readily — killed the in-flight request and silently threw
 * away a render the customer had already paid and waited for.
 *
 * The job id is what makes the result survive that. These tests cover the parts
 * that decide whether it actually does: the store contract, restoration rules,
 * and polling's behaviour on flaky networks and stuck jobs. No network, no
 * timers — the clock and fetch are injected.
 */
import {
  createMemoryStore,
  createJobId,
  newJob,
  type JobStore,
} from "@/features/room-stylist/services/generation-jobs/job-store";
import {
  formatElapsed,
  generationStatusUrl,
  pollGenerationJob,
  readPendingJob,
  rememberPendingJob,
  forgetPendingJob,
  PENDING_JOB_MAX_AGE_MS,
  type JobStatusResponse,
} from "@/features/room-stylist/services/generation-jobs/client";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title: string) {
  console.log(`\n${title}`);
}

/** Minimal localStorage stand-in, including the Safari-private-mode throw. */
function installStorage(options: { throwOnAccess?: boolean } = {}) {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => {
      if (options.throwOnAccess) throw new Error("SecurityError");
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (options.throwOnAccess) throw new Error("SecurityError");
      map.set(k, v);
    },
    removeItem: (k: string) => {
      if (options.throwOnAccess) throw new Error("SecurityError");
      map.delete(k);
    },
  };
  (globalThis as { window?: unknown }).window = { localStorage: store };
  return { map, store };
}

async function run() {
  // =========================================================================
  section("1. The store contract");
  // =========================================================================
  {
    const store: JobStore = createMemoryStore();
    const jobId = createJobId();

    check("a job id is unique and prefixed",
      jobId.startsWith("job_") && createJobId() !== jobId);
    check("a new job starts queued", newJob(jobId).status === "queued");

    await store.create(newJob(jobId));
    const created = await store.get(jobId);
    check("a created job is readable", created?.jobId === jobId);
    check("timestamps are set",
      Boolean(created?.createdAt) && Boolean(created?.updatedAt));

    await store.update(jobId, { status: "running", stage: "rendering" });
    const running = await store.get(jobId);
    check("status updates persist", running?.status === "running");
    check("stage updates persist", running?.stage === "rendering");
    check("createdAt is not clobbered by an update",
      running?.createdAt === created?.createdAt);

    await store.update(jobId, { status: "succeeded", result: { images: [1] } });
    const done = await store.get(jobId);
    check("a result is stored on success",
      (done?.result as { images: number[] })?.images.length === 1);

    check("an unknown job reads back as null",
      (await store.get("job_does_not_exist")) === null);

    // Updating a job that does not exist must be a no-op, not a resurrection.
    await store.update("job_missing", { status: "succeeded" });
    check("updating a missing job does not create one",
      (await store.get("job_missing")) === null);

    check("the memory store declares itself non-durable", !store.isDurable);
    check("it names its backend", store.backend === "memory");
  }

  // =========================================================================
  section("2. Restoration rules — what is worth resuming");
  // =========================================================================
  {
    const now = 1_000_000_000;
    installStorage();

    check("nothing remembered means nothing to resume",
      readPendingJob(now) === null);

    rememberPendingJob({ jobId: "job_a", startedAt: now - 30_000, durable: true, roomType: "living room" });
    const fresh = readPendingJob(now);
    check("a fresh durable job is resumable", fresh?.jobId === "job_a");
    check("...and carries its context back", fresh?.roomType === "living room");

    // The honest case: a non-durable job cannot be found from a fresh load, so
    // offering to resume it would strand the customer on a screen that never
    // resolves.
    forgetPendingJob();
    rememberPendingJob({ jobId: "job_b", startedAt: now - 1000, durable: false });
    check("a NON-durable job is not offered for resume",
      readPendingJob(now) === null,
      "it could never be found, so resuming would hang forever");
    check("...and it is cleared rather than left to rot",
      readPendingJob(now + 1) === null);

    forgetPendingJob();
    rememberPendingJob({ jobId: "job_c", startedAt: now - PENDING_JOB_MAX_AGE_MS - 1, durable: true });
    check("a stale job is not resumed", readPendingJob(now) === null);

    forgetPendingJob();
    rememberPendingJob({ jobId: "job_d", startedAt: now - 1000, durable: true });
    forgetPendingJob();
    check("forgetting clears it", readPendingJob(now) === null);

    // Malformed records must never throw into the render path.
    installStorage().map.set("koala-studio-pending-generation", "{not json");
    check("malformed JSON is discarded, not thrown",
      readPendingJob(now) === null);
    installStorage().map.set("koala-studio-pending-generation", JSON.stringify({ durable: true }));
    check("a record with no jobId is discarded", readPendingJob(now) === null);
    installStorage().map.set("koala-studio-pending-generation", JSON.stringify({ jobId: "x", durable: true }));
    check("a record with no startedAt is discarded", readPendingJob(now) === null);

    // Safari private mode throws on localStorage access.
    installStorage({ throwOnAccess: true });
    check("a throwing localStorage degrades to 'nothing to resume'",
      readPendingJob(now) === null);
    let threw = false;
    try {
      rememberPendingJob({ jobId: "job_e", startedAt: now, durable: true });
    } catch {
      threw = true;
    }
    check("...and remembering never throws into the render path", !threw);
  }

  // =========================================================================
  section("3. Polling to a terminal state");
  // =========================================================================
  {
    const noWait = async () => {};
    const responses = (queue: JobStatusResponse[]) => {
      let index = 0;
      return async () =>
        ({
          json: async () => queue[Math.min(index++, queue.length - 1)],
        }) as unknown as Response;
    };

    const seen: string[] = [];
    const success = await pollGenerationJob({
      jobId: "job_1",
      wait: noWait,
      onUpdate: (status) => seen.push(status.status),
      fetchImpl: responses([
        { jobId: "job_1", status: "queued" },
        { jobId: "job_1", status: "running", stage: "rendering" },
        { jobId: "job_1", status: "succeeded", result: { ok: true } },
      ]),
    });
    check("polling resolves on success", success.status === "succeeded");
    check("the result is returned",
      (success.result as { ok: boolean })?.ok === true);
    check("every tick is reported to the UI",
      seen.join(",") === "queued,running,succeeded", seen.join(","));

    const failed = await pollGenerationJob({
      jobId: "job_2",
      wait: noWait,
      fetchImpl: responses([{ jobId: "job_2", status: "failed", error: "Renderer unavailable." }]),
    });
    check("polling resolves on failure", failed.status === "failed");
    check("the error message is carried back",
      failed.error === "Renderer unavailable.");

    const unknown = await pollGenerationJob({
      jobId: "job_3",
      wait: noWait,
      fetchImpl: responses([{ jobId: "job_3", status: "unknown" }]),
    });
    check("an unknown job is terminal, not an infinite poll",
      unknown.status === "unknown");
  }

  // =========================================================================
  section("4. Polling survives a flaky network but not a dead one");
  // =========================================================================
  {
    const noWait = async () => {};
    let call = 0;
    const flaky = async () => {
      call += 1;
      // Two dropped requests, then the job completes.
      if (call <= 2) throw new Error("network");
      return {
        json: async () => ({ jobId: "job_4", status: "succeeded", result: { ok: 1 } }),
      } as unknown as Response;
    };
    const recovered = await pollGenerationJob({
      jobId: "job_4", wait: noWait, fetchImpl: flaky,
    });
    check("a transient blip does not abandon a running render",
      recovered.status === "succeeded",
      "the render is still going server-side; giving up discards it");

    const dead = await pollGenerationJob({
      jobId: "job_5",
      wait: noWait,
      fetchImpl: async () => {
        throw new Error("network");
      },
    });
    check("a sustained outage does eventually fail", dead.status === "failed");
    check("...with a customer-safe message",
      /Lost connection/.test(dead.error ?? ""), dead.error);
  }

  // =========================================================================
  section("5. A stuck job cannot poll forever");
  // =========================================================================
  {
    let clock = 0;
    const stuck = await pollGenerationJob({
      jobId: "job_6",
      wait: async () => {
        clock += 5000;
      },
      now: () => clock,
      timeoutMs: 30_000,
      fetchImpl: async () =>
        ({ json: async () => ({ jobId: "job_6", status: "running" }) }) as unknown as Response,
    });
    check("a job stuck on 'running' times out", stuck.status === "failed");
    check("...with actionable copy",
      /taking longer than expected/.test(stuck.error ?? ""), stuck.error);
  }

  // =========================================================================
  section("6. Small surface details");
  // =========================================================================
  {
    check("the status URL encodes the job id",
      generationStatusUrl("a b&c").includes("a%20b%26c"),
      generationStatusUrl("a b&c"));
    check("elapsed under a minute reads in seconds",
      formatElapsed(42_000) === "42s", formatElapsed(42_000));
    check("elapsed over a minute reads m ss",
      formatElapsed(135_000) === "2m 15s", formatElapsed(135_000));
    check("elapsed pads the seconds",
      formatElapsed(65_000) === "1m 05s", formatElapsed(65_000));
    check("negative/zero elapsed is safe", formatElapsed(-5) === "0s");
  }

  // =========================================================================
  section("7. The route contract the client depends on");
  // =========================================================================
  {
    const { readFileSync } = await import("node:fs");
    const ROUTE = readFileSync(
      "src/app/api/studio/generate-gemini/route.ts",
      "utf8"
    );
    const STATUS = readFileSync(
      "src/app/api/studio/generate-gemini/status/route.ts",
      "utf8"
    );

    check("the async path is opt-in, leaving the sync path intact",
      /searchParams\.get\("async"\) === "1"/.test(ROUTE),
      "Surprise Me and the existing client must be unaffected");
    check("a job id is returned immediately",
      /return NextResponse\.json\(\{\s*jobId,/.test(ROUTE));
    check("the render continues after the response via after()",
      /after\(async \(\) => \{/.test(ROUTE));
    // Ordering, not proximity: the durability check now sits between these two,
    // so a fixed-width window would break on an unrelated edit.
    check("the form body is read BEFORE the response is sent",
      ROUTE.indexOf("const formData = await req.formData();") > -1 &&
        ROUTE.indexOf("const formData = await req.formData();") <
          ROUTE.indexOf("after(async () => {"),
      "a request body cannot be read from inside after()");
    check("maxDuration covers a 2-3 minute render",
      /export const maxDuration = 300;/.test(ROUTE));
    check("job failures are recorded, not just logged",
      /status: "failed",/.test(ROUTE));
    check("the status route reports durability to the client",
      /durable: store\.isDurable/.test(STATUS),
      "the client uses it to decide whether to promise restore");
    check("a missing job is a 404 with a reason, not a 500",
      /status: "unknown"/.test(STATUS) && /status: 404/.test(STATUS));
    check("the result is only returned once it exists",
      /job\.status === "succeeded" \? job\.result : undefined/.test(STATUS));

    check("generation attempts are configurable",
      /GENERATION_ATTEMPTS_PER_STAGE/.test(ROUTE));
    // Default is now 2, but the loop BREAKS as soon as the reviewer is
    // satisfied — so a good first render still costs exactly one. The second
    // attempt exists only to fix a fidelity failure the reviewer caught.
    check("...and default to one render plus a single fidelity retry",
      /if \(!Number\.isFinite\(configured\) \|\| configured < 1\) return 2;/.test(ROUTE),
      "one retry, deliberately not a chain");
    check("the loop still exits early when the review passes",
      /if \(!reviewRecommendsRegeneration\(outcome\.review\)\) break;/.test(ROUTE),
      "otherwise every generation would cost two renders");
    check("...and are bounded so a stray value cannot uncap spend",
      /Math\.min\(configured, 3\)/.test(ROUTE));
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Passed: ${passed}   Failed: ${failures.length}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("All generation-job tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
