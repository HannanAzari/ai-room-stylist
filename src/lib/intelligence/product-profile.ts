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

export type ReplacementRule = {
  // What existing element in the room this product should replace/occupy.
  target: string;
  // Placement guidance for that target.
  placement: string;
};

export type ProductProfile = {
  id: string;
  title: string;
  category: string;
  categoryLabel: string;
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

  return {
    id: product.id,
    title: product.name,
    category,
    categoryLabel,
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
