/**
 * Deterministic tests for the region-first design-mode state model.
 *
 * Run with:  npm run test:design-mode
 *
 * These guard the boundary between the new customer-facing intent
 * (`DesignMode`) and the generation pipeline's existing wire contract
 * (`aiConceptMode`), plus the region model the selection UI will populate.
 */
import {
  assignSelectionCategory,
  createManualSelection,
  designModeToConceptMode,
  hasUsableArea,
  isDesignMode,
  resetSelectionIds,
  DESIGN_MODES,
  type DesignMode,
} from "@/lib/intelligence/room-selection";

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

function section(title: string) {
  console.log(`\n${title}`);
}

section("Design mode");
{
  check("exactly two modes exist", DESIGN_MODES.length === 2);
  check("replace-items is a mode", isDesignMode("replace-items"));
  check("surprise-me is a mode", isDesignMode("surprise-me"));
  check("the old toggle name is not a mode", !isDesignMode("aiConceptMode"));
  check("null is not a mode", !isDesignMode(null));
  check("an arbitrary string is not a mode", !isDesignMode("replace"));
  check("a boolean is not a mode", !isDesignMode(true));
}

section("Mode → pipeline wire contract");
{
  // "Replace items" must add nothing of its own; "Surprise me" completes the
  // room. These map onto the flag the existing pipeline already understands.
  check(
    "replace-items disables concept mode",
    designModeToConceptMode("replace-items") === false
  );
  check(
    "surprise-me enables concept mode",
    designModeToConceptMode("surprise-me") === true
  );
  check(
    "the mapping is total and boolean",
    DESIGN_MODES.every(
      (mode) => typeof designModeToConceptMode(mode) === "boolean"
    )
  );
  check(
    "the two modes map to different pipeline behaviour",
    designModeToConceptMode("replace-items") !==
      designModeToConceptMode("surprise-me")
  );
}

section("Generation gating by mode");
{
  // Mirrors `canGenerateConcept` in the studio: replace-items needs at least
  // one product because it adds nothing on its own; surprise-me does not.
  function canGenerate(mode: DesignMode | null, selectedCount: number): boolean {
    if (!mode) return false;
    if (mode === "replace-items") return selectedCount > 0;
    return true;
  }

  check("no mode chosen cannot generate", !canGenerate(null, 3));
  check(
    "replace-items with no products cannot generate",
    !canGenerate("replace-items", 0)
  );
  check(
    "replace-items with products can generate",
    canGenerate("replace-items", 1)
  );
  check(
    "surprise-me with no products can generate",
    canGenerate("surprise-me", 0)
  );
  check(
    "surprise-me with products can generate",
    canGenerate("surprise-me", 2)
  );
}

section("Room selection model");
{
  resetSelectionIds();
  const SOURCE = { width: 1400, height: 1050 };

  const manual = createManualSelection({
    boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.25 },
    sourceImage: SOURCE,
  });

  check("a manual selection has an id", manual.selectionId.length > 0);
  check(
    "a manual selection records its method",
    manual.selectionMethod === "manual"
  );
  check(
    "a manual selection is tied to no scene object",
    manual.sceneItemId === null,
    "a drawn region is not a detected object"
  );
  check(
    "a manual selection has NO fabricated confidence",
    manual.confidence === undefined
  );
  check(
    "confidence is genuinely absent, not zero",
    !("confidence" in manual),
    "the key itself must be absent"
  );
  check(
    "an unnamed manual region still has a usable name",
    manual.displayName.length > 0
  );
  check(
    "an unknown category defaults honestly",
    manual.canonicalCategory === "unknown"
  );
  check(
    "a manual selection records the source image size",
    manual.sourceImage.width === 1400 && manual.sourceImage.height === 1050
  );

  const named = assignSelectionCategory(manual, "sofa");
  check("a drawn region can be assigned a type", named.canonicalCategory === "sofa");
  check("assigning a type names it", named.displayName === "Sofa");
  check(
    "assigning a type does not invent confidence",
    !("confidence" in named)
  );

  check("a real region is usable", hasUsableArea(manual));
  check(
    "a degenerate region is not usable",
    !hasUsableArea({
      ...manual,
      boundingBox: { x: 0.5, y: 0.5, width: 0, height: 0 },
    })
  );
}

section("Result state carries the mode");
{
  // The mode must survive a cache round-trip so the result screen always knows
  // which journey produced the room.
  for (const mode of DESIGN_MODES) {
    const cached = JSON.parse(JSON.stringify({ designMode: mode }));
    check(
      `${mode} survives serialisation`,
      isDesignMode(cached.designMode) && cached.designMode === mode
    );
  }
  const legacy = JSON.parse(JSON.stringify({ aiConceptMode: true }));
  check(
    "a legacy cache without a mode does not yield a bogus one",
    !isDesignMode(legacy.designMode)
  );
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log("All design-mode tests passed.");
