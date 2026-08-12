/**
 * Canonical scene taxonomy (Replacement Accuracy sprint, Phase 2 + 3).
 *
 * The scene graph's vision model returns FREE TEXT categories ("TV console",
 * "low sideboard", "3 seater couch"). Matching those raw strings with substring
 * tests was the root of two production bugs:
 *
 *   1. "tv unit" contains "tv", so an entertainment unit was classified as a
 *      television and became permanently non-replaceable.
 *   2. A product of one category could match an existing item of another,
 *      because matching was bidirectional `String.includes`.
 *
 * This module fixes both by deriving a CANONICAL category from the raw label
 * exactly once, deterministically, with no network call. Planner logic then
 * compares canonical enum values — never raw substrings.
 *
 * The raw vision label is always preserved alongside the canonical value so the
 * debug/eval log keeps full fidelity for diagnosis.
 *
 * Nothing here fabricates confidence — canonicalisation is a pure string
 * mapping and reports whether it recognised the label, nothing more.
 */

/** Canonical furniture/object categories the planner reasons about. */
export type CanonicalCategory =
  // --- Replaceable furniture -------------------------------------------
  | "sofa"
  | "armchair"
  | "chair"
  | "coffee-table"
  | "dining-table"
  | "desk"
  | "bed"
  | "bedside"
  | "dresser"
  | "sideboard"
  | "bookshelf"
  | "tv-unit"
  | "rug"
  | "mirror"
  | "artwork"
  | "floor-lamp"
  | "table-lamp"
  | "ceiling-light"
  | "plant"
  // --- Fixed / architectural (never replaced) ---------------------------
  | "tv"
  | "window"
  | "door"
  | "curtains"
  | "air-conditioner"
  | "fireplace"
  | "radiator"
  | "ceiling-fan"
  | "built-in"
  // --- Fallback ----------------------------------------------------------
  | "unknown";

/**
 * Ordered canonicalisation rules. ORDER IS LOAD-BEARING: more specific
 * compounds must precede the generic tokens they contain, so "tv unit" is
 * resolved as furniture before the bare "tv" rule can claim it. Never reorder
 * without re-running the taxonomy tests.
 */
const CANONICAL_RULES: ReadonlyArray<{
  canonical: CanonicalCategory;
  patterns: readonly string[];
}> = [
  // --- Compounds containing "tv"/"media" MUST come before "tv" ----------
  {
    canonical: "tv-unit",
    patterns: [
      "tv unit",
      "tv console",
      "tv stand",
      "tv cabinet",
      "tv bench",
      "tv table",
      "television unit",
      "television console",
      "television stand",
      "television cabinet",
      "entertainment unit",
      "entertainment centre",
      "entertainment center",
      "entertainment console",
      "media unit",
      "media console",
      "media cabinet",
      "media centre",
      "media center",
      "lowboard",
    ],
  },
  // --- Multi-word furniture before their generic head nouns -------------
  {
    canonical: "coffee-table",
    patterns: ["coffee table", "cocktail table", "centre table", "center table"],
  },
  {
    canonical: "dining-table",
    patterns: ["dining table", "dinner table", "kitchen table", "dining set"],
  },
  {
    canonical: "bedside",
    patterns: [
      "bedside table",
      "bedside cabinet",
      "bedside drawer",
      "bed side table",
      "nightstand",
      "night stand",
      "night table",
    ],
  },
  {
    canonical: "floor-lamp",
    patterns: ["floor lamp", "standing lamp", "standard lamp", "torchiere"],
  },
  {
    canonical: "table-lamp",
    patterns: ["table lamp", "desk lamp", "bedside lamp", "side lamp"],
  },
  {
    canonical: "ceiling-light",
    patterns: [
      "ceiling light",
      "ceiling lamp",
      "pendant light",
      "pendant lamp",
      "chandelier",
      "pendant",
      "downlight",
      "spotlight",
    ],
  },
  { canonical: "ceiling-fan", patterns: ["ceiling fan"] },
  {
    canonical: "air-conditioner",
    patterns: [
      "air conditioner",
      "air conditioning",
      "air con",
      "aircon",
      "ac unit",
      "split system",
      "hvac",
      "heat pump",
    ],
  },
  {
    canonical: "artwork",
    patterns: [
      "artwork",
      "wall art",
      "painting",
      "canvas",
      "picture frame",
      "framed print",
      "wall print",
      "poster",
      "art piece",
    ],
  },
  { canonical: "mirror", patterns: ["mirror"] },
  // "lounge chair" must resolve to armchair before the "lounge" sofa alias.
  {
    canonical: "armchair",
    patterns: [
      "armchair",
      "arm chair",
      "accent chair",
      "lounge chair",
      "occasional chair",
      "reading chair",
      "recliner chair",
      "wingback",
      "wing chair",
    ],
  },
  {
    canonical: "dresser",
    patterns: ["dresser", "chest of drawers", "tallboy", "bureau", "drawers"],
  },
  { canonical: "sideboard", patterns: ["sideboard", "buffet", "credenza"] },
  {
    canonical: "bookshelf",
    patterns: [
      "bookshelf",
      "bookcase",
      "shelving unit",
      "shelf unit",
      "shelving",
      "shelves",
      "bookshelves",
    ],
  },
  {
    canonical: "desk",
    patterns: ["desk", "writing table", "study table", "workstation"],
  },
  {
    canonical: "sofa",
    patterns: [
      "sofa",
      "couch",
      "settee",
      "loveseat",
      "love seat",
      "sectional",
      "chaise",
      "lounge suite",
      "modular lounge",
      "lounge",
    ],
  },
  { canonical: "bed", patterns: ["bed frame", "headboard", "bed head", "bed"] },
  { canonical: "rug", patterns: ["rug", "carpet", "floor mat", "mat"] },
  {
    canonical: "curtains",
    patterns: [
      "curtain",
      "drape",
      "blind",
      "shutter",
      "sheer",
      "window covering",
      "roller blind",
    ],
  },
  { canonical: "window", patterns: ["window", "skylight"] },
  { canonical: "door", patterns: ["door", "doorway", "archway", "sliding door"] },
  {
    canonical: "fireplace",
    patterns: ["fireplace", "fire place", "hearth", "mantel", "mantelpiece"],
  },
  { canonical: "radiator", patterns: ["radiator", "heater"] },
  {
    canonical: "built-in",
    patterns: [
      "built in",
      "builtin",
      "cabinetry",
      "joinery",
      "wardrobe",
      "closet",
      "column",
      "pillar",
      "beam",
      "skirting",
      "cornice",
      "vent",
      "power outlet",
      "light switch",
      "smoke alarm",
      "alcove",
    ],
  },
  {
    canonical: "plant",
    patterns: ["plant", "planter", "pot plant", "fern", "palm"],
  },
  // Bare "tv" LAST among tv-ish labels — every compound above already ran.
  {
    canonical: "tv",
    patterns: [
      "tv",
      "television",
      "telly",
      "flat screen",
      "flatscreen",
      "tv screen",
      "smart tv",
    ],
  },
  // Generic seating last, so armchair/sofa/dining variants win first.
  {
    canonical: "chair",
    patterns: [
      "chair",
      "stool",
      "bench",
      "ottoman",
      "pouffe",
      "pouf",
      "footstool",
      "seat",
    ],
  },
] as const;

/**
 * Canonical categories that are architecture or non-movable fixtures. These are
 * NEVER replaced or removed by generation. Note that "tv-unit" is deliberately
 * absent — an entertainment unit is furniture and IS replaceable; only the
 * television itself ("tv") is protected.
 */
const FIXED_CANONICAL: ReadonlySet<CanonicalCategory> = new Set([
  "tv",
  "window",
  "door",
  "curtains",
  "air-conditioner",
  "fireplace",
  "radiator",
  "ceiling-fan",
  "built-in",
]);

/**
 * Catalogue product category -> canonical scene categories it may replace, in
 * preference order (index 0 is the ideal match). A product can ONLY replace a
 * scene item whose canonical category appears in its list, which makes
 * cross-category swaps (the "TV unit replaced a sofa" bug) structurally
 * impossible rather than merely unlikely.
 */
const PRODUCT_CATEGORY_TO_CANONICAL: Record<string, CanonicalCategory[]> = {
  sofas: ["sofa"],
  "coffee-tables": ["coffee-table"],
  "dining-tables": ["dining-table"],
  chairs: ["chair", "armchair"],
  lighting: ["floor-lamp", "table-lamp", "ceiling-light"],
  rugs: ["rug"],
  "tv-units": ["tv-unit"],
  beds: ["bed"],
  "bed-sides": ["bedside"],
  decor: ["artwork", "mirror"],
};

/** Canonical categories whose natural home is a wall rather than the floor. */
const WALL_MOUNTED: ReadonlySet<CanonicalCategory> = new Set([
  "artwork",
  "mirror",
  "tv",
]);

/**
 * Large "anchor" furniture that defines a room's composition. These are
 * generated in the first pass, against the untouched room photo, because
 * getting their footprint and perspective right constrains everything else.
 * Smaller secondary items (coffee table, rug, lamps, decor) are layered on
 * afterwards.
 */
const ANCHOR_CANONICAL: ReadonlySet<CanonicalCategory> = new Set([
  "sofa",
  "bed",
  "dining-table",
  "tv-unit",
  "dresser",
  "sideboard",
  "bookshelf",
  "desk",
  "armchair",
]);

/** Anchor products for a catalogue category (first generation pass). */
export function isAnchorProductCategory(productCategory: string): boolean {
  const targets = canonicalTargetsForProductCategory(productCategory);
  return targets.length > 0 && ANCHOR_CANONICAL.has(targets[0]);
}

/** Anchor objects by canonical scene category. */
export function isAnchorCategory(canonical: CanonicalCategory): boolean {
  return ANCHOR_CANONICAL.has(canonical);
}

function singulariseToken(token: string): string {
  if (token.length > 3 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 4 && token.endsWith("ses")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * Normalise a free-text label to a space-delimited, singularised key so that
 * "TV Units", "tv-unit" and "TV unit" all reduce to "tv unit". Patterns and
 * inputs both pass through this, so comparisons are always like-for-like.
 */
export function normaliseCategoryKey(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(singulariseToken)
    .join(" ");
}

/** Whole-word phrase containment on an already-normalised key. */
function containsPhrase(haystackKey: string, patternKey: string): boolean {
  if (!haystackKey || !patternKey) return false;
  return ` ${haystackKey} `.includes(` ${patternKey} `);
}

export type CanonicalisationResult = {
  canonical: CanonicalCategory;
  /** The raw label exactly as the vision model returned it. */
  raw: string;
  /** False when no rule matched and `canonical` fell back to "unknown". */
  recognised: boolean;
};

/**
 * Derive the canonical category for a raw scene label. Deterministic and
 * order-sensitive: the first matching rule wins, and rules are ordered so
 * specific compounds beat the generic tokens they contain.
 */
export function canonicaliseCategory(raw: string): CanonicalisationResult {
  const key = normaliseCategoryKey(raw);
  if (!key) return { canonical: "unknown", raw, recognised: false };

  for (const rule of CANONICAL_RULES) {
    for (const pattern of rule.patterns) {
      if (containsPhrase(key, normaliseCategoryKey(pattern))) {
        return { canonical: rule.canonical, raw, recognised: true };
      }
    }
  }

  return { canonical: "unknown", raw, recognised: false };
}

/** Is this canonical category architecture / a protected fixture? */
export function isFixedCanonical(canonical: CanonicalCategory): boolean {
  return FIXED_CANONICAL.has(canonical);
}

/**
 * May generation replace an object of this canonical category?
 *
 * "unknown" is deliberately NOT replaceable: if we could not understand the
 * label we must not authorise the image model to swap it out. It is preserved
 * explicitly rather than silently ignored (see the planner's dispositions).
 */
export function isReplaceableCanonical(canonical: CanonicalCategory): boolean {
  if (canonical === "unknown") return false;
  return !isFixedCanonical(canonical);
}

/** Canonical scene categories a catalogue product category may replace. */
export function canonicalTargetsForProductCategory(
  productCategory: string
): CanonicalCategory[] {
  return PRODUCT_CATEGORY_TO_CANONICAL[productCategory] || [];
}

/**
 * How well a product category matches a scene item's canonical category.
 * Higher is better; 0 means "must never match".
 */
export function productCategoryMatchScore(
  productCategory: string,
  sceneCanonical: CanonicalCategory
): number {
  const targets = canonicalTargetsForProductCategory(productCategory);
  const index = targets.indexOf(sceneCanonical);
  if (index === -1) return 0;
  // Preferred target scores highest; later alternates score progressively less.
  return targets.length - index;
}

/** Does this product category belong on a wall rather than the floor? */
export function isWallMountedProductCategory(productCategory: string): boolean {
  const targets = canonicalTargetsForProductCategory(productCategory);
  return targets.length > 0 && targets.every((target) => WALL_MOUNTED.has(target));
}

/** Does this canonical scene category belong on a wall? */
export function isWallMountedCanonical(canonical: CanonicalCategory): boolean {
  return WALL_MOUNTED.has(canonical);
}

/**
 * Readable noun for a canonical category, for prompts that must describe the
 * shared category of several differently-named objects (e.g. a "3 seater sofa"
 * and a "two seater couch" are both, canonically, a sofa).
 */
export function canonicalCategoryLabel(canonical: CanonicalCategory): string {
  if (canonical === "unknown") return "object";
  if (canonical === "tv") return "television";
  if (canonical === "tv-unit") return "entertainment unit";
  return canonical.replace(/-/g, " ");
}
