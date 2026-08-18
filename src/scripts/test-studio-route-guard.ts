/**
 * The studio's single generation route — guard regression.
 *
 * Run with:  npm run test:route-guard
 *
 * ---------------------------------------------------------------------------
 * THE BUG
 * ---------------------------------------------------------------------------
 * Tapping "Generate my room" failed immediately with our own error:
 *
 *   "Studio uses a single generation route"
 *
 * `fetchStudioGemini` compared the WHOLE route string against the endpoint
 * constant. When generation moved to the async job path it began calling that
 * same endpoint with `?async=1`, and exact string equality treated the query
 * parameter as a different route — so the guard rejected the studio's own
 * endpoint. Both Studio modes share `handleGenerate`, so both were dead.
 *
 * The guard itself was NOT obsolete and is retained: its job is to stop the
 * browser reaching a different generation endpoint, which is exactly the
 * architecture rule that must hold. It now compares the path and ignores the
 * query string.
 */
import { readFileSync } from "node:fs";
import {
  STUDIO_GEMINI_ROUTE,
  fetchStudioGemini,
  assertStudioGeminiProvider,
} from "@/components/studio/studio-gemini-api";

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

/** Captures what the guard would have fetched, without a network call. */
function withStubbedFetch<T>(run: () => T): { calls: string[]; result: T } {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return { ok: true, json: async () => ({ jobId: "job_test" }) } as Response;
  }) as typeof globalThis.fetch;
  try {
    return { calls, result: run() };
  } finally {
    globalThis.fetch = real;
  }
}

async function run() {
  // =========================================================================
  section("1. The exact call the studio makes now succeeds");
  // =========================================================================
  {
    const { calls } = withStubbedFetch(() =>
      fetchStudioGemini(`${STUDIO_GEMINI_ROUTE}?async=1`, { method: "POST" })
    );
    await Promise.resolve();
    check("the async generation call is allowed through",
      calls.length === 1, `${calls.length} calls`);
    check("...and reaches the unified studio endpoint",
      calls[0] === `${STUDIO_GEMINI_ROUTE}?async=1`, calls[0]);

    const bare = withStubbedFetch(() =>
      fetchStudioGemini(STUDIO_GEMINI_ROUTE, { method: "POST" })
    );
    check("the bare route (refinement) still works",
      bare.calls[0] === STUDIO_GEMINI_ROUTE);
  }

  // =========================================================================
  section("2. The guard still blocks a genuinely different endpoint");
  // =========================================================================
  {
    const blocked = [
      "/api/generate-room",
      "/api/refine-room",
      "/api/studio/generate-openai",
      "/api/studio/generate-gemini-v2",
      "https://example.com/api/studio/generate-gemini",
      "/api/studio/generate",
    ];

    for (const route of blocked) {
      let threw = false;
      try {
        await fetchStudioGemini(route, { method: "POST" });
      } catch (error) {
        threw = /single generation route/.test((error as Error).message);
      }
      check(`blocked: ${route}`, threw, "the guard must not have been widened");
    }

    // A query string must not become a way to smuggle a different path in.
    let smuggled = false;
    try {
      await fetchStudioGemini("/api/generate-room?async=1", { method: "POST" });
    } catch {
      smuggled = true;
    }
    check("a query string cannot disguise a different route", smuggled);
  }

  // =========================================================================
  section("3. Provider is chosen server-side, never by the browser");
  // =========================================================================
  {
    // Both renderers are legitimate results from the one endpoint. Pinning the
    // vendor here would surface a server-side setting as a client-side error.
    let ok = true;
    try {
      assertStudioGeminiProvider("gpt-image");
      assertStudioGeminiProvider("gemini");
    } catch {
      ok = false;
    }
    check("both renderers are accepted from the studio route", ok);

    let rejected = false;
    try {
      assertStudioGeminiProvider("some-other-vendor");
    } catch {
      rejected = true;
    }
    check("an unknown provider is still rejected", rejected);

    const STUDIO = readFileSync(
      "src/components/studio/KoalaDesignStudio.tsx",
      "utf8"
    );
    const API = readFileSync(
      "src/components/studio/studio-gemini-api.ts",
      "utf8"
    );

    check("the browser never names a renderer when generating",
      !/ROOM_EDIT_PROVIDER/.test(STUDIO),
      "provider selection is a server concern");
    check("the client sends no provider parameter",
      !/formData\.append\("provider"/.test(STUDIO) &&
        !/[?&]provider=/.test(STUDIO));
    check("only one generation endpoint constant exists",
      (API.match(/= "\/api\/studio\/generate/g) || []).length === 1);
    check("the studio component calls no other generation route",
      !/["'`]\/api\/generate-room["'`]/.test(STUDIO) &&
        !/["'`]\/api\/refine-room["'`]/.test(STUDIO),
      "the legacy multi-provider route must stay unreachable from Studio");
  }

  // =========================================================================
  section("4. Both Studio modes reach the same call path");
  // =========================================================================
  {
    const STUDIO = readFileSync(
      "src/components/studio/KoalaDesignStudio.tsx",
      "utf8"
    );

    // Replace Items and Surprise Me both go through handleGenerate, so a break
    // in its single fetch kills both — which is what happened.
    check("Surprise Me generates via handleGenerate",
      /handleGenerate\("surprise-me"\)/.test(STUDIO));
    check("Replace Items generates via handleGenerate",
      /onClick=\{\(\) => void handleGenerate\(\)\}/.test(STUDIO) ||
        /onClick: \(\) => void handleGenerate\(\)/.test(STUDIO));
    check("there is exactly ONE generation fetch shared by both",
      (STUDIO.match(/fetchStudioGemini\(\s*`?\$\{STUDIO_GEMINI_ROUTE\}\?async=1/g) || [])
        .length === 1);
    check("generation goes through the guarded helper, not raw fetch",
      !/fetch\(\s*["'`]\/api\/studio\/generate-gemini/.test(STUDIO),
      "a raw fetch would bypass the single-route guarantee");

    // The async work must not have reintroduced a legacy generation helper.
    check("no legacy generation helper is used",
      !/generateWithProvider|callGemini|callOpenAI|generateRoomLegacy/.test(STUDIO));
    check("status polling targets the status sub-route, not a second generator",
      /generate-gemini\/status/.test(
        readFileSync(
          "src/features/room-stylist/services/generation-jobs/client.ts",
          "utf8"
        )
      ));
  }

  // =========================================================================
  section("5. The failure could not have cost money");
  // =========================================================================
  {
    const API = readFileSync(
      "src/components/studio/studio-gemini-api.ts",
      "utf8"
    );
    // The throw precedes the fetch, so nothing ever left the browser.
    const guardBeforeFetch =
      API.indexOf("throw new Error(STUDIO_ROUTE_ERROR)") <
      API.indexOf("return fetch(route, init)");
    check("the guard throws before any request is issued", guardBeforeFetch,
      "no provider call, and therefore no spend, was possible");
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Passed: ${passed}   Failed: ${failures.length}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("All studio route-guard tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
