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
  createManualSelection,
  createSmartSelection,
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

  const manual = createManualSelection({
    boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.25 },
  });

  check("a manual selection has an id", manual.id.length > 0);
  check("a manual selection records its method", manual.method === "manual");
  check(
    "a manual selection has NO fabricated confidence",
    manual.confidence === undefined,
    `got ${manual.confidence}`
  );
  check(
    "confidence is genuinely absent, not zero",
    !("confidence" in manual),
    "the key itself must be absent"
  );
  check(
    "an unlabelled manual region still has a usable label",
    manual.label.length > 0
  );
  check(
    "an unknown category defaults honestly",
    manual.canonicalCategory === "unknown"
  );

  const smart = createSmartSelection({
    boundingBox: { x: 0.4, y: 0.5, width: 0.2, height: 0.2 },
    label: "the left sofa",
    canonicalCategory: "sofa",
    confidence: 0.87,
    instanceId: "sofa-main",
  });

  check("a smart selection records its method", smart.method === "smart");
  check("a smart selection keeps a real confidence", smart.confidence === 0.87);
  check("a smart selection links to its instance", smart.instanceId === "sofa-main");
  check("a smart selection carries its category", smart.canonicalCategory === "sofa");

  const smartNoConfidence = createSmartSelection({
    boundingBox: { x: 0, y: 0, width: 0.5, height: 0.5 },
    label: "the rug",
    canonicalCategory: "rug",
  });
  check(
    "a smart selection with no model confidence omits the field",
    !("confidence" in smartNoConfidence)
  );

  const nonFinite = createSmartSelection({
    boundingBox: { x: 0, y: 0, width: 0.5, height: 0.5 },
    label: "the rug",
    canonicalCategory: "rug",
    confidence: Number.NaN,
  });
  check(
    "a non-finite confidence is discarded rather than stored",
    !("confidence" in nonFinite)
  );

  const clamped = createSmartSelection({
    boundingBox: { x: 0, y: 0, width: 0.5, height: 0.5 },
    label: "the rug",
    canonicalCategory: "rug",
    confidence: 1.8,
  });
  check("an out-of-range confidence is clamped", clamped.confidence === 1);

  check("ids are unique across selections", manual.id !== smart.id);
  check(
    "ids identify their method",
    manual.id.startsWith("manual") && smart.id.startsWith("smart")
  );

  check("a real region is usable", hasUsableArea(smart));
  check(
    "a degenerate region is not usable",
    !hasUsableArea({
      ...smart,
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
