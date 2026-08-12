/**
 * Golden regression fixture — the real failing living-room scenario.
 *
 * A deterministic, mocked SceneGraph that reproduces the room shape behind the
 * production bug report: TWO sofas (so one is left unmatched), a rug, a coffee
 * table, a television AND the unit beneath it (the "tv" vs "tv unit" collision),
 * curtains/windows and a fixed ceiling feature.
 *
 * No customer photograph is stored — the scene is expressed as data, so the
 * planner and reference allocator can be tested without any image or API call.
 *
 * Product ids below are real entries in `src/data/products.json`, so profiles
 * resolve exactly as they do in production.
 */
import { assignInstanceLabels, type SceneGraph } from "../scene-graph";
import { canonicaliseCategory } from "../scene-taxonomy";

type FurnitureSeed = {
  id: string;
  category: string;
  dominantColor: string;
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  /** Model-reported replaceability, before the taxonomy override. */
  modelReplaceable?: boolean;
};

const FURNITURE_SEEDS: FurnitureSeed[] = [
  {
    id: "sofa-main",
    category: "3 seater sofa",
    dominantColor: "grey",
    confidence: 0.94,
    boundingBox: { x: 0.08, y: 0.45, width: 0.4, height: 0.3 },
  },
  {
    // The second sofa: previously fell into the planner's silent gap and got
    // recoloured instead of preserved.
    id: "sofa-secondary",
    category: "two seater couch",
    dominantColor: "charcoal",
    confidence: 0.81,
    boundingBox: { x: 0.62, y: 0.42, width: 0.3, height: 0.26 },
  },
  {
    id: "rug-main",
    category: "rug",
    dominantColor: "beige",
    confidence: 0.88,
    boundingBox: { x: 0.2, y: 0.68, width: 0.55, height: 0.22 },
  },
  {
    id: "coffee-table-main",
    category: "coffee table",
    dominantColor: "walnut",
    confidence: 0.9,
    boundingBox: { x: 0.36, y: 0.6, width: 0.2, height: 0.14 },
  },
  {
    // The television itself — must be protected.
    id: "tv-screen",
    category: "TV",
    dominantColor: "black",
    confidence: 0.96,
    boundingBox: { x: 0.42, y: 0.18, width: 0.24, height: 0.16 },
  },
  {
    // The unit beneath it — furniture, and must be replaceable. The old
    // substring rule classified this as a television and locked it.
    id: "tv-unit-main",
    category: "TV unit",
    dominantColor: "oak",
    confidence: 0.87,
    boundingBox: { x: 0.38, y: 0.36, width: 0.3, height: 0.1 },
  },
  {
    id: "curtains-left",
    category: "curtains",
    dominantColor: "cream",
    confidence: 0.85,
    boundingBox: { x: 0.0, y: 0.05, width: 0.12, height: 0.6 },
  },
  {
    // Low-confidence detection: should be IGNOREd with a documented reason
    // rather than asserted into the prompt.
    id: "maybe-stool",
    category: "stool",
    dominantColor: "unknown",
    confidence: 0.2,
    boundingBox: { x: 0.86, y: 0.7, width: 0.08, height: 0.08 },
  },
];

export function buildGoldenLivingRoomSceneGraph(): SceneGraph {
  return {
    roomType: "living room",
    camera: "eye-level, straight-on interior photograph",
    walls: "painted off-white plaster",
    floor: "light oak floorboards",
    ceiling: "flat white ceiling with a recessed ceiling rose",
    windows: "large window on the left wall with sheer curtains",
    doors: "single doorway on the right wall",
    fixedObjects: [
      { name: "window", confidence: 0.95 },
      { name: "air conditioner", confidence: 0.78 },
      { name: "ceiling rose", confidence: 0.6 },
    ],
    architecture: {
      windowCount: 1,
      doorCount: 1,
      openingCount: 0,
      features: ["recessed ceiling rose", "single doorway on the right wall"],
      counted: true,
    },
    // Run through the real labeller so the fixture exercises the same
    // disambiguation logic as production (two sofas → left/right).
    furniture: assignInstanceLabels(
      FURNITURE_SEEDS.map((seed) => {
      const { canonical, recognised } = canonicaliseCategory(seed.category);
      // Mirrors `parseFurniture`: the taxonomy overrides the model's own flag.
      const replaceable =
        canonical !== "unknown" &&
        ![
          "tv",
          "window",
          "door",
          "curtains",
          "air-conditioner",
          "fireplace",
          "radiator",
          "ceiling-fan",
          "built-in",
        ].includes(canonical) &&
        (seed.modelReplaceable ?? true);

        return {
          id: seed.id,
          category: seed.category,
          canonicalCategory: canonical,
          categoryRecognised: recognised,
          // Filled in by `assignInstanceLabels` below.
          instanceLabel: `the ${seed.category}`,
          sharesCategoryWithOthers: false,
          boundingBox: seed.boundingBox,
          approximateDepth: "midground",
          orientation: "facing camera",
          dominantColor: seed.dominantColor,
          material: "unknown",
          size: "medium",
          replaceable,
          confidence: seed.confidence,
        };
      })
    ),
    emptyWalls: [
      "the large empty wall above the sofa",
      "the narrow wall beside the doorway",
    ],
    emptyFloorAreas: [
      "the open floor beside the window",
      "the corner next to the doorway",
    ],
    lighting: "soft daylight from the left window",
    palette: ["off-white", "oak", "charcoal"],
    analysed: true,
  };
}

/**
 * Selected products spanning several categories, including a TV unit (the
 * category that used to be blocked) and a mirror (a wall-mounted item).
 * Order here IS the customer's selection order.
 */
export const GOLDEN_SELECTED_PRODUCT_IDS = [
  "bellagio-stone-cream-woven-fabric-3-pieces-modular-sofa-with-left-terminal-and-side-platform",
  "san-pierre-walnut-veneer-low-round-coffee-table-with-travertine-finish-sintered-stone-top",
  "arges-stone-green-floor-rug-large-250cm-x-350cm",
  "millaray-iii-antique-gold-arch-mirror-120-cm",
  "jamil-ash-oak-veneer-entertainment-unit",
];
