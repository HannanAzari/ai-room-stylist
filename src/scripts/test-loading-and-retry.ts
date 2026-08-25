/**
 * Waiting-screen pacing, the waiting carousel, and transient-failure handling.
 *
 * Run with:  npm run test:loading-retry
 *
 * The progress model is a pure function of elapsed time, so the whole curve is
 * asserted directly — including the two shapes that made the old screen feel
 * fake: stages that race, and a bar that fills then stalls. The retry and
 * state-preservation rules are asserted from source.
 *
 * No paid calls.
 */
import { readFileSync } from "node:fs";
import {
  generationProgress,
  GENERATION_STAGES,
  REFINEMENT_STAGES,
} from "@/features/room-stylist/hooks/useGenerationProgress";

const UI = readFileSync("src/components/studio/KoalaDesignStudio.tsx", "utf8");

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

const at = (seconds: number, stages = GENERATION_STAGES) =>
  generationProgress(seconds * 1000, stages);

console.log("\nProgress model — pacing");
{
  check("it starts at zero", at(0).fraction === 0);
  check("it starts on the first stage", at(0).stageIndex === 0);

  /**
   * The old screen advanced a stage every 2.6s regardless of what was
   * happening, so all five completed in about ten seconds. Anything that fast
   * is the fake-progress shape this model exists to avoid.
   */
  check("the first stage lasts long enough to be believable",
    at(5).stageIndex === 0, `stage ${at(5).stageIndex} at 5s`);
  check("it has NOT raced through every stage in ten seconds",
    at(10).stageIndex < GENERATION_STAGES.length - 1,
    `stage ${at(10).stageIndex} at 10s`);
  check("it reaches the final stage only after a real wait",
    at(30).stageIndex < GENERATION_STAGES.length - 1 &&
      at(70).stageIndex === GENERATION_STAGES.length - 1,
    `${at(30).stageIndex} at 30s, ${at(70).stageIndex} at 70s`);

  const samples = [0, 5, 10, 20, 30, 45, 60, 90, 120, 240, 600];
  const fractions = samples.map((s) => at(s).fraction);
  check("progress never goes backwards",
    fractions.every((value, index) => index === 0 || value >= fractions[index - 1]),
    fractions.map((f) => f.toFixed(3)).join(" "));
  check("progress never exceeds 1", fractions.every((value) => value <= 1));

  /**
   * The other half of the old problem: a bar that finishes long before the
   * image does. This one keeps creeping and never arrives.
   */
  check("the bar keeps moving deep into the wait",
    at(240).fraction > at(120).fraction && at(600).fraction > at(240).fraction,
    `${at(120).fraction.toFixed(3)} → ${at(240).fraction.toFixed(3)} → ${at(600).fraction.toFixed(3)}`);
  check("the bar NEVER completes while still running",
    at(3600).fraction < 1, at(3600).fraction.toFixed(4));
  check("the tail creeps rather than jumps",
    at(240).fraction - at(120).fraction < 0.1,
    `${(at(240).fraction - at(120).fraction).toFixed(3)}`);

  // A typical measured render should look meaningfully underway, not nearly done.
  check("a 45s render reads as mid-way, not almost finished",
    at(45).fraction > 0.35 && at(45).fraction < 0.75, at(45).fraction.toFixed(3));
  check("a 77s render (the measured three-edit room) is well along",
    at(77).fraction > 0.7 && at(77).fraction < 0.9, at(77).fraction.toFixed(3));

  check("negative elapsed time is treated as zero", at(-10).fraction === 0);
}

console.log("\nProgress model — stages");
{
  check("stage labels are distinct",
    new Set(GENERATION_STAGES.map((s) => s.label)).size === GENERATION_STAGES.length);
  check("no stage label repeats another's wording",
    !GENERATION_STAGES.some((a, i) =>
      GENERATION_STAGES.some((b, j) => i !== j && b.label.includes(a.label))));
  check("the last stage is open-ended, so it cannot 'finish' early",
    !Number.isFinite(GENERATION_STAGES[GENERATION_STAGES.length - 1].durationMs));
  check("every other stage has a real duration",
    GENERATION_STAGES.slice(0, -1).every((s) => Number.isFinite(s.durationMs) && s.durationMs > 0));
  check("no stage mentions models, prompts or providers",
    !GENERATION_STAGES.some((s) => /gemini|model|prompt|render|api/i.test(s.label)));

  check("refinement has its own, shorter set of stages",
    REFINEMENT_STAGES.length < GENERATION_STAGES.length);
  check("refinement also ends open-ended",
    !Number.isFinite(REFINEMENT_STAGES[REFINEMENT_STAGES.length - 1].durationMs));
  check("refinement reaches its last stage sooner than a full generation",
    at(25, REFINEMENT_STAGES).stageIndex === REFINEMENT_STAGES.length - 1 &&
      at(25).stageIndex < GENERATION_STAGES.length - 1);
}

console.log("\nWaiting screen");
{
  check("the heading is the stage label", /\{waitProgress\.label\}/.test(UI));
  check("the old fixed-interval message list is gone", !/loadingMessages/.test(UI));
  check("the heading is no longer repeated below the bar",
    !/\{refining\s*\n?\s*\? "Updating your room"/.test(UI));
  check("one continuous bar replaces the per-stage segments",
    /style=\{\{ width: `\$\{Math\.round\(displayedProgress \* 100\)\}%` \}\}/.test(UI));
  check("the step counter is honest about how many stages there are",
    /Step \{waitProgress\.stageIndex \+ 1\} of \{waitStages\.length\}/.test(UI));
  check("elapsed time is still shown", /formatElapsed\(generationElapsedMs\)/.test(UI));
  check("progress is driven by real elapsed time, not a fixed timer",
    /generationProgress\(generationElapsedMs, waitStages\)/.test(UI));
  check("a refine uses the refinement stages",
    /refining \? REFINEMENT_STAGES : GENERATION_STAGES/.test(UI));
}

console.log("\nWaiting carousel — Koala inspiration, not generic tips");
{
  check("a carousel component exists", /function WaitingCarousel\(/.test(UI));
  check("it is shown while waiting", /<WaitingCarousel/.test(UI));
  check("it shows the customer's own chosen pieces",
    /products=\{selectedProductsForWait\}/.test(UI) &&
      /eyebrow: "Your selection"/.test(UI));

  /**
   * The tips were replaced: generic waiting advice reads as filler on a
   * premium brand. Real catalogue room photography is used instead.
   */
  check("generic customer tips are gone", !/Styling tip/.test(UI));
  check("it shows Koala room photography", /eyebrow: "Koala inspiration"/.test(UI));
  check("the imagery comes from the catalogue, not new assets",
    /inspiration=\{inspirationImages\}/.test(UI) &&
      /getLifestyleImageUrls\(/.test(UI));
  check("the captions match the brief",
    /Matching your \$\{roomType\.toLowerCase\(\)\} with Koala pieces/.test(UI) &&
      /Curating your look/.test(UI) &&
      /Building your room package/.test(UI));
  check("images are decorative, so the caption carries the meaning",
    /alt=""/.test(UI) && /aria-hidden/.test(UI));
  check("images load lazily, keeping the screen light",
    /loading="lazy"/.test(UI));
  check("it rotates rather than sitting still",
    /index=\{loadingIndex\}/.test(UI) && /slides\[index % slides\.length\]/.test(UI));
  check("it shows dots so the rotation reads as deliberate",
    /dot === index % slides\.length/.test(UI));
  check("it never renders an empty carousel",
    /if \(slides\.length === 0\)/.test(UI));
}

console.log("\nProgress handoff — the bar finishes before the result appears");
{
  check("a completion step exists", /async function completeProgress\(\)/.test(UI));
  check("the bar is driven to 100% on completion",
    /const displayedProgress = progressComplete \? 1 : waitProgress\.fraction;/.test(UI));
  check("the completion is short and intentional, not an extra wait",
    /const PROGRESS_COMPLETE_MS = (2\d\d|3\d\d|4\d\d|500);/.test(UI));
  check("it runs only after the result is actually in hand",
    /saveResultCache\(nextConcepts, nextProducts\);[\s\S]{0,120}await completeProgress\(\);/.test(UI));
  check("a refine and swap complete the same way",
    /saveResultCache\(updatedConcepts, updatedProducts\);\s*\n\s*await completeProgress\(\);/.test(UI));
  check("the heading acknowledges completion", /Your room is ready/.test(UI));
  check("a FAILURE is never dressed up as a completed render",
    !/catch[\s\S]{0,300}completeProgress\(\)/.test(UI));
  check("the flag resets when a run starts and when it ends",
    /setGenerationElapsedMs\(0\);\s*\n\s*setProgressComplete\(false\);/.test(UI));
}

console.log("\nTransient failures — one retry, never a loop");
{
  check("a busy provider is retried automatically",
    /if \(!startResponse\.ok && startData\?\.retryable === true\)/.test(UI));
  check("the retry waits before trying again",
    /await new Promise\(\(resolve\) => setTimeout\(resolve, TRANSIENT_RETRY_DELAY_MS\)\)/.test(UI));
  check("the customer is told a retry is happening",
    /The studio is busy right now — trying once more\./.test(UI));
  /**
   * The initial call is `let startResponse = await startGeneration()`, so the
   * bare reassignment — the retry — must appear exactly once, and there must be
   * no loop around it. Retrying a saturated provider repeatedly makes the
   * outage worse and leaves the customer on a screen that never resolves.
   */
  const retryAssignments = (UI.match(/(?<!let )startResponse = await startGeneration\(\)/g) ?? []).length;
  check("EXACTLY ONE retry — there is no loop",
    retryAssignments === 1 &&
      !/while \([^)]*startGeneration/.test(UI) &&
      !/for \([^)]*startGeneration/.test(UI),
    `${retryAssignments} retry assignments`);
  check("only a provider-flagged failure is retried, not every error",
    !/if \(!startResponse\.ok\) \{\s*\n\s*setNotice/.test(UI));
  check("the retry delay is a named constant",
    /const TRANSIENT_RETRY_DELAY_MS = \d+/.test(UI));
}

console.log("\nDouble-submit — a paid request cannot be launched twice");
{
  /**
   * `setLoading(true)` does not take effect until React re-renders, so two taps
   * landing in the same frame both sail past a `loading` check — and disabling
   * the button has exactly the same hole. Only a ref updates synchronously.
   */
  const FLIGHT = readFileSync("src/features/room-stylist/hooks/useSingleFlight.ts", "utf8");
  check("the guard is a ref, not state", /const inFlight = useRef\(false\)/.test(FLIGHT));
  check("state alone is not relied on to block a second tap",
    !/useState/.test(FLIGHT));
  check("claiming is synchronous and reports whether it won",
    /begin: \(\) => \{\s*\n\s*if \(inFlight\.current\) return false;\s*\n\s*inFlight\.current = true;\s*\n\s*return true;/.test(FLIGHT));
  check("the ref is never read from anything reachable during render",
    !/generationFlight\.(begin|end)\(\)/.test(UI.slice(UI.indexOf("function renderStep"), UI.indexOf("function renderStep") + 400)));

  const claims = (UI.match(/if \(!generationFlight\.begin\(\)\) return;/g) ?? []).length;
  const releases = (UI.match(/generationFlight\.end\(\);/g) ?? []).length;
  check("both paid paths claim the guard", claims === 2, `${claims} claims`);
  check("both paid paths release it", releases === 2, `${releases} releases`);
  check("every claim has a matching release", claims === releases);

  check("generation claims before committing",
    /if \(!generationFlight\.begin\(\)\) return;\s*\n\s*\n?\s*setError\(""\);\s*\n\s*setNotice\(""\)/.test(UI));
  check("refinement — and therefore Swap — claims the same guard",
    /if \(!generationFlight\.begin\(\)\) return;\s*\n\s*\n?\s*setError\(""\);\s*\n\s*setRefining\(true\)/.test(UI));

  /**
   * The release must sit in `finally`, or a thrown request leaves the guard set
   * and the customer can never generate again without reloading.
   */
  check("the guard is released in finally, so a failure cannot wedge the app",
    /\} finally \{\s*\n\s*generationFlight\.end\(\);\s*\n\s*setLoading\(false\)/.test(UI) &&
      /\} finally \{\s*\n\s*generationFlight\.end\(\);\s*\n\s*setRefining\(false\)/.test(UI));
  check("the confirm button is also disabled while running, as a second line",
    /confirmDisabled=\{loading \|\| refining\}/.test(UI));
}

console.log("\nManual retry and state preservation");
{
  check("a Try again button is offered for retryable failures",
    /\{error && retryableError && \(/.test(UI) && /Try again/.test(UI));
  check("it re-runs the generation directly",
    /onClick=\{\(\) => void handleGenerate\(\)\}[\s\S]{0,200}Try again/.test(UI));
  check("a non-retryable error gets no false promise of a retry",
    /\{error && !retryableError && \(/.test(UI));
  check("the retryable flag is set from the server's own signal",
    /setRetryableError\(startData\?\.retryable === true\)/.test(UI));
  check("a polled job failure is also classified",
    /setRetryableError\(\/try again in a moment\|at capacity\|rate limited\/i\.test\(reason\)\)/.test(UI));
  check("the flag is cleared when a new run starts",
    /setRetryableError\(false\);/.test(UI));

  /**
   * State preservation is by omission: the failure path must not reset the
   * photo, the room type or the product picks. Asserted by checking the
   * failure branch does not call the resetters.
   */
  const failureBranch = UI.slice(
    UI.indexOf("Generation failed to start."),
    UI.indexOf("Generation failed to start.") + 700
  );
  check("failing does not clear the uploaded photo", !/setImage\(null\)/.test(failureBranch));
  check("failing does not clear the room type", !/setRoomType\(/.test(failureBranch));
  check("failing does not clear the chosen products",
    !/setChosenSeatingProducts\(\{\}\)/.test(failureBranch) &&
      !/setSelectedProductIds\(\[\]\)/.test(failureBranch));
  check("failing does not send the customer back a step", !/setStep\(/.test(failureBranch));
  check("failing does not clear the customer note", !/setCustomerNote\(/.test(failureBranch));
  check("failing does not clear the design mode", !/setDesignMode\(/.test(failureBranch));
  /**
   * The note is only ever cleared by the explicit New room action, so a
   * transient failure leaves everything the customer typed intact.
   */
  check("the customer note is cleared only by an explicit reset",
    (UI.match(/setCustomerNote\(""\)/g) ?? []).length === 1);
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failures.length}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All loading and retry tests passed.");
