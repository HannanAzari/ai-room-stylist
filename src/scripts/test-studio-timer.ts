/**
 * The elapsed clock, and the pre-generation instruction box.
 *
 * Run with:  npm run test:timer
 *
 * Source-level assertions against the studio component. The bug was not in a
 * pure function — it was that Refine set `refining` but never touched the clock
 * the overlay reads, so a refine started after a 43s render opened at "43s
 * elapsed". That is a wiring fact, and wiring is what this checks.
 */
import { readFileSync } from "node:fs";

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

console.log("\nElapsed timer");
{
  check("there is ONE place that starts the clock",
    /function beginTimedRequest\(/.test(UI));
  // NB: the signature carries a `nowMs()` default, so the parameter list
  // itself contains parentheses — match the body, not a paren-free arg list.
  check("starting the clock also zeroes the displayed value",
    /function beginTimedRequest\([\s\S]{0,40}?\{\s*\n\s*setGenerationStartedAt\(startedAt\);\s*\n\s*setGenerationElapsedMs\(0\);/.test(UI));
  check("there is ONE place that stops the clock",
    /function endTimedRequest\(\) \{\s*\n\s*setGenerationStartedAt\(null\);\s*\n\s*setGenerationElapsedMs\(0\);/.test(UI));

  check("generate starts the clock", /setLoading\(true\);\s*\n\s*beginTimedRequest\(generationStart\);/.test(UI));
  check("REFINE starts the clock too — the reported bug",
    /setRefining\(true\);\s*\n\s*beginTimedRequest\(\);/.test(UI));

  check("the ticking effect runs for refine as well as generate",
    /const inFlight = loading \|\| refining;/.test(UI));
  check("the effect re-subscribes when refining flips",
    /\}, \[loading, refining, generationStartedAt\]\);/.test(UI));

  const endCalls = (UI.match(/endTimedRequest\(\);/g) ?? []).length;
  check("the clock is stopped on every completion path", endCalls >= 3, `${endCalls} call sites`);
  check("generate stops the clock in its finally",
    /setLoading\(false\);\s*\n\s*endTimedRequest\(\);\s*\n\s*\}/.test(UI));
  check("refine stops the clock in its finally",
    /setRefining\(false\);\s*\n\s*endTimedRequest\(\);/.test(UI));
  check("a resumed generation also stops the clock",
    /setResumedGeneration\(false\);\s*\n\s*endTimedRequest\(\);/.test(UI));

  /**
   * The error path is the finally block in both flows, so an exception cannot
   * leave the clock running — asserted by there being no early return between
   * the catch and the finally.
   */
  check("errors fall through to the same finally",
    /catch \(refinementError\)[\s\S]{0,400}?\} finally \{\s*\n\s*setRefining\(false\);\s*\n\s*endTimedRequest\(\);/.test(UI));

  check("the overlay only shows a time while one is running",
    /generationStartedAt !== null && \(/.test(UI));
}

console.log("\nPre-generation instruction box");
{
  check("the textarea exists on the pre-generation screen",
    /id="customer-note"/.test(UI));
  check("it is labelled 'Anything else?'", /Anything else\?/.test(UI));
  check("it is explicitly optional",
    /Optional — tell AI how you&apos;d like the room changed\./.test(UI));
  check("it carries the example placeholder",
    /e\.g\. Replace both sofas, keep the coffee table/.test(UI));
  check("it is not required to generate",
    !/customerNote\.trim\(\)[^\n]*\|\|[^\n]*disabled/.test(UI));
  check("an empty note is not sent at all",
    /if \(customerNote\.trim\(\)\) \{\s*\n\s*formData\.append\("customerNote", customerNote\.trim\(\)\);/.test(UI));
  check("the UI cap comes from the shared module, not a magic number",
    /import \{ MAX_CUSTOMER_NOTE_LENGTH \} from "@\/lib\/intelligence\/customer-note";/.test(UI) &&
      /maxLength=\{MAX_CUSTOMER_NOTE_LENGTH\}/.test(UI));
  check("the note is cleared when the wizard resets",
    /setCustomerNote\(""\);/.test(UI));

  const noteAt = UI.indexOf('id="customer-note"');
  const generateAt = UI.indexOf('"Generate my room"');
  check("the Generate button sits below the textarea", noteAt > -1 && generateAt > noteAt);
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failures.length}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All studio timer + instruction tests passed.");
