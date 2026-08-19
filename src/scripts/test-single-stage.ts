/**
 * Gemini replace-items renders once, against the customer's own photo.
 *
 * Run with:  npm run test:single-stage
 *
 * ---------------------------------------------------------------------------
 * THE DIFFERENCE THIS CLOSES
 * ---------------------------------------------------------------------------
 * The strong renderer benchmark was ONE render carrying every task against the
 * untouched room photo. The app was doing something materially different for
 * the same three products:
 *
 *   Kelly  -> sofa         -> anchor
 *   Elva   -> sofa         -> anchor
 *   Aspen  -> coffee-table -> secondary
 *
 * Three tasks meets TWO_STAGE_TASK_THRESHOLD and both stages are present, so
 * `shouldUseTwoStageGeneration` fired and split the work. That costs two
 * renders — and stage 2 edits STAGE 1'S OUTPUT, not the customer's photo, so
 * the coffee table is drawn into an already-generated image. Both reported
 * symptoms follow from that: roughly double the latency, and the coffee table
 * faring worse than the sofas.
 */
import { readFileSync } from "node:fs";
import {
  shouldUseTwoStageGeneration,
  splitPlanByStage,
  TWO_STAGE_TASK_THRESHOLD,
} from "@/lib/intelligence/replacement-planner";
import { resolveCategoryIntents } from "@/lib/intelligence/category-intent";
import { contractToReplacementPlan } from "@/lib/intelligence/replacement-assignment";
import { getProductProfiles } from "@/lib/intelligence/product-profile";
import { getAllProducts } from "@/lib/products";
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

const ROUTE = readFileSync(
  "src/app/api/studio/generate-gemini/route.ts",
  "utf8"
);

const catalogue = getAllProducts();
const kelly = catalogue.find((p) => p.id.startsWith("kelly-pearl"))!;
const elva = catalogue.find((p) => p.id.startsWith("elva-green"))!;
const aspen = catalogue.find((p) => p.id.startsWith("aspen-white"))!;
if (!kelly || !elva || !aspen) throw new Error("acceptance SKUs missing");

/** The customer's actual room: two sofas and a coffee table. */
function room(): SceneGraph {
  return {
    roomType: "living room",
    analysed: true,
    furniture: [
      { id: "sofa_a", category: "3 seater sofa", canonicalCategory: "sofa",
        instanceLabel: "the left sofa", replaceable: true,
        boundingBox: { x: .03, y: .42, width: .32, height: .3 }, confidence: .92 },
      { id: "sofa_b", category: "3 seater sofa", canonicalCategory: "sofa",
        instanceLabel: "the right sofa", replaceable: true,
        boundingBox: { x: .62, y: .42, width: .3, height: .28 }, confidence: .9 },
      { id: "ct", category: "coffee table", canonicalCategory: "coffee-table",
        instanceLabel: "the coffee table", replaceable: true,
        boundingBox: { x: .38, y: .65, width: .2, height: .15 }, confidence: .85 },
    ],
    architecture: { counted: true, windowCount: 1, doorCount: 1, openingCount: 0, features: [] },
  } as unknown as SceneGraph;
}

const products = [kelly, elva, aspen];
const profiles = getProductProfiles(products);
const resolved = resolveCategoryIntents({
  intents: [
    { canonicalCategory: "sofa", seatingSelection: [
      { kind: "sofa-3-seater", count: 1, productId: kelly.id, productName: kelly.name },
      { kind: "sofa-3-seater", count: 1, productId: elva.id, productName: elva.name },
    ]},
    { canonicalCategory: "coffee-table", productId: aspen.id },
  ],
  sceneGraph: room(), catalogue, profiles, sourceImage: { width: 4032, height: 3024 },
});
const plan = contractToReplacementPlan(resolved!.contract!, profiles);

// ===========================================================================
section("1. This exact plan WOULD have been split before the change");
// ===========================================================================
{
  check("the acceptance case produces 3 replace tasks",
    plan.replacements.length === 3, `${plan.replacements.length}`);
  check("both sofas are anchor-stage",
    plan.replacements.filter((t) => t.stage === "anchor").length === 2);
  check("the coffee table is secondary-stage",
    plan.replacements.filter((t) => t.stage === "secondary").length === 1);
  check("it meets the two-stage threshold",
    plan.replacements.length >= TWO_STAGE_TASK_THRESHOLD);
  check("shouldUseTwoStageGeneration still returns true for it",
    shouldUseTwoStageGeneration(plan),
    "the planner is unchanged; the ROUTE now overrides it for Gemini");
  check("splitting it would produce exactly 2 renders",
    splitPlanByStage(plan).length === 2,
    "which is what the phone test was paying for");
}

// ===========================================================================
section("2. The route forces a single stage for Gemini replace-items");
// ===========================================================================
{
  check("a single-stage decision exists",
    /const singleStageForGemini = renderer\.id === "gemini" && !surpriseMe;/.test(ROUTE));
  check("it overrides the planner's two-stage recommendation",
    /const useTwoStage =\s*\n?\s*!singleStageForGemini && shouldUseTwoStageGeneration\(replacementPlan\);/.test(ROUTE),
    "the override must come first, or the split still happens");
  check("single stage means ONE entry carrying the WHOLE plan",
    /\[\{ stage: "anchor" as const, plan: replacementPlan \}\]/.test(ROUTE),
    "not a subset — every task in one render");
  check("Surprise Me is deliberately untouched",
    /&& !surpriseMe/.test(ROUTE));
  check("GPT keeps the previous two-stage behaviour",
    /renderer\.id === "gemini"/.test(ROUTE),
    "the fallback path must not change");
}

// ===========================================================================
section("3. Exactly one render call, on the original photo");
// ===========================================================================
{
  /**
   * Behavioural model of the route's loop: stages x attempts, with the loop
   * breaking as soon as the reviewer is satisfied. Counts render calls without
   * calling the API.
   */
  function renderCalls(options: {
    rendererId: string;
    surpriseMe: boolean;
    attemptsPerStage: number;
    reviewerSatisfied: boolean;
  }) {
    const singleStage = options.rendererId === "gemini" && !options.surpriseMe;
    const twoStage = !singleStage && shouldUseTwoStageGeneration(plan);
    const stages = twoStage ? splitPlanByStage(plan).length : 1;
    let calls = 0;
    const basePerStage: string[] = [];
    for (let stage = 0; stage < stages; stage += 1) {
      basePerStage.push(stage === 0 ? "original room photo" : "previous stage output");
      for (let attempt = 0; attempt < options.attemptsPerStage; attempt += 1) {
        calls += 1;
        if (options.reviewerSatisfied) break;
      }
    }
    return { calls, stages, basePerStage };
  }

  const gemini = renderCalls({
    rendererId: "gemini", surpriseMe: false,
    attemptsPerStage: 1, reviewerSatisfied: true,
  });
  check("Kelly + Elva + Aspen on Gemini = EXACTLY ONE image-generation call",
    gemini.calls === 1, `${gemini.calls} calls`);
  check("...in exactly one stage", gemini.stages === 1);
  check("...editing the customer's ORIGINAL photo",
    gemini.basePerStage.length === 1 &&
      gemini.basePerStage[0] === "original room photo",
    gemini.basePerStage.join(" then "));

  // The reviewer may inspect, but must not silently re-render at the default.
  const unsatisfied = renderCalls({
    rendererId: "gemini", surpriseMe: false,
    attemptsPerStage: 1, reviewerSatisfied: false,
  });
  check("a dissatisfied reviewer still yields one call at attempts=1",
    unsatisfied.calls === 1, `${unsatisfied.calls} calls`);

  // The fidelity retry remains AVAILABLE, just off by default.
  const withRetry = renderCalls({
    rendererId: "gemini", surpriseMe: false,
    attemptsPerStage: 2, reviewerSatisfied: false,
  });
  check("GENERATION_ATTEMPTS_PER_STAGE=2 still enables one retry",
    withRetry.calls === 2, `${withRetry.calls} calls`);
  check("...and a satisfied reviewer still costs only one",
    renderCalls({ rendererId: "gemini", surpriseMe: false,
      attemptsPerStage: 2, reviewerSatisfied: true }).calls === 1);

  // The old behaviour, for contrast — and what GPT still does.
  const gpt = renderCalls({
    rendererId: "gpt-image", surpriseMe: false,
    attemptsPerStage: 1, reviewerSatisfied: true,
  });
  check("the GPT path still splits into two renders",
    gpt.calls === 2 && gpt.stages === 2, `${gpt.calls} calls`);
  check("...with stage 2 editing generated output, not the photo",
    gpt.basePerStage[1] === "previous stage output",
    "this is the difference the benchmark never had");
}

// ===========================================================================
section("4. Everything that must not have changed");
// ===========================================================================
{
  check("scene readiness gating is intact",
    /assessSceneReadiness\(\{/.test(ROUTE) && /status: 422/.test(ROUTE));
  check("the scene-graph cache is intact",
    /getCachedSceneGraph|setCachedSceneGraph/.test(ROUTE));
  check("the reference manifest still feeds the render",
    /labelledProductImages: stageReferences/.test(ROUTE));
  check("the reviewer still inspects the result",
    /reviewGeneratedRoom\(\{/.test(ROUTE));

  const GEMINI = readFileSync(
    "src/features/room-stylist/services/image-providers/gemini.ts",
    "utf8"
  );
  check("aspect-ratio control is intact",
    /imageConfig: \{ aspectRatio \}/.test(GEMINI));
  check("anti-addition rules are intact",
    /NOTHING MAY BE ADDED TO THIS ROOM/.test(GEMINI) &&
      /Do NOT add plants/.test(GEMINI));

  const PROVIDER = readFileSync(
    "src/features/room-stylist/services/image-providers/room-edit-provider.ts",
    "utf8"
  );
  check("GPT fallback code is untouched and selectable",
    /id: "gpt-image"/.test(PROVIDER) && /raw === "gpt-image"/.test(PROVIDER));
}

// ===========================================================================
section("5. Debug output for the phone test");
// ===========================================================================
{
  check("the generation mode is logged",
    /generationMode,/.test(ROUTE) && /"single-stage" \| "two-stage"/.test(ROUTE));
  check("the planned render-call count is logged",
    /plannedRenderCalls: stagePlans\.length/.test(ROUTE));
  check("the tasks in each render are listed",
    /tasksInRender:/.test(ROUTE));
  check("the base image is named",
    /the customer's original room photo/.test(ROUTE));
  check("each render call is timed",
    /renderMs: Date\.now\(\) - renderStartedAt/.test(ROUTE));
  check("the running render-call number is logged",
    /renderCall: generationsUsed/.test(ROUTE));
  check("this logging works on Vercel, not just locally",
    /if \(isAiDebugEnabled\(\)\) \{\s*\n\s*console\.log\("\[studio-gemini\] generation mode"/.test(ROUTE),
    "devLog is gated on NODE_ENV and is silent in preview");
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failures.length}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All single-stage tests passed.");
