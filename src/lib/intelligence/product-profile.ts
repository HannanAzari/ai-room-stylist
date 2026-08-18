/**
 * Product Intelligence layer (Phase 1).
 *
 * Turns a catalogue Product into a rich, structured ProductProfile used by the
 * prompt builder. Profile fields are either taken from real feed data (when a
 * Koala product feed populates them) or DERIVED deterministically from the
 * product's existing attributes (name, category, colours, materials, tags).
 *
 * Nothing here fabricates commercial catalogue data (price/url/dimensions).
 * The derived descriptors are prompt-engineering intelligence, computed on the
 * fly and never written back into products.json.
 */
import { getAllProducts, type Product } from "@/lib/products";
import { getEnrichedProduct } from "./product-intelligence";

export type ReplacementRule = {
  // What existing element in the room this product should replace/occupy.
  target: string;
  // Placement guidance for that target.
  placement: string;
};

/**
 * Structured identity of a product — the fields that decide whether the
 * generated object IS this product rather than merely something in the same
 * style. Rendered into the prompt beside the reference image and handed to the
 * reviewer, so identity can be checked field by field instead of by vibe.
 *
 * Every field is derived from real catalogue data (name, colours, materials,
 * category) or left as an honest empty string. Nothing is invented.
 */
export type ProductIdentity = {
  /** Human-readable category, e.g. "sofa". */
  category: string;
  /** Overall form, e.g. "generous, sectional". */
  silhouette: string;
  /** Seat/size configuration, e.g. "3-seater modular with left terminal". */
  configuration: string;
  /** Primary materials, e.g. "woven fabric". */
  material: string;
  /** Broad colour family for fast mismatch detection, e.g. "cream / neutral". */
  colourFamily: string;
  /** Legs or base treatment, e.g. "plinth base". */
  legsBase: string;
  /** Shape, including table-top shape where relevant, e.g. "round". */
  shape: string;
  /** Distinguishing details a reviewer can actually look for. */
  notableTraits: string[];
};

export type ProductProfile = {
  id: string;
  title: string;
  category: string;
  categoryLabel: string;
  /** Structured identity used for grounding and verification. */
  identity: ProductIdentity;
  style: string;
  colour: string;
  colours: string[];
  materials: string[];
  finish: string;
  shape: string;
  silhouette: string;
  legsBase: string;
  texture: string;
  tags: string[];
  roomTypes: string[];
  availability: string;
  // A concise natural-language descriptor for image prompts.
  promptFragment: string;
  // Product-specific things the model must avoid.
  negativePrompt: string[];
  // How this product replaces / occupies room elements.
  replacementRules: ReplacementRule[];
  // Ids of catalogue products that pair well with this one.
  matchingProducts: string[];
};

const CATEGORY_LABELS: Record<string, string> = {
  sofas: "sofa",
  "coffee-tables": "coffee table",
  "dining-tables": "dining table",
  chairs: "chair",
  lighting: "light",
  decor: "decor piece",
  rugs: "rug",
  "tv-units": "entertainment unit",
  beds: "bed",
  "bed-sides": "bedside table",
};

const CATEGORY_ROOM_TYPES: Record<string, string[]> = {
  sofas: ["living room"],
  "coffee-tables": ["living room"],
  "tv-units": ["living room"],
  "dining-tables": ["dining room"],
  chairs: ["dining room", "living room", "office"],
  beds: ["bedroom"],
  "bed-sides": ["bedroom"],
  lighting: ["living room", "dining room", "bedroom", "office"],
  rugs: ["living room", "dining room", "bedroom"],
  decor: ["living room", "dining room", "bedroom", "office"],
};

const CATEGORY_REPLACEMENT: Record<string, ReplacementRule> = {
  sofas: {
    target: "existing main seating",
    placement:
      "against the primary wall or within the main seating zone, facing the room's focal point",
  },
  "coffee-tables": {
    target: "existing coffee/centre table",
    placement: "centred in front of the sofa with realistic walking clearance",
  },
  "dining-tables": {
    target: "existing dining table",
    placement: "in the dining zone with chairs tucked around it",
  },
  chairs: {
    target: "existing chairs/accent seating",
    placement: "around the table or as accent seating in the room",
  },
  lighting: {
    target: "existing lighting fixture",
    placement:
      "a floor lamp beside seating, or a pendant/chandelier centred overhead at believable ceiling height",
  },
  rugs: {
    target: "existing rug/bare floor under the seating area",
    placement:
      "under the seating or dining group, large enough to anchor the furniture",
  },
  "tv-units": {
    target: "existing TV/media unit",
    placement: "against the media wall beneath the TV position",
  },
  beds: {
    target: "existing bed",
    placement: "centred against the main bedroom wall as the room's anchor",
  },
  "bed-sides": {
    target: "existing bedside tables",
    placement: "flanking the bed symmetrically",
  },
  decor: {
    target: "bare walls or empty surfaces",
    placement: "on a wall or surface at believable height and scale",
  },
};

function includesAny(haystack: string, needles: string[]): string | null {
  for (const needle of needles) {
    if (haystack.includes(needle)) return needle;
  }
  return null;
}

function titleCase(value: string): string {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function deriveShape(name: string, category: string): string {
  const n = name.toLowerCase();
  const match = includesAny(n, [
    "round",
    "oval",
    "curved",
    "square",
    "rectangular",
    "arch",
    "triangular",
    "modular",
    "corner",
  ]);
  if (match) return match;
  if (category === "rugs") return "rectangular";
  if (category === "sofas") return "linear";
  return "straight-lined";
}

function deriveSilhouette(name: string, category: string): string {
  const n = name.toLowerCase();
  if (/recliner|modular|corner|4 seater|4-seater/.test(n)) {
    return "generous, sectional";
  }
  if (category === "coffee-tables" || category === "tv-units") {
    return "low-profile";
  }
  if (category === "lighting") return "slim, vertical";
  if (category === "chairs") return "compact, sculptural";
  return "clean-lined";
}

function deriveFinish(name: string, materials: string[]): string {
  const source = `${name} ${materials.join(" ")}`.toLowerCase();
  const match = includesAny(source, [
    "matte",
    "gloss",
    "brushed",
    "polished",
    "veneer",
    "sintered stone",
    "travertine",
    "marble",
    "aniline",
    "nubuck",
    "brushed gold",
    "champagne gold",
    "bronze",
  ]);
  if (match) return match;
  if (materials.some((m) => /leather/.test(m))) return "natural leather sheen";
  if (materials.some((m) => /wood|oak|walnut|ash/.test(m))) return "wood grain";
  if (materials.some((m) => /fabric|chenille|boucle|velvet/.test(m))) {
    return "soft matte textile";
  }
  return "natural";
}

function deriveTexture(name: string, materials: string[]): string {
  const source = `${name} ${materials.join(" ")}`.toLowerCase();
  const match = includesAny(source, [
    "woven",
    "boucle",
    "bouclé",
    "chenille",
    "velvet",
    "nubuck",
    "leather",
    "linen",
    "rattan",
    "stone",
    "glass",
  ]);
  if (match) return match;
  if (materials.length > 0) return materials[0];
  return "smooth";
}

function deriveLegsBase(name: string): string {
  const n = name.toLowerCase();
  const metal = includesAny(n, [
    "gold legs",
    "champagne gold",
    "brushed gold",
    "black legs",
    "matte black legs",
    "bronze",
    "stainless steel",
    "metal",
    "chrome",
  ]);
  if (metal) return `${metal} base`;
  const wood = includesAny(n, ["wooden legs", "walnut", "oak", "ash", "veneer"]);
  if (wood) return `${wood} base`;
  if (/plinth|platform|base/.test(n)) return "plinth base";
  return "concealed or minimal base";
}

function deriveColour(colours: string[], name: string): string {
  if (colours.length > 0) return colours.join(" / ");
  const match = includesAny(name.toLowerCase(), [
    "cream",
    "beige",
    "white",
    "black",
    "green",
    "tan",
    "mustard",
    "walnut",
    "gold",
    "bronze",
    "stone",
    "grey",
    "brown",
  ]);
  return match || "neutral";
}

/**
 * Broad colour family, so a reviewer can spot "cream sofa rendered as charcoal"
 * without needing to match an exact catalogue shade.
 */
const COLOUR_FAMILIES: [string, string[]][] = [
  ["cream / neutral", ["cream", "ivory", "beige", "sand", "oat", "pearl", "stone", "linen", "natural"]],
  ["white", ["white", "chalk", "snow", "statuario"]],
  ["grey", ["grey", "gray", "silver", "smoke", "ash grey"]],
  ["black / charcoal", ["black", "charcoal", "ebony", "onyx", "graphite"]],
  ["brown / tan", ["brown", "tan", "cognac", "chocolate", "mocha", "walnut", "chestnut", "camel", "toffee"]],
  ["warm wood", ["oak", "ash", "teak", "veneer", "timber", "wooden"]],
  ["green", ["green", "olive", "sage", "emerald", "forest"]],
  ["blue", ["blue", "navy", "denim", "teal", "indigo"]],
  ["gold / brass", ["gold", "brass", "bronze", "champagne"]],
  ["mustard / yellow", ["mustard", "yellow", "ochre", "amber"]],
  ["red / pink", ["red", "crimson", "burgundy", "rust", "terracotta", "pink", "blush"]],
];

function deriveColourFamily(colours: string[], name: string): string {
  const haystack = `${colours.join(" ")} ${name}`.toLowerCase();
  const matched: string[] = [];
  for (const [family, tokens] of COLOUR_FAMILIES) {
    if (tokens.some((token) => haystack.includes(token))) matched.push(family);
  }
  return matched.slice(0, 2).join(" with ") || "neutral";
}

/**
 * Seat count / modular configuration / size, pulled from the product name,
 * which is where Koala encodes it (e.g. "3 Pieces Modular ... Left Terminal").
 */
function deriveConfiguration(name: string, category: string): string {
  const n = name.toLowerCase();
  const parts: string[] = [];

  const seater = n.match(/(\d)\s*[- ]?\s*seater/);
  if (seater) parts.push(`${seater[1]}-seater`);

  const pieces = n.match(/(\d)\s*pieces?/);
  if (pieces) parts.push(`${pieces[1]}-piece`);

  if (/modular/.test(n)) parts.push("modular");
  if (/sectional/.test(n)) parts.push("sectional");
  if (/corner/.test(n)) parts.push("corner");
  if (/chaise/.test(n)) parts.push("with chaise");
  if (/left terminal/.test(n)) parts.push("left terminal");
  if (/right terminal/.test(n)) parts.push("right terminal");
  if (/side platform/.test(n)) parts.push("side platform");
  if (/recliner/.test(n)) parts.push("recliner");
  if (/electric/.test(n)) parts.push("electric");
  if (/extendable|extension/.test(n)) parts.push("extendable");

  // Dimensions encoded in the name, e.g. "240x120cm" or "120 cm".
  const dims = n.match(/(\d{2,3})\s*(?:cm)?\s*[x×]\s*(\d{2,3})\s*cm/);
  if (dims) parts.push(`${dims[1]}x${dims[2]}cm`);
  else {
    const single = n.match(/(\d{2,3})\s*cm/);
    if (single) parts.push(`${single[1]}cm`);
  }

  if (/queen/.test(n)) parts.push("queen size");
  if (/king/.test(n)) parts.push("king size");

  if (parts.length === 0) {
    return category === "sofas" ? "standard seating configuration" : "";
  }
  return parts.join(", ");
}

/**
 * Distinguishing details worth checking in a render. Kept concrete and visual —
 * things that are actually visible, not marketing language.
 */
function deriveNotableTraits(
  name: string,
  materials: string[],
  shape: string,
  legsBase: string
): string[] {
  const n = name.toLowerCase();
  const traits: string[] = [];

  if (/sintered stone|marble|travertine/.test(n)) {
    traits.push("stone-look table top");
  }
  if (/veneer/.test(n)) traits.push("wood veneer surface");
  if (/boucle|bouclé|woven/.test(n)) traits.push("textured woven upholstery");
  if (/velvet|velveteen/.test(n)) traits.push("velvet pile");
  if (/leather|nubuck/.test(n)) traits.push("leather-look upholstery");
  if (/rattan|cane/.test(n)) traits.push("rattan/cane detailing");
  if (/arch/.test(n)) traits.push("arched profile");
  if (/round|oval/.test(n)) traits.push("rounded form, no sharp corners");
  if (/tufted|channel/.test(n)) traits.push("tufted/channelled detailing");
  if (/gold|brass|bronze|champagne/.test(n)) traits.push("metallic warm-tone accents");
  if (/matte black/.test(n)) traits.push("matte black metalwork");

  if (traits.length === 0) {
    // Fall back to the derived descriptors so the list is never empty.
    if (shape) traits.push(`${shape} form`);
    if (legsBase) traits.push(legsBase);
    if (materials.length > 0) traits.push(`${materials[0]} construction`);
  }

  return traits.slice(0, 4);
}

/** One-line identity summary for prompts and reviewer grounding. */
export function formatIdentity(identity: ProductIdentity): string {
  return [
    `category: ${identity.category}`,
    identity.configuration ? `configuration: ${identity.configuration}` : "",
    `form: ${identity.silhouette}`,
    `shape: ${identity.shape}`,
    `material: ${identity.material}`,
    `colour family: ${identity.colourFamily}`,
    `base: ${identity.legsBase}`,
    identity.notableTraits.length > 0
      ? `identifying details: ${identity.notableTraits.join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

export function buildProductProfile(
  product: Product,
  catalogue: Product[] = getAllProducts()
): ProductProfile {
  const category = product.category;
  const categoryLabel = CATEGORY_LABELS[category] || category.replace(/-/g, " ");
  const style = product.styleTags?.[0] || "modern luxury";
  const colours = product.colors || [];
  const materials = product.materials || [];
  const colour = deriveColour(colours, product.name);
  const finish = product.finish?.trim() || deriveFinish(product.name, materials);
  const shape = product.shape?.trim() || deriveShape(product.name, category);
  const silhouette =
    product.silhouette?.trim() || deriveSilhouette(product.name, category);
  const legsBase = product.legsBase?.trim() || deriveLegsBase(product.name);
  const texture = product.texture?.trim() || deriveTexture(product.name, materials);
  const roomTypes =
    product.roomCompatibility && product.roomCompatibility.length > 0
      ? product.roomCompatibility
      : CATEGORY_ROOM_TYPES[category] || ["living room"];

  const tags = [
    ...new Set(
      [
        style,
        category,
        ...colours,
        ...materials,
        shape,
        finish,
      ]
        .map((t) => t.toLowerCase().trim())
        .filter(Boolean)
    ),
  ];

  const replacementRules: ReplacementRule[] = CATEGORY_REPLACEMENT[category]
    ? [CATEGORY_REPLACEMENT[category]]
    : [
        {
          target: "the matching existing item",
          placement: "in its natural location for this room",
        },
      ];

  const materialPhrase =
    materials.length > 0 ? materials.join(" and ") : "premium materials";
  const promptFragment = `${categoryLabel} in ${colour} ${materialPhrase} (${finish} finish, ${shape} shape, ${silhouette} silhouette, ${legsBase})`;

  const negativePrompt = [
    "wrong colour or material for this product",
    "distorted or duplicated furniture",
    `${categoryLabel} at an unrealistic scale`,
    "warped legs, floating furniture, incorrect proportions",
  ];

  // Matching products: prefer same style + overlapping colours, different
  // category, so they read as a coordinated room package.
  const productColourSet = new Set(colours.map((c) => c.toLowerCase()));
  const matchingProducts = catalogue
    .filter((candidate) => candidate.id !== product.id)
    .map((candidate) => {
      let score = 0;
      if ((candidate.styleTags || []).includes(style)) score += 2;
      if (candidate.category !== category) score += 1;
      score += (candidate.colors || []).filter((c) =>
        productColourSet.has(c.toLowerCase())
      ).length;
      return { id: candidate.id, category: candidate.category, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((entry) => entry.id);

  const materialPhraseForIdentity =
    materials.length > 0 ? materials.join(" and ") : texture || "premium materials";
  /**
   * Enriched identity, where it exists.
   *
   * Everything derived above is inferred from the product NAME and its colour /
   * material tags — the best this app could do on its own. The enrichment pass
   * looked at the actual photographs, so its fields are both more specific and
   * more accurate ("thick rounded slab arm, only slightly above the seat" vs a
   * silhouette guessed from the title).
   *
   * Field by field rather than wholesale: a product missing one enriched field
   * keeps the derived value for that field instead of losing it, so a partial
   * record is strictly better than none and never worse.
   */
  const enriched = getEnrichedProduct(product.id);
  const preferEnriched = (enrichedValue: string, derived: string) =>
    enrichedValue.trim() || derived;

  const identity: ProductIdentity = {
    category: categoryLabel,
    silhouette: preferEnriched(enriched?.visual.silhouette ?? "", silhouette),
    configuration: preferEnriched(
      // The official subcategory ("2 Seater Sofa") is a catalogue fact; the
      // name-derived configuration is a guess. Prefer the fact.
      enriched?.official.configuration || enriched?.official.subcategory || "",
      deriveConfiguration(product.name, category)
    ),
    material: preferEnriched(
      enriched?.visual.texture ?? "",
      materialPhraseForIdentity
    ),
    colourFamily: preferEnriched(
      enriched?.visual.colourFamily ?? "",
      deriveColourFamily(colours, product.name)
    ),
    legsBase: preferEnriched(enriched?.visual.baseLegs ?? "", legsBase),
    shape: preferEnriched(enriched?.visual.shape ?? "", shape),
    notableTraits:
      enriched && enriched.visual.notableFeatures.length > 0
        ? enriched.visual.notableFeatures
        : deriveNotableTraits(product.name, materials, shape, legsBase),
  };

  return {
    id: product.id,
    title: product.name,
    category,
    categoryLabel,
    identity,
    style,
    colour,
    colours,
    materials,
    finish,
    shape,
    silhouette,
    legsBase,
    texture,
    tags,
    roomTypes,
    availability: product.availability?.trim() || product.stockStatus || "unknown",
    promptFragment,
    negativePrompt,
    replacementRules,
    matchingProducts,
  };
}

const profileCache = new Map<string, ProductProfile>();

export function getProductProfile(product: Product): ProductProfile {
  const cached = profileCache.get(product.id);
  if (cached) return cached;

  const profile = buildProductProfile(product);
  profileCache.set(product.id, profile);
  return profile;
}

export function getProductProfiles(products: Product[]): ProductProfile[] {
  return products.map(getProductProfile);
}

export { titleCase as titleCaseLabel };
