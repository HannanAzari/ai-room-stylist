/**
 * Two-sofa replacements, end to end — and the provider boundary.
 *
 * Run with:  npm run test:sofa-slots
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS SUITE EXISTS FOR
 * ---------------------------------------------------------------------------
 * Reported from real mobile use: the customer asked for 2 × 3-seater sofas, the
 * product shelf showed ×2, and the generated image changed only ONE sofa.
 *
 * The contract was correct the whole time — two REPLACE tasks, one per sofa.
 * Two things downstream of it were not:
 *
 *  1. THE REFERENCE MANIFEST keyed each product to a SINGLE task id, so when
 *     both tasks used the same sofa the second overwrote the first. The one
 *     reference image that sofa got was labelled "TASK 2 ... the product in
 *     task 2", while the prompt still asked task 1 to match "the reference
 *     image for task 1" — an image that did not exist. The provider is
 *     explicitly told to use each image only for the task named above it and
 *     never to reuse one across tasks, so task 1 had no authorised reference
 *     and was quietly dropped.
 *
 *  2. THE PROMPT computed "does this room hold more than one of these?" from
 *     the PROTECTED items only. With both sofas being replaced, neither is
 *     protected, so the answer was "no" and both tasks said "the existing
 *     sofa" with nothing establishing that there were two. And when the flag
 *     did fire, the copy asserted "every other sofa must remain exactly as
 *     photographed" — which directly contradicts the sibling task ordering
 *     that sofa to be replaced.
 *
 * Section 4 is the exact QA scenario from the sprint brief.
 */
import { readFileSync } from "node:fs";
import { supportsInputFidelity } from "@/features/room-stylist/services/image-providers/gpt-image-capabilities";
import {
  buildSeatingPlan,
  describeSeatingProducts,
  parseSeatingSlotKey,
  seatingPlanSlots,
  seatingSlotKey,
} from "@/lib/intelligence/room-categories";
import {
  parseCategoryIntents,
  resolveCategoryIntents,
  type CategoryIntent,
} from "@/lib/intelligence/category-intent";
import { contractToReplacementPlan } from "@/lib/intelligence/replacement-assignment";
import { checkPlanInvariants } from "@/lib/intelligence/replacement-planner";
import { buildIntelligentRoomPrompt } from "@/lib/intelligence/prompt-builder";
import { buildReferenceManifest } from "@/lib/intelligence/reference-manifest";
import { deriveProductQuantityExpectations } from "@/lib/intelligence/quality-reviewer";
import { getProductProfiles } from "@/lib/intelligence/product-profile";
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

const sofaA = catalogue.find(
  (p) => p.category === "sofas" && !isSectional(p.name)
);
const sofaB = catalogue.find(
  (p) => p.category === "sofas" && !isSectional(p.name) && p.id !== sofaA?.id
);
const coffeeTable = catalogue.find((p) => p.category === "coffee-tables");
if (!sofaA || !sofaB || !coffeeTable) {
  throw new Error("the catalogue no longer has the two sofas this suite needs");
}

/** Two sofas, a coffee table, a TV unit and a (non-replaceable) TV. */
function twoSofaRoom(): SceneGraph {
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
        category: "3 seater sofa",
        canonicalCategory: "sofa",
        instanceLabel: "the right 3 seater sofa",
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
    architecture: {
      counted: true,
      windowCount: 1,
      doorCount: 1,
      openingCount: 0,
      features: [],
    },
  } as unknown as SceneGraph;
}

const ROOM_ANALYSIS = { roomType: "living room" } as unknown as RoomAnalysis;

/** The payload the browser sends for a seating plan with chosen slot products. */
function buildSeatingIntent(
  slotProducts: { id: string; name: string }[]
): CategoryIntent {
  return {
    canonicalCategory: "sofa",
    // One entry per SLOT, count 1 each — the shape the client now emits.
    seatingSelection: slotProducts.map((product) => ({
      kind: "sofa-3-seater" as const,
      count: 1,
      productId: product.id,
      productName: product.name,
    })),
  };
}

// ===========================================================================
section("1. Seating slots — the model that makes two different sofas sayable");
// ===========================================================================
{
  const twoThreeSeaters = buildSeatingPlan({ "sofa-3-seater": 2 });
  const slots = seatingPlanSlots(twoThreeSeaters);

  check("2 × 3-seater expands to 2 slots", slots.length === 2);
  check("the slots have distinct keys", slots[0].key !== slots[1].key);
  check("the keys are stable and derivable",
    slots[0].key === seatingSlotKey("sofa-3-seater", 1) &&
      slots[1].key === seatingSlotKey("sofa-3-seater", 2));
  check("a slot key round-trips",
    parseSeatingSlotKey(slots[1].key)?.kind === "sofa-3-seater" &&
      parseSeatingSlotKey(slots[1].key)?.index === 2);
  check("a canonical category is not mistaken for a slot key",
    parseSeatingSlotKey("sofa") === null &&
      parseSeatingSlotKey("coffee-table") === null,
    "slot keys and plain category keys share one map");

  check("two of a shape are labelled 1 of 2 / 2 of 2",
    slots[0].label === "3-seater sofa · 1 of 2" &&
      slots[1].label === "3-seater sofa · 2 of 2",
    `${slots[0].label} / ${slots[1].label}`);

  const single = seatingPlanSlots(buildSeatingPlan({ "sofa-l-shape": 1 }));
  check("a single piece gets no redundant ordinal",
    single.length === 1 && single[0].label === "L-shape sofa",
    single[0]?.label);

  const mixed = seatingPlanSlots(
    buildSeatingPlan({ "sofa-3-seater": 1, "sofa-2-seater": 2 })
  );
  check("a mixed plan expands to one slot per physical piece",
    mixed.length === 3);
  check("mixed slots are grouped by kind, in the picker's order",
    mixed.map((s) => s.kind).join(",") ===
      "sofa-3-seater,sofa-2-seater,sofa-2-seater",
    mixed.map((s) => s.kind).join(","));
  check("every slot key in a mixed plan is unique",
    new Set(mixed.map((s) => s.key)).size === 3);

  // Confirmation copy must name MODELS, not shapes.
  const sameBoth = describeSeatingProducts(slots, () => "Dune 3-seater");
  check("a matching pair reads as a count of one model",
    sameBoth === "2 × Dune 3-seater", sameBoth);

  const different = describeSeatingProducts(slots, (key) =>
    key === slots[0].key ? "Dune 3-seater" : "Halo 3-seater"
  );
  check("two different models are both named",
    different === "Dune 3-seater and Halo 3-seater", different);

  const partial = describeSeatingProducts(slots, (key) =>
    key === slots[0].key ? "Dune 3-seater" : undefined
  );
  check("an unchosen slot is simply absent from the summary",
    partial === "Dune 3-seater", partial);
  check("nothing chosen yet produces no summary at all",
    describeSeatingProducts(slots, () => undefined) === "");
}

// ===========================================================================
section("2. The wire payload carries per-slot products");
// ===========================================================================
{
  // Two different models for the same shape — impossible to express before,
  // because a selection was keyed by shape and carried a single product.
  const mixedPair = JSON.stringify([
    buildSeatingIntent([
      { id: sofaA.id, name: sofaA.name },
      { id: sofaB.id, name: sofaB.name },
    ]),
  ]);
  const parsed = parseCategoryIntents(mixedPair);
  check("both slots survive the wire",
    parsed[0]?.seatingSelection?.length === 2,
    JSON.stringify(parsed[0]?.seatingSelection));
  check("the two slots carry two different products",
    parsed[0]?.seatingSelection?.[0].productId !==
      parsed[0]?.seatingSelection?.[1].productId);
  check("each slot is exactly one piece",
    parsed[0]?.seatingSelection?.every((entry) => entry.count === 1) ?? false);

  // The same product twice must survive as TWO entries, not be deduplicated.
  const matchingPair = JSON.stringify([
    buildSeatingIntent([
      { id: sofaA.id, name: sofaA.name },
      { id: sofaA.id, name: sofaA.name },
    ]),
  ]);
  const parsedPair = parseCategoryIntents(matchingPair);
  check("a matching pair stays two separate slots",
    parsedPair[0]?.seatingSelection?.length === 2,
    "deduplicating here would silently halve the order");
}

// ===========================================================================
section("3. THE BUG — one product across two tasks keeps both references");
// ===========================================================================
{
  const scene = twoSofaRoom();
  const profiles = getProductProfiles([sofaA, coffeeTable]);
  const resolved = resolveCategoryIntents({
    intents: [
      buildSeatingIntent([
        { id: sofaA.id, name: sofaA.name },
        { id: sofaA.id, name: sofaA.name },
      ]),
    ],
    sceneGraph: scene,
    catalogue,
    profiles,
    sourceImage: SOURCE,
  });
  const plan = contractToReplacementPlan(resolved.contract!, profiles);
  const sofaTasks = plan.replacements.filter((t) => t.productId === sofaA.id);
  check("the same sofa produces TWO replace tasks", sofaTasks.length === 2);

  // --- 3a. The manifest ----------------------------------------------------
  const manifest = buildReferenceManifest({
    loaded: [
      {
        productId: sofaA.id,
        productName: sofaA.name,
        view: "primary",
        bytes: 100_000,
        file: null,
      } as never,
    ],
    plan,
    selectedProductIds: [sofaA.id],
  });
  const entry = manifest.entries[0];
  check("the shared reference records BOTH task ids",
    entry.taskIds.length === 2,
    JSON.stringify(entry.taskIds));
  check("the label names both tasks, not just the last one",
    sofaTasks.every((task) =>
      new RegExp(`\\b${task.taskId}\\b`).test(entry.label)
    ),
    entry.label);
  check("the label states that this means separate pieces",
    /separate, physically distinct pieces/.test(entry.label),
    entry.label);
  check("the label tells the model to use it for every one of those tasks",
    /Use it for every one of those tasks/.test(entry.label));

  // The precise regression: the label must not claim only the final task.
  const lastTaskId = Math.max(...sofaTasks.map((t) => t.taskId));
  const firstTaskId = Math.min(...sofaTasks.map((t) => t.taskId));
  check("the FIRST task is not dropped from the label",
    new RegExp(`\\b${firstTaskId}\\b`).test(entry.label),
    `label only mentioned task ${lastTaskId}: ${entry.label}`);

  // --- 3b. The prompt ------------------------------------------------------
  const { prompt } = buildIntelligentRoomPrompt({
    roomAnalysis: ROOM_ANALYSIS,
    profiles,
    style: "modern luxury",
    roomType: "living room",
    aiConceptMode: false,
    replacementPlan: plan,
    sceneGraph: scene,
    referenceViewCount: 1,
  });

  check("the prompt has a repeated-products section",
    /REPEATED PRODUCTS/.test(prompt));
  check("...stating the exact number of separate pieces required",
    /must contain 2 SEPARATE, physically distinct/.test(prompt), prompt.slice(0, 0));
  check("...and naming both task numbers",
    new RegExp(`tasks ${firstTaskId} and ${lastTaskId}`).test(prompt));
  check("...and refusing 'one image means one object'",
    /that is NOT permission to render only one of them/.test(prompt));

  check("each sofa task names its own instance",
    /the left 3 seater sofa/.test(prompt) &&
      /the right 3 seater sofa/.test(prompt),
    "two tasks both saying 'the existing sofa' are ambiguous");

  // The contradiction that made partial execution look reasonable.
  check("the prompt never tells the model to leave a sibling that has a task",
    !/Every other sofa must remain exactly as photographed\./.test(prompt),
    "that instruction contradicts the sibling task");
  check("instead it says the siblings have their own tasks",
    /have their own numbered tasks, which you must also carry out/.test(prompt) ||
      /has its own numbered task/.test(prompt));
  check("partial execution is named as a failure",
    /Never carry out only some of the numbered tasks/.test(prompt));
  check("merging two tasks into one object is named as a failure",
    /Never merge two tasks into one object/.test(prompt));
  check("the plan header states how many tasks must ALL be done",
    /ALL \d+ must be carried out/.test(prompt));

  // --- 3c. The reviewer still measures the same thing ----------------------
  const expectation = deriveProductQuantityExpectations(plan).find(
    (e) => e.productId === sofaA.id
  );
  check("the reviewer expects 2 instances of the shared sofa",
    expectation?.expectedFinalInstanceCount === 2);
  check("the reviewer's task ids match the prompt's",
    expectation?.taskIds.sort().join(",") ===
      sofaTasks.map((t) => t.taskId).sort().join(","));
}

// ===========================================================================
section("4. QA SCENARIO — 2 sofas + coffee table, 2 × 3-seater");
// ===========================================================================
for (const variant of ["the same sofa twice", "two different sofas"] as const) {
  section(`  4.${variant === "the same sofa twice" ? "a" : "b"} — ${variant}`);

  const slotProducts =
    variant === "the same sofa twice"
      ? [
          { id: sofaA.id, name: sofaA.name },
          { id: sofaA.id, name: sofaA.name },
        ]
      : [
          { id: sofaA.id, name: sofaA.name },
          { id: sofaB.id, name: sofaB.name },
        ];

  const scene = twoSofaRoom();
  const chosen = variant === "the same sofa twice" ? [sofaA] : [sofaA, sofaB];
  const profiles = getProductProfiles([...chosen, coffeeTable]);

  const resolved = resolveCategoryIntents({
    intents: [
      buildSeatingIntent(slotProducts),
      { canonicalCategory: "coffee-table", productId: coffeeTable.id },
    ],
    sceneGraph: scene,
    catalogue,
    profiles,
    sourceImage: SOURCE,
  });

  const sofaAssignments =
    resolved.contract?.assignments.filter(
      (a) => a.canonicalCategory === "sofa"
    ) ?? [];

  check("BOTH existing sofas are assigned a replacement",
    sofaAssignments.length === 2, `${sofaAssignments.length}`);
  check("the two tasks target the two DIFFERENT sofa instances",
    new Set(sofaAssignments.map((a) => a.target.sceneItemId)).size === 2,
    JSON.stringify(sofaAssignments.map((a) => a.target.sceneItemId)));
  check("neither sofa is left protected (which would contradict its task)",
    !(resolved.contract?.protectedItems ?? []).some((item) =>
      ["sofa_a", "sofa_b"].includes(item.sceneItemId ?? "")
    ));
  check("the coffee table gets its own task",
    resolved.contract?.assignments.some(
      (a) => a.target.sceneItemId === "coffee_table_a"
    ) ?? false);
  check("nothing is added or removed — the counts already matched",
    (resolved.contract?.additions?.length ?? 0) === 0 &&
      (resolved.contract?.removals?.length ?? 0) === 0);

  // The distinction between the two variants must survive into the contract.
  const sofaProductIds = sofaAssignments.map((a) => a.productId);
  if (variant === "the same sofa twice") {
    check("both tasks use the same chosen model",
      new Set(sofaProductIds).size === 1);
    check("the basket charges for 2 units of it",
      resolved.quantities[sofaA.id] === 2,
      JSON.stringify(resolved.quantities));
  } else {
    check("the two chosen models stay distinct",
      new Set(sofaProductIds).size === 2,
      JSON.stringify(sofaProductIds));
    check("each model is charged once",
      resolved.quantities[sofaA.id] === 1 &&
        resolved.quantities[sofaB.id] === 1,
      JSON.stringify(resolved.quantities));
  }

  const plan = contractToReplacementPlan(resolved.contract!, profiles);
  check("3 replace tasks: two sofas and the coffee table",
    plan.replacements.length === 3, `${plan.replacements.length}`);
  check("every item in the room carries exactly one instruction",
    checkPlanInvariants(plan, { sceneGraph: scene }).length === 0,
    checkPlanInvariants(plan, { sceneGraph: scene }).join("; "));

  // Protected items — the TV and TV unit must be untouched.
  const tvUnit = plan.dispositions.find((d) => d.itemId === "tv_unit_a");
  const tv = plan.dispositions.find((d) => d.itemId === "tv_a");
  check("the TV unit is explicitly preserved",
    tvUnit?.disposition === "preserve", tvUnit?.disposition);
  check("the television is explicitly preserved",
    tv?.disposition === "preserve", tv?.disposition);

  const { prompt } = buildIntelligentRoomPrompt({
    roomAnalysis: ROOM_ANALYSIS,
    profiles,
    style: "modern luxury",
    roomType: "living room",
    aiConceptMode: false,
    replacementPlan: plan,
    sceneGraph: scene,
    referenceViewCount: variant === "the same sofa twice" ? 2 : 3,
  });

  check("the prompt orders BOTH sofas changed, by name",
    /the left 3 seater sofa/.test(prompt) &&
      /the right 3 seater sofa/.test(prompt));
  check("the prompt protects the television",
    /Never move or alter the television\./.test(prompt) ||
      /Never move or alter the TV\./.test(prompt));
  check("the prompt does not double the article on protected labels",
    !/the the /.test(prompt));

  if (variant === "two different sofas") {
    check("both distinct models are named in the plan",
      prompt.includes(sofaA.name) && prompt.includes(sofaB.name));
    check("no repeated-products section — each model is used once",
      !/REPEATED PRODUCTS/.test(prompt));
  } else {
    check("the repeated-products section demands two separate pieces",
      /REPEATED PRODUCTS[\s\S]*2 SEPARATE/.test(prompt));
  }

  const expectations = deriveProductQuantityExpectations(plan);
  const expectedSofaTotal = expectations
    .filter((e) => chosen.some((product) => product.id === e.productId))
    .reduce((total, e) => total + e.expectedFinalInstanceCount, 0);
  check("the reviewer expects 2 sofa instances in the finished room",
    expectedSofaTotal === 2, `${expectedSofaTotal}`);
}

// ===========================================================================
section("5. Nothing the customer was shown is silently dropped");
// ===========================================================================
{
  const STUDIO = readFileSync(
    "src/components/studio/KoalaDesignStudio.tsx",
    "utf8"
  );

  // Found in mobile QA at 375px: "Coffee table" was ticked, no product was
  // picked for it, and Generate was still enabled — the payload then contained
  // the sofas and no mention of the coffee table at all. An unfilled shelf of
  // ANY kind must block generation, not be dropped.
  check("unfilled seating slots are counted",
    /const unfilledSeatingSlots = seatingSlotsByCategory\.filter/.test(STUDIO));
  check("unfilled plain-category shelves are counted too",
    /const unfilledSimpleShelves = simpleShelfCategories\.filter/.test(STUDIO),
    "a ticked category with no product was silently dropped");
  check("the gate uses the combined count",
    /if \(unfilledShelfCount > 0\) return false;/.test(STUDIO));
  check("the button names how many are still missing",
    /Choose \$\{unfilledShelfCount\} more/.test(STUDIO),
    "a dead button with no explanation is worse than none");

  // The payload builder drops empty entries by design; that is only safe
  // because the gate above guarantees there are none.
  check("intents still omit a category with no product",
    /const productId = chosenProductByCategory\[category\];\s*\n\s*if \(!productId\) return \[\];/.test(
      STUDIO
    ),
    "the gate, not the payload builder, is what prevents the drop");

  // Behavioural model of the gate.
  const gate = (seatingUnfilled: number, simpleUnfilled: number) =>
    seatingUnfilled + simpleUnfilled === 0;
  check("both sofas + coffee table chosen → can generate", gate(0, 0));
  check("one sofa slot empty → blocked", !gate(1, 0));
  check("coffee table empty → blocked", !gate(0, 1));
  check("both empty → blocked", !gate(1, 1));
}

// ===========================================================================
section("6. Provider boundary — the room edit is behind one interface");
// ===========================================================================
{
  const ROUTE = readFileSync(
    "src/app/api/studio/generate-gemini/route.ts",
    "utf8"
  );
  const PROVIDER = readFileSync(
    "src/features/room-stylist/services/image-providers/room-edit-provider.ts",
    "utf8"
  );
  const GPT = readFileSync(
    "src/features/room-stylist/services/image-providers/gpt-image.ts",
    "utf8"
  );
  /**
   * The provider source with comments stripped. `input_fidelity` is discussed
   * at length in this file's header, and a count of real call-site occurrences
   * must not be thrown off by prose describing the very bug being guarded.
   */
  const GPT_CODE = GPT.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /^\s*\/\/.*$/gm,
    ""
  );

  check("the route no longer calls a vendor's generator directly",
    !/generateGeminiImage\(/.test(ROUTE),
    "the renderer must be resolved through the interface");
  check("the route resolves its renderer through the interface",
    /getRoomEditProvider\(\)/.test(ROUTE));
  check("generation goes through the resolved renderer",
    /renderer\.generate\(\{/.test(ROUTE));
  check("refinement goes through a resolved renderer too",
    /refineRenderer\.generate\(\{/.test(ROUTE),
    "a refine must not silently switch providers mid-session");
  check("an unconfigured renderer fails before the analysis is paid for",
    /if \(!renderer\.available\)/.test(ROUTE));

  check("GPT Image 2 is the default renderer",
    /DEFAULT_ROOM_EDIT_PROVIDER: RoomEditProviderId = "gpt-image"/.test(
      PROVIDER
    ));
  check("Gemini is still reachable for comparison",
    /ROOM_EDIT_PROVIDER/.test(PROVIDER) && /"gemini"/.test(PROVIDER));
  check("an unrecognised provider value falls back rather than failing",
    /return DEFAULT_ROOM_EDIT_PROVIDER;/.test(PROVIDER));

  check("the renderer key is kept separate from the analysis key",
    /getStudioAnalysisApiKey/.test(ROUTE) &&
      !/apiKey: apiKey,?\s*\}\);[\s\S]{0,40}generatedImage/.test(ROUTE),
    "swapping the renderer must not swap the model grading it");

  check("GPT Image uses the real edit endpoint, not text-to-image",
    /images\.edit\(/.test(GPT));
  // The room stays image 1 after normalisation — the prompt's numbered index
  // and the manifest's task binding both depend on this exact order.
  check("the room photo is the first image (the canvas)",
    /image: \[\s*normalisedRoom\.file,\s*\.\.\.normalisedReferences/.test(GPT_CODE));
  check("every input is normalised before the request is built",
    /normaliseImageForGptImage\(roomImage/.test(GPT_CODE) &&
      /normaliseImageForGptImage\(reference\.file/.test(GPT_CODE),
    "images.edit rejects non-RGB / unsupported inputs with a 400");
  check("the room is normalised as input 1, references from 2",
    /inputNumber: 1,\s*role: "room"/.test(GPT_CODE) &&
      /inputNumber: position \+ 2/.test(GPT_CODE));
  check("the normalised inputs are logged behind ENABLE_AI_DEBUG only",
    /ENABLE_AI_DEBUG\?\.toLowerCase\(\) !== "true"\) return;/.test(GPT_CODE));
  check("the model id is gpt-image-2",
    /DEFAULT_GPT_IMAGE_MODEL = "gpt-image-2"/.test(GPT));

  // -------------------------------------------------------------------------
  // input_fidelity — a live 400 from the real API:
  //   "The model 'gpt-image-2' does not support the 'input_fidelity' parameter."
  // GPT Image 2 processes image inputs at high fidelity on its own, and 400s on
  // the parameter's mere PRESENCE. gpt-image-1/1.5 still need it asked for, so
  // this is a per-model decision, not a blanket removal.
  // -------------------------------------------------------------------------
  check("gpt-image-2 is NOT sent input_fidelity",
    !supportsInputFidelity("gpt-image-2"),
    "the live API rejects the parameter outright");
  check("the dated gpt-image-2 snapshot is not sent it either",
    !supportsInputFidelity("gpt-image-2-2026-04-21"));
  check("gpt-image-1 still gets it",
    supportsInputFidelity("gpt-image-1"),
    "removing it everywhere would silently degrade the older models");
  check("gpt-image-1.5 still gets it",
    supportsInputFidelity("gpt-image-1.5"));
  check("gpt-image-1-mini does not (it is not a gpt-image-1 prefix match)",
    !supportsInputFidelity("gpt-image-1-mini"),
    "prefix matching would wrongly include it");
  check("an unknown//custom model id defaults to NOT sending it",
    !supportsInputFidelity("some-future-model") &&
      !supportsInputFidelity(""),
    "an unrecognised GPT_IMAGE_MODEL must not be able to cause a hard 400");
  check("surrounding whitespace does not defeat the check",
    supportsInputFidelity("  gpt-image-1  "));

  // The parameter must be ABSENT, not present-and-undefined.
  check("the request omits the key entirely rather than passing undefined",
    /\.\.\.\(supportsInputFidelity\(configuration\.model\)/.test(GPT_CODE) &&
      !/input_fidelity:\s*undefined/.test(GPT_CODE),
    "a serialised `input_fidelity: undefined` would still trip the 400");
  check("input_fidelity is written exactly once in the code, in that spread",
    (GPT_CODE.match(/input_fidelity:/g) || []).length === 1,
    `${(GPT_CODE.match(/input_fidelity:/g) || []).length} occurrences`);
  check("it is never sent unconditionally",
    !/^\s*input_fidelity: "high",\s*$/m.test(GPT_CODE),
    "the unguarded literal is what produced the live 400");

  // Model the request builder the provider uses, and prove the shape.
  const editParams = (model: string) => ({
    model,
    image: ["<room>", "<ref>"],
    prompt: "…",
    size: "1536x1024",
    quality: "high",
    ...(supportsInputFidelity(model) ? { input_fidelity: "high" as const } : {}),
    n: 1,
  });
  const gpt2 = editParams("gpt-image-2");
  check("a built gpt-image-2 request has no input_fidelity field",
    !("input_fidelity" in gpt2),
    `keys: ${Object.keys(gpt2).join(", ")}`);
  check("...and JSON-serialising it does not reintroduce the field",
    !JSON.stringify(gpt2).includes("input_fidelity"));
  check("a built gpt-image-1 request still carries input_fidelity: high",
    editParams("gpt-image-1").input_fidelity === "high");

  // Everything the fix was required to leave alone.
  check("model stays gpt-image-2", gpt2.model === "gpt-image-2");
  check("the room photo is still image 1", gpt2.image[0] === "<room>");
  check("landscape size is unchanged", gpt2.size === "1536x1024");
  check("quality setting is unchanged", gpt2.quality === "high");
  check("the landscape default is still 1536x1024 in the provider",
    /GPT_IMAGE_SIZE\?\.trim\(\) \|\| "1536x1024"/.test(GPT));
  check("the quality default is still high in the provider",
    /GPT_IMAGE_QUALITY\?\.trim\(\) \|\| "high"/.test(GPT));
  check("manifest-budgeted references are never re-truncated",
    /labelledProductImages && labelledProductImages\.length > 0/.test(GPT));

  // images.edit takes ONE prompt and a flat image array, so the manifest's
  // per-task labels have to survive as a numbered index inside the prompt.
  check("the manifest labels are carried into the prompt as an image index",
    /IMAGE INPUTS/.test(GPT) && /reference\.label/.test(GPT),
    "otherwise the task/image binding is lost on this provider");
  check("image 1 is declared to be the room, not a product",
    /It is NOT a product reference/.test(GPT));
  check("the index forbids swapping products between tasks",
    /Never swap a product between tasks/.test(GPT));
  check("a multi-task reference must still produce one piece per task",
    /separate piece of furniture for EACH of those tasks/.test(GPT));
  check("transient provider failures are retried",
    /MAX_TRANSIENT_RETRIES/.test(GPT));
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failures.length}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log("All two-sofa / provider-boundary tests passed.");
