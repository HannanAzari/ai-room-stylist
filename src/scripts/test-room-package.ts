/**
 * Deterministic tests for the Surprise Me curated Koala package.
 *
 * Run with:  npm run test:room-package
 *
 * Uses both the real catalogue and a SEEDED FIXTURE catalogue, so coherence
 * behaviour is asserted against controlled metadata rather than whatever the
 * live catalogue happens to contain. No network, no API key.
 */
import {
  MAX_PACKAGE_SIZE,
  checkPackageInvariants,
  packageProductIds,
  requiredCategoriesFor,
  selectRoomPackage,
} from "@/lib/intelligence/room-package";
import { getProductProfiles } from "@/lib/intelligence/product-profile";
import { getAllProducts } from "@/lib/products";
import { buildReplacementPlan } from "@/lib/intelligence/replacement-planner";
import { buildIntelligentRoomPrompt } from "@/lib/intelligence/prompt-builder";
import { sceneGraphToRoomAnalysis } from "@/lib/intelligence/scene-graph";
import { buildGoldenLivingRoomSceneGraph } from "@/lib/intelligence/fixtures/golden-living-room";
import type { Product } from "@/lib/products";

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

const catalogue = getAllProducts();

// --- Seeded fixture catalogue ----------------------------------------------
// Controlled metadata so coherence assertions are about the ENGINE, not about
// whatever the live catalogue currently holds.
function seedProduct(
  id: string,
  category: string,
  colors: string[],
  materials: string[],
  styleTags: string[] = ["modern luxury"]
): Product {
  return {
    id,
    name: `${id} ${category}`,
    category,
    styleTags,
    colors,
    materials,
    price: null,
    url: "",
    widthCm: null,
    depthCm: null,
    heightCm: null,
  };
}

const SEEDED: Product[] = [
  // Two sofas: one neutral cream, one saturated green.
  seedProduct("sofa-cream", "sofas", ["cream"], ["fabric"], ["modern luxury", "warm neutral"]),
  seedProduct("sofa-green", "sofas", ["green"], ["velvet"]),
  // Coffee tables: one that matches cream, one that clashes.
  seedProduct("table-stone", "coffee-tables", ["white"], ["stone"], ["modern luxury", "warm neutral"]),
  seedProduct("table-red", "coffee-tables", ["red"], ["plastic"]),
  // Rugs.
  seedProduct("rug-beige", "rugs", ["beige"], ["wool"], ["modern luxury", "warm neutral"]),
  seedProduct("rug-mustard", "rugs", ["mustard"], ["wool"]),
  // Lighting sub-types, distinguished by NAME so canonicalisation can see them.
  { ...seedProduct("lamp-floor", "lighting", ["black"], ["metal"]), name: "Seed Floor Lamp" },
  { ...seedProduct("light-chandelier", "lighting", ["gold"], ["metal"]), name: "Seed Chandelier" },
];

// --- 1. Package contains only catalogue products ---------------------------
section("1. The package contains only real catalogue products");
{
  for (const roomType of ["living room", "dining room", "bedroom", "office"]) {
    const pkg = selectRoomPackage({ roomType, style: "Modern Luxury", catalogue });
    const ids = new Set(catalogue.map((p) => p.id));
    check(
      `${roomType}: every item is a catalogue product`,
      pkg.items.every((i) => ids.has(i.productId)),
      pkg.items.map((i) => i.productId).join(", ")
    );
    check(
      `${roomType}: invariants hold`,
      checkPackageInvariants(pkg, catalogue).length === 0,
      checkPackageInvariants(pkg, catalogue).join("; ")
    );
    check(
      `${roomType}: no invented product names`,
      pkg.items.every(
        (i) => catalogue.find((p) => p.id === i.productId)?.name === i.productName
      )
    );
  }
}

// --- 2. Categories are sensible for the room type --------------------------
section("2. Required categories are sensible per room type");
{
  const cases: [string, string[]][] = [
    ["living room", ["sofas", "coffee-tables"]],
    ["dining room", ["dining-tables", "chairs"]],
    ["bedroom", ["beds", "bed-sides"]],
  ];
  for (const [roomType, expected] of cases) {
    const pkg = selectRoomPackage({ roomType, style: "Modern Luxury", catalogue });
    const categories = pkg.items.map((i) => i.category);
    for (const required of expected) {
      check(`${roomType} includes ${required}`, categories.includes(required),
        categories.join(", "));
    }
    check(`${roomType}'s required list matches the blueprint`,
      requiredCategoriesFor(roomType).every((c) => categories.includes(c)));
    check(`${roomType} has no duplicate categories`,
      new Set(categories).size === categories.length);
    check(`${roomType} is within the size cap`,
      pkg.items.length <= MAX_PACKAGE_SIZE, `${pkg.items.length}`);
    check(`${roomType} is substantial enough to read as a design`,
      pkg.items.length >= 4, `${pkg.items.length}`);
  }

  // A bedroom package must not be furnished with sofas.
  const bedroom = selectRoomPackage({ roomType: "bedroom", style: "x", catalogue });
  check("a bedroom contains no sofa",
    !bedroom.items.some((i) => i.category === "sofas"));
  const living = selectRoomPackage({ roomType: "living room", style: "x", catalogue });
  check("a living room contains no bed",
    !living.items.some((i) => i.category === "beds"));
}

// --- 3. Products are style/colour compatible (seeded) ----------------------
section("3. Coherence — seeded metadata");
{
  const pkg = selectRoomPackage({
    roomType: "living room",
    style: "Modern Luxury",
    catalogue: SEEDED,
  });
  const ids = packageProductIds(pkg);

  check("the neutral sofa anchors the room, not the saturated one",
    ids.includes("sofa-cream") && !ids.includes("sofa-green"),
    ids.join(", "));
  check("the coordinating table is chosen over the clashing one",
    ids.includes("table-stone") && !ids.includes("table-red"),
    ids.join(", "));
  check("the coordinating rug is chosen over the clashing one",
    ids.includes("rug-beige") && !ids.includes("rug-mustard"),
    ids.join(", "));
  check("exactly one product per category",
    new Set(pkg.items.map((i) => i.category)).size === pkg.items.length);
  check("exactly one anchor", pkg.items.filter((i) => i.isAnchor).length === 1);
  check("the anchor is the first item", pkg.items[0].isAnchor);

  // Lighting sub-type: a living room wants a floor/table lamp, a dining room
  // an overhead light. The engine must tell them apart by name.
  const livingLight = pkg.items.find((i) => i.category === "lighting");
  check("a living room takes the floor lamp, not the chandelier",
    livingLight?.productId === "lamp-floor", livingLight?.productId);

  const diningSeed = selectRoomPackage({
    roomType: "dining room",
    style: "Modern Luxury",
    catalogue: [
      ...SEEDED,
      seedProduct("dining-1", "dining-tables", ["white"], ["stone"]),
      seedProduct("chair-1", "chairs", ["cream"], ["fabric"]),
    ],
  });
  const diningLight = diningSeed.items.find((i) => i.category === "lighting");
  check("a dining room takes the chandelier as its overhead light",
    diningLight?.productId === "light-chandelier", diningLight?.productId);
  check("the overhead role is only claimed when it is true",
    diningLight?.role === "Overhead light", diningLight?.role);

  // Role honesty: with no chandelier available the role must not claim one.
  const noChandelier = selectRoomPackage({
    roomType: "dining room",
    style: "x",
    catalogue: [
      ...SEEDED.filter((p) => p.id !== "light-chandelier"),
      seedProduct("dining-1", "dining-tables", ["white"], ["stone"]),
      seedProduct("chair-1", "chairs", ["cream"], ["fabric"]),
    ],
  });
  const fallbackLight = noChandelier.items.find((i) => i.category === "lighting");
  check("without a chandelier the role degrades honestly",
    fallbackLight === undefined || fallbackLight.role === "Lighting",
    fallbackLight?.role);
}

// --- 4. Determinism --------------------------------------------------------
section("4. Selection is deterministic");
{
  for (const roomType of ["living room", "bedroom", "dining room"]) {
    const a = packageProductIds(
      selectRoomPackage({ roomType, style: "Modern Luxury", catalogue })
    );
    const b = packageProductIds(
      selectRoomPackage({ roomType, style: "Modern Luxury", catalogue })
    );
    check(`${roomType}: repeated selection is identical`,
      JSON.stringify(a) === JSON.stringify(b));
  }

  // A preferred product genuinely steers the package.
  const preferred = catalogue.find(
    (p) => p.category === "sofas" && !p.name.includes("Bellagio")
  )!;
  const steered = selectRoomPackage({
    roomType: "living room",
    style: "x",
    catalogue,
    preferProductIds: [preferred.id],
  });
  check("a preferred product is honoured as the anchor",
    steered.items[0].productId === preferred.id,
    `${steered.items[0].productId} vs ${preferred.id}`);
}

// --- 5. Generation receives no products outside the package ---------------
section("5. Generation is confined to the package");
{
  const pkg = selectRoomPackage({
    roomType: "living room",
    style: "Modern Luxury",
    catalogue,
  });
  const ids = packageProductIds(pkg);
  const products = catalogue.filter((p) => ids.includes(p.id));
  const profiles = getProductProfiles(products);

  // Concept mode is OFF for a curated package: the package IS the design.
  const plan = buildReplacementPlan({
    sceneGraph: buildGoldenLivingRoomSceneGraph(),
    profiles,
    selectedProductIds: ids,
    aiConceptMode: false,
  });

  const planProductIds = [
    ...plan.replacements.map((t) => t.productId),
    ...plan.additions.map((t) => t.productId),
  ];
  check("every planned product is in the package",
    planProductIds.every((id) => ids.includes(id)),
    planProductIds.filter((id) => !ids.includes(id)).join(", "));
  check("no complementary extras are invented",
    plan.additions.every((t) => t.source === "selected"));
  check("every package product gets a destination",
    ids.every((id) => planProductIds.includes(id)),
    ids.filter((id) => !planProductIds.includes(id)).join(", "));

  const prompt = buildIntelligentRoomPrompt({
    roomAnalysis: sceneGraphToRoomAnalysis(buildGoldenLivingRoomSceneGraph()),
    sceneGraph: buildGoldenLivingRoomSceneGraph(),
    replacementPlan: plan,
    profiles,
    style: "Modern Luxury",
    roomType: "living room",
    aiConceptMode: false,
    selectedProductIds: ids,
    referenceViewCount: ids.length,
  }).prompt;

  check("the prompt forbids inventing furniture",
    prompt.includes("Never invent furniture that is not in the plan"));
  check("concept mode is off, so nothing extra may be added",
    prompt.includes("CONCEPT MODE — OFF") &&
      prompt.includes("Do NOT add any other furniture"));
  check("every package product is named in the prompt",
    pkg.items.every((i) => prompt.includes(i.productName)),
    pkg.items.filter((i) => !prompt.includes(i.productName)).map((i) => i.productName).join(", "));
}

// --- 6. Architecture stays protected ---------------------------------------
section("6. Architecture is still protected");
{
  const pkg = selectRoomPackage({ roomType: "living room", style: "x", catalogue });
  const ids = packageProductIds(pkg);
  const profiles = getProductProfiles(catalogue.filter((p) => ids.includes(p.id)));
  const scene = buildGoldenLivingRoomSceneGraph();
  const plan = buildReplacementPlan({
    sceneGraph: scene,
    profiles,
    selectedProductIds: ids,
    aiConceptMode: false,
  });
  const prompt = buildIntelligentRoomPrompt({
    roomAnalysis: sceneGraphToRoomAnalysis(scene),
    sceneGraph: scene,
    replacementPlan: plan,
    profiles,
    style: "x",
    roomType: "living room",
    aiConceptMode: false,
    referenceViewCount: ids.length,
  }).prompt;

  check("the architecture lock is present", prompt.includes("ARCHITECTURE LOCK"));
  check("no new doors or windows may be added",
    prompt.includes("Do NOT add any door, doorway, window, arch, opening"));
  check("the counted inventory is stated",
    prompt.includes("EXACTLY 1 window(s)"));
  check("the television is never replaced",
    plan.dispositions.find((d) => d.itemId === "tv-screen")?.disposition === "preserve");
  check("the package never contains an architectural category",
    pkg.items.every((i) =>
      !["windows", "doors", "walls", "ceilings"].includes(i.category)));
  check("fixed objects are preserved",
    prompt.includes("Never move or alter the TV"));
}

// --- 7. Products-used equals the validated package -------------------------
section("7. Products used equal the validated package");
{
  const pkg = selectRoomPackage({ roomType: "living room", style: "x", catalogue });
  const ids = packageProductIds(pkg);

  // Mirrors the route: planned ∩ (not proven non-compliant).
  function productsUsed(failedIds: string[], reviewUnavailable = false) {
    return ids.filter((id) =>
      reviewUnavailable ? true : !failedIds.includes(id)
    );
  }

  check("with a clean review, products used equal the package",
    JSON.stringify(productsUsed([])) === JSON.stringify(ids));
  check("a product the reviewer says is absent is dropped",
    !productsUsed([ids[1]]).includes(ids[1]));
  check("dropping one does not disturb the others",
    productsUsed([ids[1]]).length === ids.length - 1);
  check("an unavailable review never shrinks the package",
    productsUsed([ids[1]], true).length === ids.length);
  check("nothing outside the package can ever appear",
    productsUsed([]).every((id) => ids.includes(id)));
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All room-package tests passed.");
