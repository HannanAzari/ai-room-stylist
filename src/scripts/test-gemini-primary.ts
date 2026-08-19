/**
 * Gemini as the primary renderer — framing, additions, and the readiness gate.
 *
 * Run with:  npm run test:gemini-primary
 *
 * ---------------------------------------------------------------------------
 * WHAT THE BENCHMARK ACTUALLY DIFFERED BY
 * ---------------------------------------------------------------------------
 * The strong benchmark result was not a different pipeline. It differed from
 * the app in exactly four ways, and each is now closed here:
 *
 *   1. model      gemini-3-pro-image, not gemini-2.5-flash-image
 *   2. provider   ROOM_EDIT_PROVIDER=gemini, not the gpt-image default
 *   3. analysis   a downscaled copy and a budget above the real latency tail,
 *                 so the scene graph was populated rather than silently empty
 *   4. gating     the run aborted unless detection found the target items
 *
 * The square crop was NOT one of them — it was present in the benchmark too,
 * caused by nine 1000x1000 product references dragging the output to square,
 * and is fixed here by requesting the room's own aspect ratio.
 */
import { readFileSync } from "node:fs";
import {
  nearestAspectRatio,
  DEFAULT_GEMINI_IMAGE_MODEL,
} from "@/features/room-stylist/services/image-providers/gemini";
import { assessSceneReadiness } from "@/lib/intelligence/scene-readiness";
import type { SceneGraph } from "@/lib/intelligence/scene-graph";

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

const GEMINI = readFileSync(
  "src/features/room-stylist/services/image-providers/gemini.ts",
  "utf8"
);
/**
 * Provider source with comments stripped. The note explaining WHY
 * imageConfig.aspectRatio was removed quotes the line verbatim as a restore
 * instruction, so an assertion about what the code DOES must not read prose.
 */
const GEMINI_CODE = GEMINI.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /^\s*\/\/.*$/gm,
  ""
);
const ROUTE = readFileSync(
  "src/app/api/studio/generate-gemini/route.ts",
  "utf8"
);
const SCENE = readFileSync("src/lib/intelligence/scene-graph.ts", "utf8");

// ===========================================================================
section("1. Gemini is primary, GPT is retained as a fallback");
// ===========================================================================
{
  // Asserted from source rather than imported: room-edit-provider pulls in the
  // GPT provider, which constructs the OpenAI client eagerly and throws without
  // a key — so importing it would make this suite need credentials it does not
  // use.
  const PROVIDER_SRC = readFileSync(
    "src/features/room-stylist/services/image-providers/room-edit-provider.ts",
    "utf8"
  );
  check("the default renderer is gemini",
    /DEFAULT_ROOM_EDIT_PROVIDER: RoomEditProviderId = "gemini"/.test(PROVIDER_SRC));
  check("the default model is the benchmarked one",
    DEFAULT_GEMINI_IMAGE_MODEL === "gemini-3-pro-image",
    DEFAULT_GEMINI_IMAGE_MODEL);

  check("GPT Image is still a selectable provider",
    /id: "gpt-image"/.test(PROVIDER_SRC),
    "it must remain a working fallback, not dead code");
  check("ROOM_EDIT_PROVIDER=gpt-image still selects it",
    /raw === "gpt-image"/.test(PROVIDER_SRC));
  check("the GPT provider module is still present",
    readFileSync("src/features/room-stylist/services/image-providers/gpt-image.ts", "utf8").length > 0);
  check("the model stays env-overridable",
    /process\.env\.GEMINI_IMAGE_MODEL/.test(GEMINI));
}

// ===========================================================================
section("2. The room's framing is preserved");
// ===========================================================================
{
  // 4032x3024 is the iPhone photo from the benchmark.
  check("a 4:3 phone photo maps to 4:3",
    nearestAspectRatio(4032, 3024) === "4:3", nearestAspectRatio(4032, 3024));
  check("a portrait phone photo maps to 3:4",
    nearestAspectRatio(3024, 4032) === "3:4", nearestAspectRatio(3024, 4032));
  check("a 16:9 shot maps to 16:9",
    nearestAspectRatio(1920, 1080) === "16:9", nearestAspectRatio(1920, 1080));
  check("a genuinely square photo maps to 1:1",
    nearestAspectRatio(1000, 1000) === "1:1");
  check("an ultrawide shot maps to 21:9",
    nearestAspectRatio(2520, 1080) === "21:9", nearestAspectRatio(2520, 1080));
  check("a 3:2 DSLR shot maps to 3:2",
    nearestAspectRatio(6000, 4000) === "3:2", nearestAspectRatio(6000, 4000));

  // The regression this exists for: landscape must never become square.
  for (const [w, h] of [[4032, 3024], [1920, 1080], [1600, 900], [6000, 4000]]) {
    check(`${w}x${h} does not collapse to 1:1`,
      nearestAspectRatio(w, h) !== "1:1", nearestAspectRatio(w, h));
  }
  check("unmeasurable dimensions fall back to 4:3, never square",
    nearestAspectRatio(0, 0) === "4:3");

  /**
   * The model now chooses its own framing. imageConfig.aspectRatio is a
   * GENERATION-TIME conditioning parameter, and the benchmark render that
   * produced the good fidelity sent none — so it is removed to isolate that
   * variable. `nearestAspectRatio` is retained and still exercised above,
   * because restoring the line must stay a one-line change.
   */
  check("NO imageConfig is sent to the API",
    !/imageConfig/.test(GEMINI_CODE),
    "aspect conditioning is the variable under test");
  check("the room's ratio is still measured, for the log",
    /nearestAspectRatio\(metadata\.width \?\? 0, metadata\.height \?\? 0\)/.test(GEMINI_CODE));
  check("EXIF rotation is applied before measuring",
    /\.rotate\(\)\.metadata\(\)/.test(GEMINI_CODE),
    "a portrait photo would otherwise be measured as landscape");
}

// ===========================================================================
section("3. Nothing may be added to the room");
// ===========================================================================
{
  check("plants are explicitly forbidden",
    /Do NOT add plants/.test(GEMINI),
    "a hallucinated plant appeared in the benchmark render");
  check("decor and ornaments are forbidden",
    /Do NOT add decor, vases, bowls/.test(GEMINI));
  check("extra furniture is forbidden",
    /Do NOT add any furniture beyond the numbered tasks/.test(GEMINI));
  check("wall art and mirrors are forbidden",
    /Do NOT add wall art, mirrors/.test(GEMINI));
  check("tidying and restyling are forbidden",
    /Do NOT tidy, restyle/.test(GEMINI),
    "the customer's clutter is part of their room");
  check("the only differences are the numbered tasks",
    /The ONLY differences between the input photo and your output are the numbered tasks/.test(GEMINI));

  // The shared prompt builder keeps its own prohibitions.
  const PROMPT = readFileSync("src/lib/intelligence/prompt-builder.ts", "utf8");
  check("the shared prompt still forbids invented furniture",
    /Never invent furniture that is not in the plan/.test(PROMPT));
  check("...and still forbids unexplained additions in concept-off mode",
    /Generate ONLY the requested replacements/.test(PROMPT));
}

// ===========================================================================
section("4. Scene readiness — the gate that stops a wasted render");
// ===========================================================================
{
  const room = (items: Array<[string, string]>): SceneGraph =>
    ({
      roomType: "living room",
      analysed: true,
      furniture: items.map(([canonicalCategory, instanceLabel], index) => ({
        id: `item_${index}`,
        category: canonicalCategory,
        canonicalCategory,
        instanceLabel,
        replaceable: true,
        boundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        confidence: 0.9,
      })),
      architecture: { counted: true, windowCount: 1, doorCount: 1, openingCount: 0, features: [] },
    }) as unknown as SceneGraph;

  const full = room([
    ["sofa", "the left sofa"],
    ["sofa", "the right sofa"],
    ["coffee-table", "the coffee table"],
  ]);

  const ok = assessSceneReadiness({
    sceneGraph: full,
    requestedCategories: ["coffee-table"],
  });
  check("a readable room with the target present is ready", ok.ready);
  check("...and reports what it detected",
    ok.detectedByCategory["sofa"] === 2 && ok.detectedByCategory["coffee-table"] === 1);

  // The exact benchmark failure: analysis returned nothing.
  const empty = { ...full, analysed: false, furniture: [] } as unknown as SceneGraph;
  const unread = assessSceneReadiness({
    sceneGraph: empty,
    requestedCategories: ["coffee-table"],
  });
  check("an unanalysed room is NOT ready", !unread.ready);
  check("...and says so in customer-safe language",
    /could not read the furniture/i.test(unread.reason ?? ""), unread.reason);
  check("...and never mentions timeouts or internals",
    !/timeout|scene graph|null|undefined/i.test(unread.reason ?? ""));

  // Analysed, but the requested item genuinely is not there.
  const noTable = room([["sofa", "the left sofa"]]);
  const missing = assessSceneReadiness({
    sceneGraph: noTable,
    requestedCategories: ["coffee-table"],
  });
  check("a missing target category is NOT ready", !missing.ready);
  check("...and names the missing item",
    /coffee table/i.test(missing.reason ?? ""), missing.reason);
  check("...and lists it in missingCategories",
    missing.missingCategories.includes("coffee-table"));

  const multi = assessSceneReadiness({
    sceneGraph: noTable,
    requestedCategories: ["coffee-table", "rug"],
  });
  check("several missing items are all named",
    multi.missingCategories.length === 2 &&
      /coffee table/i.test(multi.reason ?? "") && /rug/i.test(multi.reason ?? ""),
    multi.reason);

  check("no requested categories means nothing to block",
    assessSceneReadiness({ sceneGraph: full, requestedCategories: [] }).ready);
}

// ===========================================================================
section("5. The gate is wired into the route, before any spend");
// ===========================================================================
{
  check("the route assesses readiness",
    /assessSceneReadiness\(\{/.test(ROUTE));
  check("it refuses with 422 rather than rendering",
    /status: 422/.test(ROUTE));
  check("the refusal carries a machine-readable flag",
    /sceneUnreadable: true/.test(ROUTE));
  check("the check happens BEFORE the renderer is invoked",
    ROUTE.indexOf("assessSceneReadiness({") < ROUTE.indexOf("renderer.generate("),
    "a gate after the paid call would be pointless");
  check("seating is exempt from the category check",
    /isSeatingCategory\(roomType, category\)/.test(ROUTE),
    "seating states a desired final count, not an existing target");
  check("Surprise Me is exempt",
    /!surpriseMe && categoryIntents\.length > 0/.test(ROUTE),
    "it has no requested categories to verify");
}

// ===========================================================================
section("6. Analysis reliability — why the graph was empty at all");
// ===========================================================================
{
  check("the analysis image is downscaled",
    /ANALYSIS_MAX_EDGE/.test(SCENE) && /fit: "inside"/.test(SCENE));
  check("...with EXIF rotation applied first",
    /\.rotate\(\)[\s\S]{0,200}ANALYSIS_MAX_EDGE/.test(SCENE));
  check("...and falls back to the original if it cannot be resized",
    /Never let a decode problem block analysis/.test(SCENE));
  check("the timeout clears the measured latency tail",
    /\|\| 120_000;/.test(SCENE),
    "42-95s measured against a 45s budget failed more often than it succeeded");
  check("the timeout stays env-overridable",
    /SCENE_ANALYSIS_TIMEOUT_MS/.test(SCENE));
  check("the scene graph is still cached per photo",
    /getCachedSceneGraph|setCachedSceneGraph/.test(ROUTE),
    "so a retry does not pay for analysis twice");
}

// ===========================================================================
section("7. Debug output for every generation");
// ===========================================================================
{
  check("detected room items are logged",
    /detectedItems:/.test(ROUTE));
  check("replacement tasks are logged",
    /replaceTasks:/.test(ROUTE));
  check("the model used is logged",
    /model: geminiImageModel\(\)/.test(GEMINI));
  check("the log records that nothing was requested",
    /requestedAspectRatio: null/.test(GEMINI_CODE));
  check("...beside the room's own ratio",
    /roomAspectRatio: aspectRatio/.test(GEMINI_CODE),
    "so the log shows room ratio vs what the model actually returned");
  check("the ACTUAL output size is measured, not assumed",
    /outputSize = `\$\{meta\.width\}x\$\{meta\.height\}`/.test(GEMINI),
    "'did it come back square?' is the regression being watched");
  check("products and references are logged",
    /referenceLabels:/.test(GEMINI) && /buildGroundingDebugPacket/.test(ROUTE));
  check("render logging is behind the debug flag",
    /ENABLE_AI_DEBUG\?\.toLowerCase\(\) === "true"/.test(GEMINI));
  // Scoped to the log CALL, not everything after it — the return statement
  // below legitimately carries the base64 payload.
  const renderLogStart = GEMINI.indexOf('console.log("[gemini-render]"');
  const renderLogBlock = GEMINI.slice(renderLogStart, GEMINI.indexOf("});", renderLogStart));
  check("no image bytes are logged",
    renderLogStart > -1 &&
      !/imageBase64,/.test(renderLogBlock) &&
      !/data:/.test(renderLogBlock),
    "only sizes and labels belong in a log line");
}

// ===========================================================================
section("8. The deployment can be checked before spending a generation");
// ===========================================================================
{
  const STATUS = readFileSync("src/app/api/ai-debug/status/route.ts", "utf8");

  check("it reports the RESOLVED renderer, not the code default",
    /getRoomEditProvider\(\)/.test(STATUS),
    "an env var outranks the default; that is the thing being checked");
  check("it flags an env override of the renderer",
    /overriddenByEnv: Boolean\(process\.env\.ROOM_EDIT_PROVIDER/.test(STATUS));
  check("it reports the effective Gemini model",
    /effective:\s*\n?\s*process\.env\.GEMINI_IMAGE_MODEL\?\.trim\(\) \|\| DEFAULT_GEMINI_IMAGE_MODEL/.test(STATUS));
  check("it reports the scene-analysis timeout",
    /timeoutMs: sceneTimeoutMs/.test(STATUS));
  check("...and whether it clears the measured tail",
    /meetsRecommendedMinimum: sceneTimeoutMs >= 120_000/.test(STATUS));

  // Secrets must never leave this endpoint.
  check("API keys are reported as booleans only",
    /geminiApiKey: Boolean\(process\.env\.GEMINI_API_KEY/.test(STATUS) &&
      /openAiApiKey: Boolean\(process\.env\.OPENAI_API_KEY/.test(STATUS));
  check("no key value can be returned",
    !/GEMINI_API_KEY\?\.trim\(\),/.test(STATUS) &&
      !/apiKey: process\.env/.test(STATUS),
    "presence only, never the value");
  check("the whole report stays behind ENABLE_AI_DEBUG",
    /if \(!enabled\) return NextResponse\.json\(\{ enabled: false \}\);/.test(STATUS),
    "and the original bare-boolean contract is preserved");
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failures.length}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All gemini-primary tests passed.");
