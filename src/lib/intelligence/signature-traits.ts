/**
 * Signature visual traits — the non-negotiable identity of a product.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PREVIOUS GROUNDING WAS NOT ENOUGH
 * ---------------------------------------------------------------------------
 * The traits were already reaching the renderer. This is the Aspen coffee table
 * exactly as it was described before this module:
 *
 *   category: coffee table | configuration: Unique Coffee Tables | form: two
 *   offset tiers — a rounded-rectangle stone slab plus a smaller floating glass
 *   shelf | shape: straight-lined | material: polished veined white stone
 *   against matte black and clear glass | colour family: white and near-black |
 *   base: black legs base | identifying details: asymmetric two-tier top with a
 *   floating glass shelf; pierced ribbon-loop matte black base; grey-veined
 *   white stone top; rounded-rectangle top profile
 *
 * Everything needed is in there. Three things stop it landing:
 *
 *  1. NO HIERARCHY. "asymmetric two-tier top with a floating glass shelf" — the
 *     feature without which this is simply not the product — sits in a
 *     semicolon list at exactly the same weight as "rounded-rectangle top
 *     profile", which is cosmetic. A renderer that drops the glass is never
 *     told it has failed, so dropping it is a reasonable simplification.
 *
 *  2. CONTRADICTORY FALLBACKS. `base: black legs base` is the NAME-DERIVED
 *     guess, emitted because the enrichment pass left `baseLegs` empty for this
 *     product. It directly contradicts "pierced ribbon-loop matte black base"
 *     two fields later. Told the table has both legs and a ribbon loop, legs is
 *     the more generic and far likelier reading — which is precisely the
 *     "genericised into an ordinary stone table" failure that was reported.
 *
 *  3. MULTI-MATERIAL PRODUCTS ARE NOT FLAGGED. Nothing says "this object is
 *     made of three materials and all three must be visible". Losing one and
 *     keeping the silhouette still satisfies every instruction given.
 *
 * So this module does not add data. It RANKS what is already there, resolves
 * the contradiction, and states the result as a requirement rather than a
 * description.
 */
import type { ProductIdentity } from "./product-profile";
import { getEnrichedProduct } from "./product-intelligence";

export type SignatureTraits = {
  productId: string;
  /**
   * The traits that define this product. Ordered most-identifying first, and
   * stated as requirements — losing any one of these means the render is not
   * this product.
   */
  traits: string[];
  /**
   * Distinct material components that must ALL be visible. Two or more here
   * means the prompt and the reviewer both treat missing components as a hard
   * failure rather than a stylistic difference.
   */
  materialComponents: string[];
  /**
   * The single most identifying feature, elevated in both the prompt and the
   * reviewer. Sculptural and multi-part products benefit most: they are the
   * ones a renderer simplifies.
   */
  primaryFeature: string | null;
  /** True when this product is distinctive enough to warrant the emphasis. */
  isDistinctive: boolean;
};

/**
 * Material words worth calling out as separate components.
 *
 * Only materials whose ABSENCE is visually obvious. "fabric" is not here: a
 * fabric sofa rendered in a slightly different fabric is a fidelity miss, not a
 * missing component, and treating it as one would make every sofa fail.
 */
const COMPONENT_MATERIALS: Array<{ key: string; pattern: RegExp; label: string }> = [
  { key: "glass", pattern: /\bglass\b/i, label: "glass" },
  { key: "stone", pattern: /\b(sintered stone|stone|marble|travertine|granite|quartz)\b/i, label: "stone" },
  { key: "metal", pattern: /\b(brass|bronze|chrome|steel|metal|gold|matte black metal)\b/i, label: "metal" },
  { key: "wood", pattern: /\b(wood|oak|walnut|ash|veneer|timber)\b/i, label: "wood" },
  { key: "leather", pattern: /\b(leather|nubuck|aniline)\b/i, label: "leather" },
  { key: "rattan", pattern: /\b(rattan|cane|wicker|woven natural)\b/i, label: "rattan" },
  /**
   * A matte black element is a component in its own right even when the
   * underlying material is unstated. The Aspen table's base is described only
   * as "matte black" — calling it metal would be inventing a fact, but losing
   * it entirely is exactly the reported failure, so it is named by its finish.
   */
  { key: "matte-black", pattern: /\bmatte black\b/i, label: "matte black finish" },
];

/**
 * Feature words that mark a product as sculptural rather than conventional.
 * These are the products a renderer flattens into a generic version of their
 * category, so they are the ones the emphasis rule targets.
 */
const DISTINCTIVE_MARKERS =
  /\b(loop|ribbon|sculptural|floating|cantilever|asymmetric|two-tier|tiered|arch|curved base|pierced|plinth|drum|nesting|modular)\b/i;

function clean(value: string | undefined | null): string {
  return (value ?? "").trim();
}

/** Deduplicate while preserving order and ignoring case. */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}

/**
 * Rank traits by how identifying they are.
 *
 * A trait naming a distinctive construction ("floating glass shelf",
 * "ribbon-loop base") outranks one naming a material, which outranks a
 * proportion. This ordering is what the prompt's "if you can only preserve
 * some of these" fallback depends on.
 */
function traitRank(trait: string): number {
  if (DISTINCTIVE_MARKERS.test(trait)) return 0;
  if (COMPONENT_MATERIALS.some((material) => material.pattern.test(trait))) {
    return 1;
  }
  return 2;
}

export function buildSignatureTraits(
  productId: string,
  identity: ProductIdentity
): SignatureTraits {
  const enriched = getEnrichedProduct(productId);
  const visual = enriched?.visual;

  /**
   * The trait pool, richest source first. `notableFeatures` is the enrichment
   * pass's own list of what makes this product recognisable, so it leads.
   */
  const pool = dedupe([
    ...(visual?.notableFeatures ?? identity.notableTraits ?? []),
    clean(visual?.silhouette) || clean(identity.silhouette),
    clean(visual?.texture) || clean(identity.material),
    clean(visual?.armStyle),
    clean(visual?.backStyle),
    clean(visual?.baseLegs),
  ]).filter(Boolean);

  const traits = [...pool].sort((a, b) => traitRank(a) - traitRank(b));

  // Material components are read across everything describing the object, not
  // just the material field — "floating glass shelf" is how the glass appears.
  const materialSearchText = [
    ...pool,
    clean(visual?.colourFamily),
    clean(identity.material),
    clean(identity.colourFamily),
  ].join(" | ");

  const materialComponents = COMPONENT_MATERIALS.filter((material) =>
    material.pattern.test(materialSearchText)
  ).map((material) => material.label);

  const primaryFeature =
    traits.find((trait) => DISTINCTIVE_MARKERS.test(trait)) ?? traits[0] ?? null;

  const isDistinctive =
    materialComponents.length >= 2 ||
    traits.some((trait) => DISTINCTIVE_MARKERS.test(trait));

  return {
    productId,
    traits,
    materialComponents,
    primaryFeature,
    isDistinctive,
  };
}

/**
 * A derived base/legs description that the signature traits contradict.
 *
 * Returns the trait to use instead, or null when the derived value is fine.
 * This resolves problem 2 in the header: a name-derived "black legs base" must
 * never sit beside "pierced ribbon-loop matte black base" and invite the
 * renderer to pick the generic one.
 */
export function resolveBaseDescription(
  derivedBase: string,
  signature: SignatureTraits
): string {
  const baseTrait = signature.traits.find((trait) =>
    /\b(base|legs|feet|plinth|loop|ribbon|pedestal|runner)\b/i.test(trait)
  );
  if (!baseTrait) return derivedBase;

  // The derived value is a guess from the product NAME; a trait that actually
  // describes the base is strictly better, so it wins whenever one exists.
  return baseTrait;
}

/** Render the signature block for one product. */
export function formatSignatureTraits(signature: SignatureTraits): string[] {
  if (signature.traits.length === 0) return [];

  const lines: string[] = [];

  lines.push("  SIGNATURE VISUAL TRAITS — non-negotiable. This product is not");
  lines.push("  correctly rendered unless ALL of these are visible:");
  for (const trait of signature.traits) {
    lines.push(`    * ${trait}`);
  }

  if (signature.materialComponents.length >= 2) {
    lines.push(
      `  MULTI-MATERIAL PRODUCT — it combines ${signature.materialComponents.join(
        ", "
      )}. EVERY one of those materials must be visibly present in the finished piece. Rendering it in a single material is a failure, even if the shape is right.`
    );
  }

  if (signature.primaryFeature) {
    lines.push(
      `  MOST IDENTIFYING FEATURE: ${signature.primaryFeature}. If this is missing or simplified, the render is wrong regardless of how good the rest looks.`
    );
  }

  if (signature.isDistinctive) {
    lines.push(
      "  DO NOT SIMPLIFY this into a generic piece of its category. It is a distinctive, sculptural design; an ordinary version of the same furniture type is a failed render."
    );
  }

  return lines;
}
