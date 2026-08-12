/**
 * Replacement groups — household-level replacement semantics.
 *
 * A customer thinks "I want THIS sofa", not "assign product A to sofa 1 and
 * product B to sofa 2". So they pick ONE product per category, and the planner
 * works out how that applies to the individual objects they selected.
 *
 * The interesting case is seating. Replacing two matching two-seaters with a
 * chosen sofa means two of that sofa. Replacing them with an L-shaped sectional
 * means ONE unit spanning the seating zone, not a corner sofa duplicated into
 * both former positions — which would be a nonsense room and a nonsense basket.
 *
 * ---------------------------------------------------------------------------
 * CONFIGURATION IS DERIVED FROM REAL FIELDS, CONSERVATIVELY
 * ---------------------------------------------------------------------------
 * The catalogue has no configuration field, so it is derived from the product
 * name, which does carry real signal ("Corner", "Left Terminal", "3 Seater").
 * Only STRONG evidence of a combined seating unit — a corner, a terminal, a
 * chaise — classifies a product as sectional. "Modular" alone does not: a
 * multi-piece modular sofa is frequently just a straight sofa assembled from
 * parts, and guessing wrong here deletes furniture from someone's room.
 *
 * Anything unrecognised is `unknown` and takes the SAFE standard path.
 */
import type { Product } from "@/lib/products";
import type { CanonicalCategory } from "./scene-taxonomy";
import type { ReplacementTarget } from "./replacement-assignment";

/** How a seating product is physically configured. */
export type SofaConfiguration =
  | "standard-sofa"
  | "sectional-or-l-shape"
  | "unknown";

/** How one chosen product is applied across the objects it replaces. */
export type ReplacementStrategy =
  /** One unit per target — two sofas become two of the chosen sofa. */
  | "replace-each"
  /** All targets collapse into ONE combined unit placed once. */
  | "replace-group-with-single";

/**
 * Strong evidence of a combined/L-shaped seating unit. A "terminal" is the
 * returning arm of a sectional; a "chaise" extends one end; "corner" is
 * explicit.
 */
const SECTIONAL_MARKERS = [
  "corner",
  "terminal",
  "chaise",
  "sectional",
  "l shape",
  "l shaped",
  "u shape",
  "u shaped",
];

/** Evidence of a conventional, single-footprint sofa. */
const STANDARD_MARKERS = [/\b\d\s*seater\b/, /\bloveseat\b/, /\bsettee\b/];

/**
 * Classify a seating product's configuration from real catalogue data.
 *
 * Deliberately biased toward `standard-sofa`: treating a straight sofa as a
 * sectional would remove seating the customer never agreed to lose.
 */
export function classifySofaConfiguration(product: Product): SofaConfiguration {
  const name = (product.name || "").toLowerCase();
  const shape = (product.shape || "").toLowerCase();
  const silhouette = (product.silhouette || "").toLowerCase();
  const haystack = `${name} ${shape} ${silhouette}`;

  if (SECTIONAL_MARKERS.some((marker) => haystack.includes(marker))) {
    return "sectional-or-l-shape";
  }
  if (STANDARD_MARKERS.some((pattern) => pattern.test(haystack))) {
    return "standard-sofa";
  }
  return "unknown";
}

/** Does this configuration occupy one combined seating footprint? */
export function isCombinedSeatingUnit(configuration: SofaConfiguration): boolean {
  return configuration === "sectional-or-l-shape";
}

/**
 * A category's worth of replacement: every object of that category the customer
 * selected, plus the single product they chose for it.
 */
export type ReplacementGroup = {
  canonicalCategory: CanonicalCategory;
  /** Every selected object this product applies to. */
  targets: ReplacementTarget[];
  selectedProductId: string;
  selectedProductName: string;
  strategy: ReplacementStrategy;
  /** Physical units required — what the basket must actually charge for. */
  quantity: number;
  /** Only meaningful for seating. */
  configuration: SofaConfiguration;
};

/**
 * Decide how one chosen product applies to the objects it will replace.
 *
 * Seating collapses to a single unit only when the chosen product is genuinely
 * a combined sectional AND there is more than one seat to combine. Every other
 * case replaces each object individually, which is both the safe default and
 * the correct one for rugs, tables, lamps and the like.
 */
export function decideStrategy(input: {
  canonicalCategory: CanonicalCategory;
  targetCount: number;
  configuration: SofaConfiguration;
}): ReplacementStrategy {
  const isSeating =
    input.canonicalCategory === "sofa" || input.canonicalCategory === "armchair";

  if (
    isSeating &&
    input.targetCount > 1 &&
    isCombinedSeatingUnit(input.configuration)
  ) {
    return "replace-group-with-single";
  }
  return "replace-each";
}

/** Build one group per category from the selected targets and chosen products. */
export function buildReplacementGroups(input: {
  targetsByCategory: Map<CanonicalCategory, ReplacementTarget[]>;
  /** One chosen product per canonical category. */
  productByCategory: Map<CanonicalCategory, Product>;
}): ReplacementGroup[] {
  const groups: ReplacementGroup[] = [];

  for (const [category, targets] of input.targetsByCategory) {
    const product = input.productByCategory.get(category);
    if (!product || targets.length === 0) continue;

    const configuration =
      category === "sofa" || category === "armchair"
        ? classifySofaConfiguration(product)
        : "unknown";
    const strategy = decideStrategy({
      canonicalCategory: category,
      targetCount: targets.length,
      configuration,
    });

    groups.push({
      canonicalCategory: category,
      targets,
      selectedProductId: product.id,
      selectedProductName: product.name,
      strategy,
      // A combined sectional is ONE physical unit however many seats it
      // replaces; everything else needs one unit per object.
      quantity: strategy === "replace-group-with-single" ? 1 : targets.length,
      configuration,
    });
  }

  return groups;
}

/**
 * The targets a group will actually act on.
 *
 * `replace-each` acts on every target. `replace-group-with-single` still
 * REMOVES every target — the old seats all go — but places the new unit only
 * once, at the largest of them, which is the best available proxy for the
 * combined seating zone.
 */
export function primaryTargetFor(group: ReplacementGroup): ReplacementTarget {
  if (group.strategy === "replace-each") return group.targets[0];

  const area = (target: ReplacementTarget) =>
    target.boundingBox.width * target.boundingBox.height;
  return [...group.targets].sort(
    (a, b) => area(b) - area(a) || a.targetId.localeCompare(b.targetId)
  )[0];
}

/** Targets that are cleared but receive no replacement of their own. */
export function absorbedTargetsFor(
  group: ReplacementGroup
): ReplacementTarget[] {
  if (group.strategy === "replace-each") return [];
  const primary = primaryTargetFor(group);
  return group.targets.filter((target) => target.targetId !== primary.targetId);
}

/** One line per group, for a confirmation screen. */
export function describeGroup(group: ReplacementGroup): string {
  if (group.strategy === "replace-group-with-single") {
    return `${group.selectedProductName} replaces all ${group.targets.length} seats as one combined unit`;
  }
  return group.quantity > 1
    ? `${group.selectedProductName} × ${group.quantity}`
    : group.selectedProductName;
}

/** A product plus how many physical units the room needs. */
export type PackageLine = {
  productId: string;
  quantity: number;
};

/**
 * Collapse groups into basket lines.
 *
 * The same product chosen for two positions is ONE line with quantity 2, never
 * two identical cards — and the quantity must survive, because a package that
 * silently assumes one unit under-charges for a room that needs two.
 */
export function toPackageLines(groups: ReplacementGroup[]): PackageLine[] {
  const byProduct = new Map<string, number>();
  for (const group of groups) {
    byProduct.set(
      group.selectedProductId,
      (byProduct.get(group.selectedProductId) || 0) + group.quantity
    );
  }
  return [...byProduct.entries()].map(([productId, quantity]) => ({
    productId,
    quantity,
  }));
}
