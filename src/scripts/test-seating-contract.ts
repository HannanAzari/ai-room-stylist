/**
 * Seating Intent + Strict Replace Contract sprint, defended.
 *
 * This is the regression suite for the bug found in real mobile testing: a
 * seating category selection silently replaced every existing sofa
 * regardless of what the plan actually asked for, and a consolidated-away
 * sofa could end up with NO instruction in the prompt at all — which is very
 * likely what let a model invent a desk and monitor in its place.
 *
 * Structure follows the sprint's own acceptance scenarios (A-G) plus the
 * planner/reviewer invariants that make them possible: desired-vs-existing
 * reconciliation, the REMOVE task type, the quantity invariant, and the
 * unexplained-addition regression fixture.
 */
import { readFileSync } from "node:fs";
import {
  reconcileSeating,
  flattenDesiredPieces,
  type DesiredSeatingPiece,
} from "@/lib/intelligence/seating-resolution";
import {
  resolveCategoryIntents,
  type CategoryIntent,
} from "@/lib/intelligence/category-intent";
import {
  contractToReplacementPlan,
} from "@/lib/intelligence/replacement-assignment";
import { checkPlanInvariants } from "@/lib/intelligence/replacement-planner";
import { buildIntelligentRoomPrompt } from "@/lib/intelligence/prompt-builder";
import {
  deriveProductQuantityExpectations,
  checkProductQuantities,
  deriveCriticalFailures,
  decideRecommendation,
  type TaskReviewResult,
  type GlobalReviewChecks,
  type ReviewAxes,
} from "@/lib/intelligence/quality-reviewer";
import { getProductProfiles } from "@/lib/intelligence/product-profile";
import {
  buildSeatingPlan,
  isValidSeatingPlan,
  seatingPlanPieceCount,
} from "@/lib/intelligence/room-categories";
import { getAllProducts } from "@/lib/products";
import type { SceneGraph } from "@/lib/intelligence/scene-graph";
import type { RoomAnalysis } from "@/lib/intelligence/room-analysis";

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

function section(title: string) {
  console.log(`\n${title}`);
}

const catalogue = getAllProducts();
const SOURCE = { width: 1200, height: 900 };

function isSectional(name: string) {
  return /corner|chaise|sectional|l shape|terminal/i.test(name);
}

const standardSofa = catalogue.find(
  (p) => p.category === "sofas" && !isSectional(p.name)
);
const secondStandardSofa = catalogue.find(
  (p) => p.category === "sofas" && !isSectional(p.name) && p.id !== standardSofa?.id
);
const sectionalSofa = catalogue.find(
  (p) => p.category === "sofas" && isSectional(p.name)
);
const coffeeTable = catalogue.find((p) => p.category === "coffee-tables");
if (!standardSofa || !sectionalSofa || !coffeeTable || !secondStandardSofa) {
  throw new Error(
    "the catalogue no longer has the sofa shapes / coffee table this suite assumes"
  );
}

/** Two existing sofas, a coffee table, a rug, a TV + TV unit. No desk, no monitor. */
function realTestRoom(): SceneGraph {
  return {
    roomType: "living room",
    analysed: true,
    furniture: [
      {
        id: "sofa_a",
        category: "3 seater sofa",
        canonicalCategory: "sofa",
        instanceLabel: "the left 3 seater sofa",
        replaceable: true,
        boundingBox: { x: 0.03, y: 0.42, width: 0.32, height: 0.3 },
        confidence: 0.92,
      },
      {
        id: "sofa_b",
        category: "2 seater sofa",
        canonicalCategory: "sofa",
        instanceLabel: "the right 2 seater sofa",
        replaceable: true,
        boundingBox: { x: 0.62, y: 0.42, width: 0.3, height: 0.28 },
        confidence: 0.9,
      },
      {
        id: "coffee_table_a",
        category: "coffee table",
        canonicalCategory: "coffee-table",
        instanceLabel: "the coffee table",
        replaceable: true,
        boundingBox: { x: 0.38, y: 0.65, width: 0.2, height: 0.15 },
        confidence: 0.85,
      },
      {
        id: "tv_unit_a",
        category: "tv unit",
        canonicalCategory: "tv-unit",
        instanceLabel: "the TV unit",
        replaceable: true,
        boundingBox: { x: 0.4, y: 0.15, width: 0.25, height: 0.15 },
        confidence: 0.8,
      },
      {
        id: "tv_a",
        category: "television",
        canonicalCategory: "unknown",
        instanceLabel: "the television",
        replaceable: false,
        boundingBox: { x: 0.42, y: 0.05, width: 0.2, height: 0.12 },
        confidence: 0.9,
      },
    ],
    architecture: { counted: true, windowCount: 1, doorCount: 1, openingCount: 0, features: [] },
  } as unknown as SceneGraph;
}

const GOOD_AXES: ReviewAxes = {
  roomPreservation: 96, perspective: 95, lighting: 94, productAccuracy: 93,
  placementAccuracy: 93, scale: 92, architecture: 97, furnitureReplacement: 95,
  duplication: 96, crop: 95,
};
const GOOD_GLOBAL: GlobalReviewChecks = {
  noNewArchitecture: true, allOriginalArchitecturePresent: true,
  wallStructurePreserved: true, unselectedSameCategoryUnchanged: true,
  unrelatedFurniturePreserved: true, noUnrequestedAdditions: true,
  reasoning: "Everything checks out.",
};

// --- Scenario A — 2 matching sofas -------------------------------------------
section("Scenario A — 2 existing sofas, desired 2× the same 3-seater");
{
  const scene = realTestRoom();
  const intents: CategoryIntent[] = [
    {
      canonicalCategory: "sofa",
      seatingSelection: [
        {
          kind: "sofa-3-seater",
          count: 2,
          productId: standardSofa.id,
          productName: standardSofa.name,
        },
      ],
    },
    { canonicalCategory: "coffee-table", productId: coffeeTable.id },
  ];

  const resolved = resolveCategoryIntents({
    intents,
    sceneGraph: scene,
    catalogue,
    profiles: getProductProfiles([standardSofa, coffeeTable]),
    sourceImage: SOURCE,
  });

  check("both sofas get explicit replace tasks",
    resolved.contract?.assignments.filter(
      (a) => a.canonicalCategory === "sofa"
    ).length === 2,
    `${resolved.contract?.assignments.length}`);
  check("both sofa instances are targeted",
    ["sofa_a", "sofa_b"].every((id) =>
      resolved.contract?.assignments.some((a) => a.target.sceneItemId === id)
    ));
  check("the coffee table gets its own task",
    resolved.contract?.assignments.some(
      (a) => a.target.sceneItemId === "coffee_table_a"
    ) ?? false);
  check("no additions and no removals — counts matched exactly",
    (resolved.contract?.additions?.length ?? 0) === 0 &&
      (resolved.contract?.removals?.length ?? 0) === 0);
  check("the basket charges for two",
    resolved.quantities[standardSofa.id] === 2,
    JSON.stringify(resolved.quantities));

  const plan = contractToReplacementPlan(
    resolved.contract!,
    getProductProfiles([standardSofa, coffeeTable])
  );
  check("the plan has exactly 3 replace tasks, 0 removals",
    plan.replacements.length === 3 && plan.removals.length === 0);
  check("every furniture item in the scene has exactly one disposition",
    checkPlanInvariants(plan, { sceneGraph: scene }).length === 0,
    checkPlanInvariants(plan, { sceneGraph: scene }).join("; "));

  // The TV unit and TV were never selected — they must be preserved, not
  // silently absent from both lists (the exact bug class this sprint fixes).
  const tvUnitDisposition = plan.dispositions.find((d) => d.itemId === "tv_unit_a");
  check("the un-selected TV unit is explicitly preserved, not orphaned",
    tvUnitDisposition?.disposition === "preserve");

  // Reviewer-side: requested 2, only 1 rendered must fail; 2 rendered must pass.
  const expectations = deriveProductQuantityExpectations(plan);
  const sofaExpectation = expectations.find((e) => e.productId === standardSofa.id);
  check("the plan expects exactly 2 of the sofa",
    sofaExpectation?.expectedFinalInstanceCount === 2);

  const bothPresent: TaskReviewResult[] = plan.replacements.map((t) => ({
    taskId: t.taskId, productId: t.productId, productPresent: true,
    categoryCorrect: true, originalRemovedOrReplaced: true, genuineReplacement: true,
    noDuplicate: true, placementCorrect: true, scaleCorrect: true, identityMatches: true,
    reasoning: "", issues: [],
  }));
  check("2 requested, 2 rendered → no quantity failure",
    checkProductQuantities(expectations, bothPresent).length === 0);

  // Turn OFF productPresent for just the first sofa task — task order in the
  // plan is not guaranteed to put sofas before the coffee table, so target by
  // productId, not array position.
  const firstSofaTaskId = plan.replacements.find(
    (t) => t.productId === standardSofa.id
  )?.taskId;
  const onlyOnePresent = bothPresent.map((task) =>
    task.taskId === firstSofaTaskId ? { ...task, productPresent: false } : task
  );
  const mismatch = checkProductQuantities(expectations, onlyOnePresent);
  check("2 requested, only 1 rendered → CRITICAL failure",
    mismatch.some((f) => f.kind === "product-instance-count-mismatch"),
    JSON.stringify(mismatch));
  const sofaMismatch = mismatch.find((f) => f.productId === standardSofa.id);
  check("the failure names the product and the real count",
    sofaMismatch?.detail.includes("1") ?? false,
    sofaMismatch?.detail);

  // A quantity mismatch must reject regardless of an otherwise high score.
  const rejectedDespiteScore = decideRecommendation(
    deriveCriticalFailures(onlyOnePresent, GOOD_AXES, GOOD_GLOBAL, 60, plan),
    97
  );
  check("a quantity mismatch is rejected even at a 97 overall score",
    rejectedDespiteScore === "regenerate");
}

// --- Scenario B — mixed sofas -------------------------------------------------
section("Scenario B — desired 1×3-seater + 1×2-seater, two different products");
{
  const scene = realTestRoom();
  const intents: CategoryIntent[] = [
    {
      canonicalCategory: "sofa",
      seatingSelection: [
        { kind: "sofa-3-seater", count: 1, productId: standardSofa.id, productName: standardSofa.name },
        { kind: "sofa-2-seater", count: 1, productId: secondStandardSofa.id, productName: secondStandardSofa.name },
      ],
    },
  ];
  const resolved = resolveCategoryIntents({
    intents,
    sceneGraph: scene,
    catalogue,
    profiles: getProductProfiles([standardSofa, secondStandardSofa]),
    sourceImage: SOURCE,
  });

  check("exactly 2 tasks, one per product",
    resolved.contract?.assignments.length === 2);
  check("each product used exactly once",
    resolved.quantities[standardSofa.id] === 1 &&
      resolved.quantities[secondStandardSofa.id] === 1,
    JSON.stringify(resolved.quantities));
  check("no additions, no removals — the counts matched",
    (resolved.contract?.additions?.length ?? 0) === 0 &&
      (resolved.contract?.removals?.length ?? 0) === 0);
}

// --- Scenario C — sectional consolidation -------------------------------------
section("Scenario C — 2 existing sofas, desired 1×L-shape");
{
  const scene = realTestRoom();
  const intents: CategoryIntent[] = [
    {
      canonicalCategory: "sofa",
      seatingSelection: [
        { kind: "sofa-l-shape", count: 1, productId: sectionalSofa.id, productName: sectionalSofa.name },
      ],
    },
  ];
  const resolved = resolveCategoryIntents({
    intents,
    sceneGraph: scene,
    catalogue,
    profiles: getProductProfiles([sectionalSofa]),
    sourceImage: SOURCE,
  });

  check("exactly one replace task",
    resolved.contract?.assignments.length === 1);
  check("exactly one removal — the other existing sofa",
    resolved.contract?.removals?.length === 1,
    `${resolved.contract?.removals?.length}`);
  check("the basket charges for one sectional, not two",
    resolved.quantities[sectionalSofa.id] === 1);

  const plan = contractToReplacementPlan(
    resolved.contract!,
    getProductProfiles([sectionalSofa])
  );
  check("the plan has 1 replacement and 1 removal — no phantom second sofa",
    plan.replacements.length === 1 && plan.removals.length === 1);
  check("every scene item still gets exactly one disposition",
    checkPlanInvariants(plan, { sceneGraph: scene }).length === 0,
    checkPlanInvariants(plan, { sceneGraph: scene }).join("; "));

  // The specific bug: the absorbed sofa must not be BOTH removed and silently
  // still-protected — it must carry exactly one instruction.
  const removedId = plan.removals[0].existingItemId;
  const alsoProtected = plan.dispositions.filter(
    (d) => d.itemId === removedId
  );
  check("the removed sofa has exactly one disposition entry",
    alsoProtected.length === 1);
  check("and that disposition is 'remove', not 'preserve'",
    alsoProtected[0]?.disposition === "remove");

  // The prompt must say REMOVE explicitly, and forbid filling the space.
  const roomAnalysis: RoomAnalysis = {
    roomType: "living room",
  } as unknown as RoomAnalysis;
  const built = buildIntelligentRoomPrompt({
    roomAnalysis,
    profiles: getProductProfiles([sectionalSofa]),
    style: "modern luxury",
    roomType: "living room",
    aiConceptMode: false,
    replacementPlan: plan,
    sceneGraph: scene,
  });
  // The removal names the specific instance ("REMOVE the left sofa — and ONLY
  // that one") whenever the room holds more than one of that category, which
  // it does here: one sofa is replaced and the other removed. The generic
  // "REMOVE the existing sofa" form is only correct when there is exactly one.
  check("the prompt issues an explicit REMOVE task",
    /REMOVE (the existing|.+ — and ONLY that one)/.test(built.prompt),
    built.prompt.match(/Task \d+ — REMOVE[^.]*/)?.[0] ?? "no REMOVE line");
  check("the prompt forbids filling the vacated space",
    /Do NOT put any replacement furniture/.test(built.prompt));
  // Regression: preservation labels that already carry "the" (the TV unit's
  // "the television", plus the whole ALWAYS_PROTECTED list) must not get a
  // second "the" prepended — "the the television" is not a defect that
  // confuses the model much, but this sprint's own gate checklist requires
  // inspecting preservation rules, and this is exactly the kind of thing
  // that inspection is supposed to catch.
  check('no doubled "the the" in the preservation rules',
    !/\bthe\s+the\s/i.test(built.prompt),
    built.prompt.match(/the\s+the\s+\w+/i)?.[0]);
}

// --- Scenario D — add seating --------------------------------------------------
section("Scenario D — 1 existing sofa, desired 2× the same 3-seater");
{
  const scene: SceneGraph = {
    roomType: "living room",
    analysed: true,
    furniture: [
      {
        id: "sofa_a", category: "sofa", canonicalCategory: "sofa",
        instanceLabel: "the sofa", replaceable: true,
        boundingBox: { x: 0.1, y: 0.4, width: 0.35, height: 0.3 }, confidence: 0.9,
      },
      {
        id: "rug_a", category: "rug", canonicalCategory: "rug",
        instanceLabel: "the rug", replaceable: true,
        boundingBox: { x: 0.2, y: 0.7, width: 0.5, height: 0.2 }, confidence: 0.8,
      },
    ],
    architecture: {},
  } as unknown as SceneGraph;

  const intents: CategoryIntent[] = [
    {
      canonicalCategory: "sofa",
      seatingSelection: [
        { kind: "sofa-3-seater", count: 2, productId: standardSofa.id, productName: standardSofa.name },
      ],
    },
  ];
  const resolved = resolveCategoryIntents({
    intents, sceneGraph: scene, catalogue,
    profiles: getProductProfiles([standardSofa]), sourceImage: SOURCE,
  });

  check("one replacement, one addition",
    resolved.contract?.assignments.length === 1 &&
      resolved.contract?.additions?.length === 1);
  check("no removals — nothing surplus existed",
    (resolved.contract?.removals?.length ?? 0) === 0);
  check("final count is 2", resolved.quantities[standardSofa.id] === 2);
  check("the rug is untouched — protected",
    resolved.contract?.protectedItems.some((i) => i.sceneItemId === "rug_a") ?? false);

  const plan = contractToReplacementPlan(
    resolved.contract!, getProductProfiles([standardSofa])
  );
  const roomAnalysis: RoomAnalysis = { roomType: "living room" } as unknown as RoomAnalysis;
  const built = buildIntelligentRoomPrompt({
    roomAnalysis, profiles: getProductProfiles([standardSofa]), style: "modern luxury",
    roomType: "living room", aiConceptMode: false, replacementPlan: plan, sceneGraph: scene,
  });
  check("the added sofa gets its own placement task in the prompt",
    /Task \d+ — Place the/.test(built.prompt));
}

// --- Scenario E — maximum ------------------------------------------------------
section("Scenario E — the 3-piece cap is enforced at the data layer");
{
  const atMax = buildSeatingPlan({ "sofa-3-seater": 3 });
  check("3 pieces is allowed", isValidSeatingPlan(atMax));

  const overMax = buildSeatingPlan({ "sofa-3-seater": 3, "sofa-2-seater": 1 });
  check("4 pieces totals 4 but is not a valid plan",
    seatingPlanPieceCount(overMax) === 4 && !isValidSeatingPlan(overMax));

  const picker = readFileSync(
    "src/components/studio/SeatingPlanPicker.tsx", "utf8"
  );
  check("the stepper UI itself blocks incrementing past the cap",
    /disabled=\{atMax\}/.test(picker));
}

// --- Scenario F — hallucination regression ------------------------------------
section("Scenario F — sofas + coffee table only, model adds a desk and monitor");
{
  const scene = realTestRoom();
  const intents: CategoryIntent[] = [
    {
      canonicalCategory: "sofa",
      seatingSelection: [
        { kind: "sofa-3-seater", count: 2, productId: standardSofa.id, productName: standardSofa.name },
      ],
    },
    { canonicalCategory: "coffee-table", productId: coffeeTable.id },
  ];
  const resolved = resolveCategoryIntents({
    intents, sceneGraph: scene, catalogue,
    profiles: getProductProfiles([standardSofa, coffeeTable]), sourceImage: SOURCE,
  });
  const plan = contractToReplacementPlan(
    resolved.contract!, getProductProfiles([standardSofa, coffeeTable])
  );

  const allTasksPassing: TaskReviewResult[] = [
    ...plan.replacements.map((t) => ({
      taskId: t.taskId, productId: t.productId, productPresent: true,
      categoryCorrect: true, originalRemovedOrReplaced: true, genuineReplacement: true,
      noDuplicate: true, placementCorrect: true, scaleCorrect: true, identityMatches: true,
      reasoning: "", issues: [],
    })),
  ];

  // The reviewer reports the hallucination the only way it can: the
  // whole-room check for unauthorised additions comes back false.
  const globalWithHallucination: GlobalReviewChecks = {
    ...GOOD_GLOBAL,
    noUnrequestedAdditions: false,
    reasoning: "A desk with a computer monitor appeared behind the replaced sofa.",
  };

  const failures = deriveCriticalFailures(
    allTasksPassing, GOOD_AXES, globalWithHallucination, 60, plan
  );
  check("an unexplained addition is a CRITICAL failure",
    failures.some((f) => f.kind === "unexplained-addition"));
  check("it rejects the render even though every task itself passed",
    decideRecommendation(failures, 96) === "regenerate");

  // The prompt sent for this exact contract must explicitly forbid a desk
  // and monitor, not just decor — furniture-scale hallucinations are the
  // documented real-world failure.
  const roomAnalysis: RoomAnalysis = { roomType: "living room" } as unknown as RoomAnalysis;
  const built = buildIntelligentRoomPrompt({
    roomAnalysis, profiles: getProductProfiles([standardSofa, coffeeTable]),
    style: "modern luxury", roomType: "living room", aiConceptMode: false,
    replacementPlan: plan, sceneGraph: scene,
  });
  check("the prompt explicitly names desks and monitors as forbidden",
    /desk/i.test(built.prompt) && /monitor/i.test(built.prompt));
  check("the prompt states the general rule, not just an enumerated list",
    /does not correspond to an authorised task/i.test(built.prompt));
}

// --- Scenario G — analysis cost -------------------------------------------------
section("Scenario G — opening the menu costs nothing, generating costs one call");
{
  const studio = readFileSync(
    "src/components/studio/KoalaDesignStudio.tsx", "utf8"
  );
  const replaceCardBlock =
    studio.match(/title="Replace items"[\s\S]{0,700}?\/>/)?.[0] ?? "";
  check("choosing Replace items triggers no analysis",
    replaceCardBlock.length > 0 && !/detectRoomObjects/.test(replaceCardBlock));

  const generate = readFileSync(
    "src/app/api/studio/generate-gemini/route.ts", "utf8"
  );
  check("generation analyses once per uncached image",
    /cachedScene \?\?/.test(generate) || /cachedScene\s*\n?\s*\?\?/.test(generate));
}

// --- Additional: the seating reconciliation function, in isolation -----------
section("Reconciliation invariants (unit-level, independent of the room)");
{
  const target = (id: string, x = 0) => ({
    sceneItemId: id, canonicalCategory: "sofa" as const,
    instanceLabel: id, displayName: id,
    boundingBox: { x, y: 0.4, width: 0.3, height: 0.3 },
    originalObjectDescription: "", confidence: 0.9,
  });
  const piece = (productId: string): DesiredSeatingPiece => ({
    kind: "sofa-3-seater", productId, productName: productId,
  });

  const equalCounts = reconcileSeating({
    existing: [target("a", 0), target("b", 0.5)],
    desired: [piece("p1"), piece("p2")],
  });
  check("equal counts produce only replacements",
    equalCounts.replacements.length === 2 &&
      equalCounts.additions.length === 0 &&
      equalCounts.removals.length === 0);
  check("pairing follows left-to-right existing order",
    equalCounts.replacements[0].target.sceneItemId === "a" &&
      equalCounts.replacements[1].target.sceneItemId === "b");

  const moreDesired = reconcileSeating({
    existing: [target("a")],
    desired: [piece("p1"), piece("p2")],
  });
  check("desired > existing produces exactly one addition",
    moreDesired.additions.length === 1 && moreDesired.removals.length === 0);

  const moreExisting = reconcileSeating({
    existing: [target("a"), target("b"), target("c")],
    desired: [piece("p1")],
  });
  check("existing > desired produces exactly two removals",
    moreExisting.removals.length === 2 && moreExisting.additions.length === 0);

  const nothingDesired = reconcileSeating({ existing: [target("a")], desired: [] });
  check("nothing desired removes the existing piece, adds nothing",
    nothingDesired.removals.length === 1 && nothingDesired.additions.length === 0);

  const nothingExisting = reconcileSeating({ existing: [], desired: [piece("p1")] });
  check("an empty room just gets additions",
    nothingExisting.additions.length === 1 && nothingExisting.removals.length === 0);

  const flat = flattenDesiredPieces([
    { kind: "sofa-3-seater", count: 2, productId: "p1", productName: "P1" },
    { kind: "sofa-2-seater", count: 1, productId: "p2", productName: "P2" },
  ]);
  check("flattening expands counts into individual units",
    flat.length === 3);
  check("zero-count kinds contribute nothing",
    flattenDesiredPieces([
      { kind: "sofa-modular", count: 0, productId: "p3", productName: "P3" },
    ]).length === 0);

  // Determinism: identical input, identical output, every time — a
  // regenerate attempt must not silently reassign which sofa becomes what.
  const runTwice = () =>
    reconcileSeating({
      existing: [target("b", 0.5), target("a", 0)],
      desired: [piece("p1")],
    });
  const first = runTwice();
  const second = runTwice();
  check("reconciliation is deterministic across repeated calls",
    first.replacements[0].target.sceneItemId ===
      second.replacements[0].target.sceneItemId &&
      first.removals[0]?.sceneItemId === second.removals[0]?.sceneItemId);
}

console.log(`\nPassed: ${passed}   Failed: ${failures.length}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log("All seating-contract tests passed.");
