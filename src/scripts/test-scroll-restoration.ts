/**
 * Regression tests for result-page scroll restoration.
 *
 * Run with:  npm run test:scroll
 *
 * The bug: after generating, the Result page opened part-way down, showing
 * products before the generated room. The cause was that the app shell is
 * `h-dvh overflow-hidden`, so the WINDOW never scrolls — an inner element owns
 * the scroll, and its `scrollTop` survived the step change.
 *
 * These tests guard the two things that actually made it break:
 *   1. the scroll owner is the inner container, not the window;
 *   2. the reset fires for every new primary result, and again after layout so
 *      a late image decode cannot restore the old offset.
 *
 * No DOM framework is used — the relevant behaviour is modelled directly, and
 * the source is asserted against so the real component cannot drift away from
 * it silently.
 */
import { readFileSync } from "fs";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(t: string) {
  console.log(`\n${t}`);
}

const STUDIO = readFileSync(
  "src/components/studio/KoalaDesignStudio.tsx",
  "utf8"
);

/**
 * Source with comments stripped. Assertions about what the code DOES must not
 * be satisfied — or broken — by prose that merely mentions an API.
 */
const STUDIO_CODE = STUDIO.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /^\s*\/\/.*$/gm,
  ""
);

// --- 1. The scroll owner is the container, not the window ------------------
section("1. The scroll owner is the inner container");
{
  check("the app shell does not scroll (h-dvh + overflow-hidden)",
    /<main className="h-dvh overflow-hidden/.test(STUDIO));
  check("the canvas does not scroll either",
    /v2-canvas[^"]*h-dvh[^"]*overflow-hidden/.test(STUDIO));
  check("an inner container owns the scroll",
    /min-h-0 flex-1 overflow-y-auto/.test(STUDIO));
  check("that container carries the ref",
    /ref=\{scrollContainerRef\}[\s\S]{0,400}min-h-0 flex-1 overflow-y-auto/.test(
      STUDIO
    ),
    "the ref must be on the scrolling element");

  // The trap this bug came from: window.scrollTo does nothing in this layout.
  check("no window/document scrolling is used for the reset",
    !/window\.scrollTo\(|document\.documentElement\.scrollTop\s*=|document\.body\.scrollTop\s*=/.test(
      STUDIO_CODE
    ),
    "the window is not the scroll owner here");
}

// --- 2. The reset runs before paint, and again after layout ---------------
section("2. The reset survives layout and late image decode");
{
  check("the reset uses useLayoutEffect, not useEffect",
    /useLayoutEffect\(\(\) => \{[\s\S]{0,500}scrollTop = 0/.test(STUDIO),
    "useEffect would paint the old offset first");
  check("it re-applies on the next frame",
    /requestAnimationFrame\([\s\S]{0,120}scrollTop = 0/.test(STUDIO),
    "a late image decode can otherwise restore the offset");
  check("the frame is cancelled on cleanup",
    /cancelAnimationFrame/.test(STUDIO));
  check("scroll anchoring is disabled on the container",
    /overflowAnchor: "none"/.test(STUDIO),
    "anchoring re-adjusts the offset as images load");
  check("the scroll is not animated",
    !/scrollTop[\s\S]{0,80}behavior:\s*"smooth"/.test(STUDIO));
}

// --- 3. Every new primary result triggers a reset --------------------------
section("3. Every new primary result resets the scroll");
{
  check("the effect keys off the step and the result epoch",
    /\}, \[step, resultEpoch\]\);/.test(STUDIO));

  const bumps = STUDIO.match(/setResultEpoch\(\(epoch\) => epoch \+ 1\)/g) || [];
  check("the epoch is bumped at every result transition",
    bumps.length >= 3, `${bumps.length} bump sites`);

  // Generation, refinement and cache restore all produce a primary result.
  check("a new generation bumps it",
    /setSelectedConceptIndex\(0\);\s*\n\s*\/\/[^\n]*\n\s*setResultEpoch/.test(
      STUDIO
    ));
  check("a refinement bumps it",
    /refinedIndex\);[\s\S]{0,200}setResultEpoch/.test(STUDIO));
  check("a restored cached result bumps it",
    /cachedConcepts\.length > 0[\s\S]{0,200}setResultEpoch/.test(STUDIO));
}

// --- 4. Existing scroll behaviour is not broken ---------------------------
section("4. Existing behaviour still intact");
{
  check("'Shop this room' still scrolls to the shop section",
    /room-shop-section[\s\S]{0,120}scrollIntoView/.test(STUDIO));
  check("...and it is still smooth",
    /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/.test(STUDIO));

  // The reset must not depend on anything that changes when the customer taps
  // "Shop this room", or it would yank them back up.
  check("the reset cannot be triggered by in-page navigation",
    !/\}, \[step, resultEpoch, [^\]]+\]\);/.test(STUDIO),
    "extra dependencies risk fighting the user's own scrolling");
}

// --- 5. Behavioural model of the reset ------------------------------------
section("5. Behavioural model");
{
  // A minimal stand-in for the scroll container plus the effect's logic.
  function makeContainer(initialTop: number) {
    return { scrollTop: initialTop };
  }
  function applyReset(el: { scrollTop: number }) {
    el.scrollTop = 0;
    // the queued frame
    return () => {
      el.scrollTop = 0;
    };
  }

  const deepScrolled = makeContainer(1840);
  const frame = applyReset(deepScrolled);
  check("a deeply scrolled container resets immediately",
    deepScrolled.scrollTop === 0, `${deepScrolled.scrollTop}`);

  // Simulate a late image decode shifting the offset back down.
  deepScrolled.scrollTop = 620;
  frame();
  check("a later shift is corrected on the next frame",
    deepScrolled.scrollTop === 0, `${deepScrolled.scrollTop}`);

  const alreadyTop = makeContainer(0);
  applyReset(alreadyTop);
  check("a container already at the top is unaffected",
    alreadyTop.scrollTop === 0);
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All scroll-restoration tests passed.");
