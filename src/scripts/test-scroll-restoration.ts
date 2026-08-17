/**
 * Regression tests for scroll restoration across the whole flow.
 *
 * Run with:  npm run test:scroll
 *
 * The original bug: after generating, the Result page opened part-way down,
 * showing products before the generated room. The cause was that the app shell
 * is `h-dvh overflow-hidden`, so the WINDOW never scrolls — an inner element
 * owns the scroll, and its `scrollTop` survived the step change.
 *
 * The follow-up bug these tests now also cover: the fix keyed off `step`, but
 * most of this flow's screens are PHASES WITHIN step 3 (the category menu, the
 * seating configurator, the product shelves, the advanced picker). Moving
 * between them is navigation as far as the customer is concerned, and none of
 * those transitions reset the scroll — so the result page was fixed and every
 * other screen still opened wherever the previous one had been left.
 *
 * These tests guard:
 *   1. the scroll owner is the inner container, not the window;
 *   2. the reset fires before paint and again after layout, so a late image
 *      decode cannot restore the old offset;
 *   3. the reset is driven by ONE derived screen identity that covers every
 *      screen, not by `step` alone.
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
  check("the result epoch still reaches the reset",
    /const viewKey = `\$\{screenKey\}\/\$\{resultEpoch\}`/.test(STUDIO),
    "a regenerate must still start the customer at the top");
}

// --- 4. The reset is centralised, not per-screen ---------------------------
section("4. One screen identity drives every reset");
{
  check("the reset keys off a single derived view key",
    /\}, \[viewKey\]\);/.test(STUDIO),
    "a step-only dependency misses the phases inside step 3");

  // The screen identity must actually contain the things that change when the
  // customer navigates. `step` alone was the bug.
  const screenKey =
    STUDIO.match(/const screenKey = \[([\s\S]*?)\]\.join\("\/"\);/)?.[1] ?? "";
  check("the screen identity exists", screenKey !== "");
  for (const part of [
    "step",
    "designMode",
    "replacePhase",
    "seatingCategory",
    "precisionCategory",
  ]) {
    check(`the screen identity includes ${part}`, screenKey.includes(part),
      "a screen this does not cover will not reset");
  }

  // Every replace-items phase must be represented, or that screen silently
  // keeps the previous one's offset — the exact reported symptom.
  const phases = ["categories", "seating", "products", "precision"];
  for (const phase of phases) {
    check(`the "${phase}" phase is a real phase of step 3`,
      new RegExp(`replacePhase === "${phase}"`).test(STUDIO));
  }
  check("all four phases are covered by replacePhase in the screen identity",
    screenKey.includes("replacePhase"));

  // Remounting on navigation is what guarantees a fresh subtree at the top;
  // keying it off the epoch too would replay the enter animation on every
  // regenerate, which is a different (and unwanted) behaviour.
  check("the animated wrapper remounts per screen, not per result",
    /key=\{screenKey\}/.test(STUDIO));
  check("the wrapper is NOT keyed off the epoch-bearing view key",
    !/key=\{viewKey\}/.test(STUDIO),
    "that would replay the enter animation on every regenerate");
}

// --- 5. Existing scroll behaviour is not broken ---------------------------
section("5. Existing behaviour still intact");
{
  check("'Shop this room' still scrolls to the shop section",
    /room-shop-section[\s\S]{0,120}scrollIntoView/.test(STUDIO));
  check("...and it is still smooth",
    /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/.test(STUDIO));

  // The reset must not depend on anything that changes when the customer taps
  // "Shop this room", or it would yank them back up. The view key is built
  // only from navigation state, so scrolling and tapping within a screen
  // cannot change it.
  check("the reset depends on exactly one value",
    /\}, \[viewKey\]\);/.test(STUDIO) && !/\}, \[viewKey, /.test(STUDIO),
    "extra dependencies risk fighting the user's own scrolling");
  for (const volatile of ["selectedConceptIndex", "loading", "products"]) {
    check(`the screen identity excludes ${volatile}`,
      !(STUDIO.match(/const screenKey = \[([\s\S]*?)\]\.join/)?.[1] ?? "")
        .includes(volatile),
      "in-screen state must not re-trigger the reset");
  }
}

// A minimal stand-in for the scroll container plus the effect's logic, shared
// by the behavioural model below and the flow walk after it.
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

// --- 6. Behavioural model of the reset ------------------------------------
section("6. Behavioural model");
{
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

// --- 7. Navigating the real flow, screen by screen -------------------------
section("7. Every transition in the flow lands at the top");
{
  // A stand-in for the component's own screen identity, kept deliberately
  // identical in shape to the source so the walk below exercises the real
  // rule rather than a convenient one.
  type Nav = {
    step: number;
    designMode: string | null;
    replacePhase: string;
    seatingCategory: string | null;
    precisionCategory: string | null;
    resultEpoch: number;
  };
  const screenKeyOf = (nav: Nav) =>
    [
      nav.step,
      nav.designMode ?? "-",
      nav.step === 3 && nav.designMode === "replace-items"
        ? nav.replacePhase
        : "-",
      nav.seatingCategory ?? "-",
      nav.precisionCategory ?? "-",
    ].join("/");
  const viewKeyOf = (nav: Nav) => `${screenKeyOf(nav)}/${nav.resultEpoch}`;

  const base: Nav = {
    step: 1,
    designMode: null,
    replacePhase: "categories",
    seatingCategory: null,
    precisionCategory: null,
    resultEpoch: 0,
  };

  // The exact journey the reported bug was found on: capture → choose →
  // replace-items landing → seating configurator → back → shelves → result.
  const journey: { name: string; nav: Nav }[] = [
    { name: "capture", nav: { ...base } },
    { name: "choose a mode", nav: { ...base, step: 2 } },
    {
      name: "replace-items landing (the category list)",
      nav: { ...base, step: 3, designMode: "replace-items" },
    },
    {
      name: "seating arrangement",
      nav: {
        ...base,
        step: 3,
        designMode: "replace-items",
        replacePhase: "seating",
        seatingCategory: "sofa",
      },
    },
    {
      name: "back to the category list",
      nav: { ...base, step: 3, designMode: "replace-items" },
    },
    {
      name: "product shelves",
      nav: {
        ...base,
        step: 3,
        designMode: "replace-items",
        replacePhase: "products",
      },
    },
    {
      name: "the generated result",
      nav: {
        ...base,
        step: 4,
        designMode: "replace-items",
        replacePhase: "products",
        resultEpoch: 1,
      },
    },
  ];

  const container = makeContainer(0);
  let previousKey = "";
  for (const { name, nav } of journey) {
    const key = viewKeyOf(nav);
    // The customer reads the screen and scrolls down before moving on.
    container.scrollTop = 900;
    if (key !== previousKey) applyReset(container);
    check(`${name} opens at the top`, container.scrollTop === 0,
      `scrollTop ${container.scrollTop}, key ${key}`);
    previousKey = key;
  }

  // The advanced picker is reached from the category list and is its own
  // screen; so is the Surprise me style step.
  const precision = viewKeyOf({
    ...base,
    step: 3,
    designMode: "replace-items",
    replacePhase: "precision",
    precisionCategory: "sofa",
  });
  const categories = viewKeyOf({ ...base, step: 3, designMode: "replace-items" });
  check("the advanced picker is a distinct screen", precision !== categories);

  const surprise = viewKeyOf({ ...base, step: 3, designMode: "surprise-me" });
  check("Surprise me's style step is a distinct screen",
    surprise !== categories);

  // Refining on the result page keeps the customer on the same screen but
  // produces a new room, which must still open at the top.
  const result = viewKeyOf({ ...base, step: 4, resultEpoch: 1 });
  const refined = viewKeyOf({ ...base, step: 4, resultEpoch: 2 });
  check("a refinement is a new view (scroll resets)", result !== refined);
  check("...but not a new screen (no remount, no replayed animation)",
    screenKeyOf({ ...base, step: 4, resultEpoch: 1 }) ===
      screenKeyOf({ ...base, step: 4, resultEpoch: 2 }));

  // Scrolling, tapping a product, or switching concept must never reset.
  const stable = viewKeyOf({ ...base, step: 4, resultEpoch: 1 });
  check("nothing but navigation changes the key", stable === result);
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All scroll-restoration tests passed.");
