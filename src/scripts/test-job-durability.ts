/**
 * Async generation must never run on a non-durable store in production.
 *
 * Run with:  npm run test:job-durability
 *
 * ---------------------------------------------------------------------------
 * THE BUG
 * ---------------------------------------------------------------------------
 * Deployed Studio showed "We lost track of this generation. Please try again."
 *
 * With no KV configured, `getJobStore()` fell back to an in-process Map. On
 * serverless that Map lives in ONE instance: the POST created the job on
 * instance A, the status GET landed on instance B and found nothing, and the
 * client gave up. Meanwhile `after()` on instance A ran the render to
 * COMPLETION — so the image was generated and BILLED, then discarded when that
 * lambda recycled. The customer paid for an image they never saw, and the error
 * invited them to try again and pay a second time.
 *
 * The fix is a capability check before a job id is ever handed out. Without
 * durable storage the route does the work synchronously in the same request,
 * which is the path that worked before async existed.
 */
import { readFileSync } from "node:fs";
import {
  supportsDurableGenerationJobs,
  inMemoryJobsAllowed,
  generationJobCapability,
} from "@/features/room-stylist/services/generation-jobs/job-store";

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
function section(t: string) {
  console.log(`\n${t}`);
}

/** Run with a temporary environment, restoring it afterwards. */
function withEnv<T>(env: Record<string, string | undefined>, run: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const NO_KV = {
  KV_REST_API_URL: undefined,
  KV_REST_API_TOKEN: undefined,
  UPSTASH_REDIS_REST_URL: undefined,
  UPSTASH_REDIS_REST_TOKEN: undefined,
};
const WITH_KV = {
  KV_REST_API_URL: "https://example.upstash.io",
  KV_REST_API_TOKEN: "test-token-not-a-real-secret",
  UPSTASH_REDIS_REST_URL: undefined,
  UPSTASH_REDIS_REST_TOKEN: undefined,
};

// ===========================================================================
section("A. Production without KV does NOT start an in-memory async job");
// ===========================================================================
{
  withEnv({ ...NO_KV, NODE_ENV: "production", ALLOW_IN_MEMORY_GENERATION_JOBS: undefined }, () => {
    check("async is unavailable", !supportsDurableGenerationJobs());
    check("in-memory jobs are not allowed", !inMemoryJobsAllowed());
    check("capability reports no backend",
      generationJobCapability().backend === "none",
      generationJobCapability().backend);
    check("...and reports KV as not configured",
      generationJobCapability().kvConfigured === false);
  });

  // The escape hatch must NOT work in production, even if someone sets it.
  withEnv({ ...NO_KV, NODE_ENV: "production", ALLOW_IN_MEMORY_GENERATION_JOBS: "true" }, () => {
    check("the local-dev opt-in is ignored in production",
      !supportsDurableGenerationJobs(),
      "an in-memory job in production costs a render and returns nothing");
  });
}

// ===========================================================================
section("B. It safely uses synchronous generation instead");
// ===========================================================================
{
  const ROUTE = readFileSync(
    "src/app/api/studio/generate-gemini/route.ts",
    "utf8"
  );

  check("the route checks the capability before creating a job",
    /if \(!supportsDurableGenerationJobs\(\)\) \{[\s\S]{0,400}return handleGeneration\(/.test(ROUTE),
    "the check must precede job creation");
  check("the capability check comes BEFORE createJobId",
    ROUTE.indexOf("supportsDurableGenerationJobs()") < ROUTE.indexOf("const jobId = createJobId()"),
    "a job id handed out first cannot be taken back");
  check("the fallback reuses the already-read form body",
    /return handleGeneration\(req, \{ preloadedFormData: formData \}\)/.test(ROUTE),
    "re-reading a consumed request body would fail");
  check("the fallback is logged so it is never silent",
    /async generation unavailable; using the synchronous path/.test(ROUTE));
  check("no job id is returned on the synchronous path",
    ROUTE.indexOf("return handleGeneration(req, { preloadedFormData: formData })") <
      ROUTE.indexOf("const jobId = createJobId()"));

  const STUDIO = readFileSync(
    "src/components/studio/KoalaDesignStudio.tsx",
    "utf8"
  );
  check("the client polls only when the server returned a job id",
    /const jobId =\s*\n?\s*typeof startData\.jobId === "string" \? startData\.jobId : null;/.test(STUDIO));
  check("...and treats a job-less response as the finished result",
    /Synchronous fallback: this response IS the result/.test(STUDIO));
  check("the client no longer errors when there is no job id",
    !/typeof startData\.jobId !== "string"[\s\S]{0,120}Generation failed to start/.test(STUDIO));
}

// ===========================================================================
section("C. Production WITH durable KV uses async jobs");
// ===========================================================================
{
  withEnv({ ...WITH_KV, NODE_ENV: "production" }, () => {
    check("async is available", supportsDurableGenerationJobs());
    check("the backend is KV", generationJobCapability().backend === "kv-rest");
    check("KV is reported configured", generationJobCapability().kvConfigured);
  });

  // The Upstash-native variable names must work identically.
  withEnv({
    ...NO_KV,
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "test-token-not-a-real-secret",
    NODE_ENV: "production",
  }, () => {
    check("the UPSTASH_* naming is accepted too", supportsDurableGenerationJobs());
  });

  // A half-configured store is not durable.
  withEnv({ ...NO_KV, KV_REST_API_URL: "https://example.upstash.io", NODE_ENV: "production" }, () => {
    check("a URL without a token is NOT durable",
      !supportsDurableGenerationJobs(),
      "half-configured storage would fail at the first write");
  });
}

// ===========================================================================
section("D. Local dev may still use in-memory jobs, deliberately");
// ===========================================================================
{
  withEnv({ ...NO_KV, NODE_ENV: "development", ALLOW_IN_MEMORY_GENERATION_JOBS: "true" }, () => {
    check("in-memory jobs are allowed when explicitly enabled",
      inMemoryJobsAllowed() && supportsDurableGenerationJobs());
    check("the backend reports memory",
      generationJobCapability().backend === "memory");
  });

  withEnv({ ...NO_KV, NODE_ENV: "development", ALLOW_IN_MEMORY_GENERATION_JOBS: undefined }, () => {
    check("dev without the opt-in also stays synchronous",
      !supportsDurableGenerationJobs(),
      "opt-in, not opt-out — the default must be the safe path");
  });
}

// ===========================================================================
section("E. A missing job cannot trigger a second paid generation");
// ===========================================================================
{
  const CLIENT = readFileSync(
    "src/features/room-stylist/services/generation-jobs/client.ts",
    "utf8"
  );
  const STUDIO = readFileSync(
    "src/components/studio/KoalaDesignStudio.tsx",
    "utf8"
  );

  check("an unknown job is terminal, never retried",
    /status\.status === "unknown"/.test(CLIENT) &&
      !/status === "unknown"[\s\S]{0,200}fetchStudioGemini/.test(CLIENT),
    "re-POSTing on a lost job would start a second billed render");
  check("polling never issues a generation request",
    !/fetchStudioGemini|formData/.test(CLIENT),
    "the poller reads status only");
  check("the resume path polls, it does not regenerate",
    /readPendingJob\(\)[\s\S]{0,600}pollGenerationJob/.test(STUDIO) &&
      !/readPendingJob\(\)[\s\S]{0,600}fetchStudioGemini/.test(STUDIO));
  check("a non-durable remembered job is discarded, not resumed",
    /job\.durable !== true/.test(CLIENT));
  check("retrying is a deliberate user action, not automatic",
    /We lost track of this generation\. Please try again\./.test(STUDIO) &&
      !/setTimeout[\s\S]{0,120}handleGenerate/.test(STUDIO));
}

// ===========================================================================
section("F. Nothing else about generation changed");
// ===========================================================================
{
  const ROUTE = readFileSync(
    "src/app/api/studio/generate-gemini/route.ts",
    "utf8"
  );
  check("ROOM_EDIT_PROVIDER still selects the renderer",
    /getRoomEditProvider\(\)/.test(ROUTE));
  check("generation attempts still default to 1",
    /if \(!Number\.isFinite\(configured\) \|\| configured < 1\) return 1;/.test(ROUTE));
  check("the enriched reference budget is unchanged",
    /MAX_TRANSMITTED_REFERENCES_GPT_IMAGE/.test(ROUTE));
  check("the grounding debug packet is still built",
    /buildGroundingDebugPacket/.test(ROUTE));
  check("maxDuration still covers a long render",
    /export const maxDuration = 300;/.test(ROUTE));
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failures.length}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All job-durability tests passed.");
