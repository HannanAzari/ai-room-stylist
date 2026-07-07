/**
 * Room consultant logic — deterministic, demo-safe helpers that turn the
 * selected room + products into an "interior consultant" summary.
 *
 * Deliberately UI-free and side-effect-free so it can be unit tested.
 * Nothing here fabricates accuracy scores or claims real image analysis:
 * every output is derived from the chosen roomType, style and product data.
 */
import type { Product } from "@/lib/products";
import { productList } from "./product-helpers";

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function roundTo(value: number, step = 50): number {
  return Math.round(value / step) * step;
}

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------

const COLOR_SWATCHES: Record<string, string> = {
  white: "#F4F1EA",
  cream: "#EFE7D6",
  ivory: "#F1E9DA",
  beige: "#D9CBB4",
  sand: "#D8C7A8",
  taupe: "#B9A98E",
  stone: "#C7BCA9",
  natural: "#D6C6A8",
  oak: "#C8A97E",
  walnut: "#6B4A32",
  timber: "#9C6B43",
  wood: "#A97C50",
  brown: "#6F4E37",
  mocha: "#7B5B43",
  tan: "#B08653",
  camel: "#C19A6B",
  cognac: "#8A4B2E",
  grey: "#9A9A9A",
  gray: "#9A9A9A",
  charcoal: "#3A3A3A",
  slate: "#4A4E54",
  black: "#1A1A1A",
  ebony: "#2A2622",
  gold: "#C8A24B",
  brass: "#B08D57",
  bronze: "#8C7853",
  brushed: "#B7B7AE",
  silver: "#C4C4C4",
  green: "#5B6B54",
  sage: "#9CA995",
  olive: "#6B6B47",
  forest: "#33443A",
  blue: "#4A6577",
  navy: "#2C3E50",
  teal: "#37605C",
  pink: "#D9B8B0",
  blush: "#E4C9C0",
  rust: "#9E5B3C",
  terracotta: "#B45B3E",
};

const FALLBACK_SWATCH = "#A9A196";

export type PaletteSwatch = { name: string; hex: string };

export function deriveColorPalette(
  products: Product[],
  limit = 5
): PaletteSwatch[] {
  const counts = new Map<string, number>();

  for (const product of products) {
    for (const raw of product.colors || []) {
      const key = raw.trim().toLowerCase();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => ({
      name: titleCase(name),
      hex: COLOR_SWATCHES[name] || FALLBACK_SWATCH,
    }));
}

// ---------------------------------------------------------------------------
// Room mood
// ---------------------------------------------------------------------------

const STYLE_MOODS: { match: string; mood: string }[] = [
  { match: "modern luxury", mood: "Elevated, calm and quietly confident" },
  { match: "organic modern", mood: "Warm, natural and relaxed" },
  { match: "contemporary", mood: "Balanced, gallery-like and current" },
  { match: "warm neutral", mood: "Soft, inviting and comfortable" },
  { match: "minimal", mood: "Clean, quiet and uncluttered" },
  { match: "hotel", mood: "Polished and hospitality-inspired" },
  { match: "family", mood: "Relaxed, durable and welcoming" },
  { match: "scandi", mood: "Light, airy and understated" },
  { match: "coastal", mood: "Breezy, light and easy" },
];

export function deriveRoomMood(style: string): string {
  const key = (style || "").toLowerCase();

  for (const { match, mood } of STYLE_MOODS) {
    if (key.includes(match)) return mood;
  }

  return "Considered, cohesive and inviting";
}

// ---------------------------------------------------------------------------
// Furnishing budget estimate
// ---------------------------------------------------------------------------

// Indicative AUD price bands per category. Clearly presented in the UI as an
// estimate — replaced by real figures once products carry prices.
const CATEGORY_PRICE_BANDS: Record<string, [number, number]> = {
  sofas: [1200, 3500],
  "coffee-tables": [400, 1200],
  "dining-tables": [900, 2600],
  chairs: [300, 900],
  beds: [1100, 3200],
  "bed-sides": [300, 800],
  "tv-units": [600, 1600],
  rugs: [300, 1100],
  lighting: [200, 900],
  decor: [80, 400],
};

const DEFAULT_BAND: [number, number] = [200, 800];

const STYLE_BUDGET_FACTORS: { match: string; factor: number }[] = [
  { match: "modern luxury", factor: 1.25 },
  { match: "hotel", factor: 1.2 },
  { match: "organic modern", factor: 1.1 },
  { match: "contemporary", factor: 1.05 },
  { match: "warm neutral", factor: 1.0 },
  { match: "minimal", factor: 0.95 },
];

function styleBudgetFactor(style: string): number {
  const key = (style || "").toLowerCase();

  for (const { match, factor } of STYLE_BUDGET_FACTORS) {
    if (key.includes(match)) return factor;
  }

  return 1;
}

export type BudgetEstimate = {
  min: number;
  max: number;
  basis: "prices" | "estimate";
};

export function estimateFurnishingBudget(
  products: Product[],
  roomType: string,
  style: string
): BudgetEstimate {
  const pricedProducts = products.filter(
    (product) => typeof product.price === "number"
  );
  const allPriced =
    products.length > 0 && pricedProducts.length === products.length;

  if (allPriced) {
    const subtotal = pricedProducts.reduce(
      (sum, product) => sum + (product.price as number),
      0
    );

    return { min: roundTo(subtotal), max: roundTo(subtotal), basis: "prices" };
  }

  // Estimate from a full room's worth of categories so the range represents
  // "furnishing a room like this", not just the currently selected pieces.
  const categories =
    getTargetCategories(roomType).length > 0
      ? getTargetCategories(roomType)
      : unique(products.map((product) => product.category));

  const factor = styleBudgetFactor(style);
  let min = 0;
  let max = 0;

  for (const category of categories) {
    const [bandMin, bandMax] = CATEGORY_PRICE_BANDS[category] || DEFAULT_BAND;
    min += bandMin;
    max += bandMax;
  }

  return {
    min: roundTo(min * factor, 100),
    max: roundTo(max * factor, 100),
    basis: "estimate",
  };
}

// ---------------------------------------------------------------------------
// "Complete the Look" recommendations
// ---------------------------------------------------------------------------

const ROOM_CATEGORY_TARGETS: Record<string, string[]> = {
  "living room": ["sofas", "coffee-tables", "rugs", "lighting", "tv-units", "decor"],
  "dining room": ["dining-tables", "chairs", "lighting", "rugs", "decor"],
  bedroom: ["beds", "bed-sides", "lighting", "rugs", "decor"],
  office: ["chairs", "lighting", "decor"],
};

export function getTargetCategories(roomType: string): string[] {
  return ROOM_CATEGORY_TARGETS[(roomType || "").toLowerCase()] || [];
}

function matchScore(
  product: Product,
  styleKey: string,
  paletteColors: Set<string>,
  paletteMaterials: Set<string>
): number {
  let score = 0;

  if (
    styleKey &&
    (product.styleTags || []).some((tag) => {
      const t = tag.toLowerCase();
      return styleKey.includes(t) || t.includes(styleKey);
    })
  ) {
    score += 2;
  }

  score += (product.colors || []).filter((color) =>
    paletteColors.has(color.toLowerCase())
  ).length;
  score += (product.materials || []).filter((material) =>
    paletteMaterials.has(material.toLowerCase())
  ).length;

  return score;
}

/**
 * Recommends one product per target category the current package is missing.
 * Prefers style / colour / material overlap; falls back to the first available
 * product in a category when the catalogue offers no strong match.
 */
export function recommendMissingCategoryProducts(
  packageProducts: Product[],
  roomType: string,
  style: string,
  catalog: Product[] = productList,
  limit = 4
): Product[] {
  const targets = getTargetCategories(roomType);
  if (targets.length === 0) return [];

  const presentCategories = new Set(
    packageProducts.map((product) => product.category)
  );
  const presentIds = new Set(packageProducts.map((product) => product.id));
  const paletteColors = new Set(
    packageProducts.flatMap((product) =>
      (product.colors || []).map((color) => color.toLowerCase())
    )
  );
  const paletteMaterials = new Set(
    packageProducts.flatMap((product) =>
      (product.materials || []).map((material) => material.toLowerCase())
    )
  );
  const styleKey = (style || "").toLowerCase();

  const recommendations: Product[] = [];

  for (const category of targets) {
    if (recommendations.length >= limit) break;
    if (presentCategories.has(category)) continue;

    const candidates = catalog.filter(
      (product) =>
        product.category === category && !presentIds.has(product.id)
    );
    if (candidates.length === 0) continue;

    const best = candidates
      .map((product) => ({
        product,
        score: matchScore(product, styleKey, paletteColors, paletteMaterials),
      }))
      .sort((a, b) => b.score - a.score)[0].product;

    recommendations.push(best);
  }

  return recommendations;
}

// ---------------------------------------------------------------------------
// "Why these products?" design rationale
// ---------------------------------------------------------------------------

const CATEGORY_RATIONALE: Record<string, string> = {
  sofas: "The sofa anchors the main seating zone and sets a clear focal point.",
  "coffee-tables":
    "A coffee table grounds the seating area and adds a practical centrepiece.",
  rugs: "The rug visually connects the furniture and softens the floor underfoot.",
  lighting:
    "Layered lighting warms the space and draws attention to the key pieces.",
  "tv-units":
    "The entertainment unit organises the media wall and keeps sightlines calm.",
  beds: "The bed becomes the restful anchor the room is arranged around.",
  "bed-sides": "The bedside pieces frame the bed and bring a sense of symmetry.",
  "dining-tables":
    "The dining table defines the gathering zone at the heart of the room.",
  chairs: "The seating adds comfort and completes the arrangement.",
  decor: "Considered decor adds character and a finishing layer.",
};

export function buildDesignRationale(
  products: Product[],
  roomType: string,
  style: string,
  max = 5
): string[] {
  if (products.length === 0) return [];

  const presentCategories = new Set(products.map((product) => product.category));
  const materials = unique(
    products.flatMap((product) =>
      (product.materials || []).map((material) => material.toLowerCase())
    )
  );
  const palette = deriveColorPalette(products, 3).map((swatch) =>
    swatch.name.toLowerCase()
  );

  const bullets: string[] = [];
  const orderedCategories = [
    ...getTargetCategories(roomType),
    ...presentCategories,
  ];
  const seenCategories = new Set<string>();

  for (const category of orderedCategories) {
    if (bullets.length >= max - 1) break;
    if (seenCategories.has(category)) continue;
    seenCategories.add(category);

    if (presentCategories.has(category) && CATEGORY_RATIONALE[category]) {
      bullets.push(CATEGORY_RATIONALE[category]);
    }
  }

  const hasWood = materials.some((m) => /wood|timber|oak|walnut|veneer/.test(m));
  const hasStone = materials.some((m) =>
    /stone|marble|sintered|ceramic/.test(m)
  );
  const hasMetal = materials.some((m) =>
    /metal|steel|brass|gold|bronze|iron/.test(m)
  );

  if (hasWood && hasStone) {
    bullets.push(
      "Timber and stone finishes balance the palette and add tactile contrast."
    );
  } else if (hasWood) {
    bullets.push("Warm timber finishes bring natural texture across the pieces.");
  } else if (hasStone) {
    bullets.push("Stone finishes add a cool, premium weight to the scheme.");
  } else if (hasMetal) {
    bullets.push("Metallic detailing adds a refined, contemporary accent.");
  }

  if (palette.length >= 2) {
    bullets.push(
      `The ${palette[0]} and ${palette[1]} tones keep the scheme cohesive and calm.`
    );
  }

  return bullets.slice(0, max);
}

// ---------------------------------------------------------------------------
// Aggregate room summary
// ---------------------------------------------------------------------------

export type RoomSummary = {
  roomTypeLabel: string;
  styleLabel: string;
  palette: PaletteSwatch[];
  mood: string;
  budget: BudgetEstimate;
  productCount: number;
};

export function buildRoomSummary(
  products: Product[],
  roomType: string,
  style: string
): RoomSummary {
  return {
    roomTypeLabel: roomType ? titleCase(roomType) : "Room",
    styleLabel: style ? titleCase(style) : "Curated",
    palette: deriveColorPalette(products),
    mood: deriveRoomMood(style),
    budget: estimateFurnishingBudget(products, roomType, style),
    productCount: products.length,
  };
}
