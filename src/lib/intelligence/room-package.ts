/**
 * Surprise Me — the curated Koala room package (coherence engine).
 *
 * "Surprise me" does NOT mean the image model may invent furniture. It means
 * we choose a coordinated set of REAL catalogue products first, and generation
 * is then only ever allowed to use those. The package is decided before a
 * single pixel is generated, and it is the single source of truth for both the
 * render and the shopping list.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE CATALOGUE ACTUALLY SUPPORTS
 * ---------------------------------------------------------------------------
 * Measured, not assumed: all 55 products carry the style tag "modern luxury",
 * so style tags alone cannot discriminate between them. Only 15/55 carry
 * dimensions. The signals that DO carry information are:
 *
 *   - colour family      (20 distinct colours across the catalogue)
 *   - materials          (fabric / leather / wood / veneer / stone / metal)
 *   - secondary style tags ("contemporary", "warm neutral", "organic modern",
 *     "minimal" — these appear on 2-7 products each and genuinely separate them)
 *   - category coverage  (what a room of this type actually needs)
 *   - explicit complementary pairings from the product profile
 *
 * Scale compatibility is scored only where real dimensions exist and is
 * skipped, not guessed, where they do not.
 *
 * Fully deterministic: same inputs always produce the same package, ties broken
 * by product id. No vision call, no randomness, no network.
 */
import type { Product } from "@/lib/products";
import { getProductProfiles, type ProductProfile } from "./product-profile";
import { canonicaliseCategory, type CanonicalCategory } from "./scene-taxonomy";

/** One slot in a room's ideal composition. */
type PackageSlot = {
  /** Catalogue category that fills this slot. */
  category: string;
  /** A room without this is not a believable design. */
  required: boolean;
  /** Lower runs first; the anchor is slot 0 and sets the palette. */
  priority: number;
  /** Why this slot exists, shown to the customer. */
  role: string;
  /**
   * Preferred canonical sub-type where a catalogue category is too coarse.
   * "lighting" holds floor lamps, table lamps and chandeliers alike, and a
   * floor lamp is not an overhead light — this keeps the role honest.
   */
  preferCanonical?: CanonicalCategory[];
};

/**
 * What a coherent room of each type contains. Ordered by priority: the anchor
 * piece is chosen first and everything else is then coordinated against it.
 */
const ROOM_BLUEPRINTS: Record<string, PackageSlot[]> = {
  "living room": [
    { category: "sofas", required: true, priority: 0, role: "Main seating" },
    { category: "coffee-tables", required: true, priority: 1, role: "Centre table" },
    { category: "rugs", required: false, priority: 2, role: "Anchors the seating" },
    { category: "tv-units", required: false, priority: 3, role: "Media wall" },
    { category: "lighting", required: false, priority: 4, role: "Ambient light", preferCanonical: ["floor-lamp", "table-lamp"] },
    { category: "decor", required: false, priority: 5, role: "Wall interest" },
  ],
  "dining room": [
    { category: "dining-tables", required: true, priority: 0, role: "Dining table" },
    { category: "chairs", required: true, priority: 1, role: "Dining seating" },
    { category: "rugs", required: false, priority: 2, role: "Defines the zone" },
    { category: "lighting", required: false, priority: 3, role: "Overhead light", preferCanonical: ["ceiling-light"] },
    { category: "decor", required: false, priority: 4, role: "Wall interest" },
  ],
  bedroom: [
    { category: "beds", required: true, priority: 0, role: "Bed" },
    { category: "bed-sides", required: true, priority: 1, role: "Bedside" },
    { category: "rugs", required: false, priority: 2, role: "Softens the floor" },
    { category: "lighting", required: false, priority: 3, role: "Bedside light", preferCanonical: ["table-lamp"] },
    { category: "decor", required: false, priority: 4, role: "Wall interest" },
  ],
  office: [
    { category: "chairs", required: true, priority: 0, role: "Seating" },
    { category: "rugs", required: false, priority: 1, role: "Grounds the desk" },
    { category: "lighting", required: false, priority: 2, role: "Task light", preferCanonical: ["table-lamp", "floor-lamp"] },
    { category: "decor", required: false, priority: 3, role: "Wall interest" },
  ],
};

/** Target package size — enough to read as a designed room, not clutter. */
export const MIN_PACKAGE_SIZE = 4;
export const MAX_PACKAGE_SIZE = 6;

function blueprintFor(roomType: string): PackageSlot[] {
  const key = (roomType || "").toLowerCase().trim();
  return ROOM_BLUEPRINTS[key] ?? ROOM_BLUEPRINTS["living room"];
}

/** Neutrals coordinate with everything; treated as always-compatible. */
const NEUTRAL_FAMILIES = new Set([
  "cream / neutral",
  "white",
  "grey",
  "black / charcoal",
  "warm wood",
]);

function colourScore(a: ProductProfile, b: ProductProfile): number {
  const fa = a.identity.colourFamily;
  const fb = b.identity.colourFamily;
  if (!fa || !fb) return 0;
  if (fa === fb) return 3;
  // A neutral sits happily beside anything.
  if (NEUTRAL_FAMILIES.has(fa) || NEUTRAL_FAMILIES.has(fb)) return 2;
  // Two different saturated families is where rooms start to clash.
  return -2;
}

function materialScore(a: ProductProfile, b: ProductProfile): number {
  const setA = new Set(a.materials.map((m) => m.toLowerCase()));
  const shared = b.materials.filter((m) => setA.has(m.toLowerCase())).length;
  if (shared > 0) return 2;
  // Wood + fabric, stone + metal etc. are normal pairings, not clashes.
  return 0;
}

/**
 * Secondary style tags are the only genuinely discriminating style signal in
 * this catalogue, since every product also carries "modern luxury".
 */
function styleScore(a: Product, b: Product): number {
  const generic = new Set(["modern luxury"]);
  const tagsA = new Set(
    (a.styleTags || []).map((t) => t.toLowerCase()).filter((t) => !generic.has(t))
  );
  const shared = (b.styleTags || [])
    .map((t) => t.toLowerCase())
    .filter((t) => !generic.has(t) && tagsA.has(t)).length;
  return shared * 3;
}

/** Explicit pairing intelligence already derived per product. */
function complementScore(a: ProductProfile, b: ProductProfile): number {
  const forward = a.matchingProducts.includes(b.id) ? 2 : 0;
  const backward = b.matchingProducts.includes(a.id) ? 2 : 0;
  return forward + backward;
}

/** Only scored where BOTH products carry real dimensions. */
function scaleScore(a: Product, b: Product): number {
  if (!a.widthCm || !b.widthCm) return 0;
  // A coffee table wider than its sofa, or a rug narrower than the seating,
  // reads wrong. Reward sensible relative proportions.
  const ratio = a.widthCm / b.widthCm;
  if (ratio > 0.25 && ratio < 4) return 1;
  return -1;
}

function roomScore(profile: ProductProfile, roomType: string): number {
  const key = (roomType || "").toLowerCase();
  return profile.roomTypes.some((r) => r.toLowerCase() === key) ? 2 : 0;
}

/** Neutral role label used when the preferred sub-type isn't stocked. */
function genericRoleFor(category: string): string {
  const labels: Record<string, string> = {
    lighting: "Lighting",
    decor: "Wall interest",
    rugs: "Rug",
    chairs: "Seating",
  };
  return labels[category] ?? "Feature piece";
}

export type PackageItem = {
  productId: string;
  productName: string;
  category: string;
  /** Why this slot exists, e.g. "Main seating". */
  role: string;
  /** True for the piece the rest of the room was coordinated around. */
  isAnchor: boolean;
  /** Coherence score against the already-chosen set. Anchor scores 0. */
  coherenceScore: number;
};

export type RoomPackage = {
  roomType: string;
  styleLabel: string;
  items: PackageItem[];
  /** Short, honest explanation of the palette the package was built around. */
  rationale: string;
};

/**
 * Choose a coordinated Koala package for a room.
 *
 * Anchor-first: the highest-priority required category is chosen, then every
 * later slot is scored against everything already picked, so the package
 * converges on one palette rather than six unrelated products.
 */
export function selectRoomPackage(input: {
  roomType: string;
  style: string;
  catalogue: Product[];
  /** Bias the anchor toward a specific product (e.g. one the customer liked). */
  preferProductIds?: string[];
  maxItems?: number;
}): RoomPackage {
  const maxItems = Math.min(input.maxItems ?? MAX_PACKAGE_SIZE, MAX_PACKAGE_SIZE);
  const blueprint = [...blueprintFor(input.roomType)].sort(
    (a, b) => a.priority - b.priority
  );
  const profiles = getProductProfiles(input.catalogue);
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const productById = new Map(input.catalogue.map((p) => [p.id, p]));
  const preferred = new Set(input.preferProductIds ?? []);

  const chosen: PackageItem[] = [];
  const chosenProfiles: ProductProfile[] = [];
  const usedCategories = new Set<string>();

  for (const slot of blueprint) {
    if (chosen.length >= maxItems) break;

    const candidates = input.catalogue.filter(
      (product) =>
        product.category === slot.category &&
        !usedCategories.has(product.category) &&
        profileById.has(product.id)
    );
    if (candidates.length === 0) continue;

    const scored = candidates
      .map((product) => {
        const profile = profileById.get(product.id) as ProductProfile;
        let score = roomScore(profile, input.roomType);

        // A product the customer already showed interest in anchors the room.
        if (preferred.has(product.id)) score += 10;

        // Honour the slot's sub-type where the catalogue category is coarse,
        // so an "overhead light" is a pendant and not a floor lamp.
        if (slot.preferCanonical?.length) {
          const canonical = canonicaliseCategory(product.name).canonical;
          score += slot.preferCanonical.includes(canonical) ? 6 : -4;
        }

        // The anchor has nothing to coordinate against yet, so without this it
        // would be an arbitrary (if deterministic) pick. A neutral anchor
        // coordinates with far more of the catalogue and is what a designer
        // would actually choose; bold colour belongs on the smaller pieces.
        if (chosenProfiles.length === 0) {
          score += NEUTRAL_FAMILIES.has(profile.identity.colourFamily) ? 4 : 0;
        }

        for (const other of chosenProfiles) {
          const otherProduct = productById.get(other.id) as Product;
          score += colourScore(profile, other);
          score += materialScore(profile, other);
          score += styleScore(product, otherProduct);
          score += complementScore(profile, other);
          score += scaleScore(product, otherProduct);
        }

        return { product, profile, score };
      })
      // Deterministic: highest score, then stable by id.
      .sort((a, b) => b.score - a.score || a.product.id.localeCompare(b.product.id));

    const winner = scored[0];
    // Optional slots are skipped rather than filled with something that fights
    // the palette — an incoherent extra is worse than one fewer product.
    if (!slot.required && winner.score < 0) continue;

    // Keep the role label truthful. If the catalogue has no product of the
    // preferred sub-type (there are no table lamps, for instance), calling a
    // floor lamp a "Bedside light" would be a small lie in the UI.
    const matchesPreferred =
      !slot.preferCanonical?.length ||
      slot.preferCanonical.includes(
        canonicaliseCategory(winner.product.name).canonical
      );

    chosen.push({
      productId: winner.product.id,
      productName: winner.product.name,
      category: winner.product.category,
      role: matchesPreferred ? slot.role : genericRoleFor(slot.category),
      isAnchor: chosen.length === 0,
      coherenceScore: chosen.length === 0 ? 0 : winner.score,
    });
    chosenProfiles.push(winner.profile);
    usedCategories.add(slot.category);
  }

  const anchorProfile = chosenProfiles[0];
  const rationale = anchorProfile
    ? `Built around the ${anchorProfile.title} in ${anchorProfile.identity.colourFamily}, with pieces chosen to share its palette and materials.`
    : "No suitable Koala products were available for this room type.";

  return {
    roomType: input.roomType,
    styleLabel: input.style,
    items: chosen,
    rationale,
  };
}

/** Product ids in the package — the ONLY products generation may use. */
export function packageProductIds(roomPackage: RoomPackage): string[] {
  return roomPackage.items.map((item) => item.productId);
}

/**
 * Validate a package against the catalogue.
 *
 * Returns violations; empty means valid. Used by tests and as a runtime guard
 * so a malformed package can never reach generation.
 */
export function checkPackageInvariants(
  roomPackage: RoomPackage,
  catalogue: Product[]
): string[] {
  const violations: string[] = [];
  const byId = new Map(catalogue.map((p) => [p.id, p]));

  for (const item of roomPackage.items) {
    const product = byId.get(item.productId);
    if (!product) {
      violations.push(`"${item.productId}" is not a catalogue product`);
      continue;
    }
    if (product.category !== item.category) {
      violations.push(
        `"${item.productId}" is a ${product.category}, listed as ${item.category}`
      );
    }
  }

  const ids = roomPackage.items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) {
    violations.push("the package contains a duplicate product");
  }

  const categories = roomPackage.items.map((i) => i.category);
  if (new Set(categories).size !== categories.length) {
    violations.push("the package contains a duplicate category");
  }

  if (roomPackage.items.length > MAX_PACKAGE_SIZE) {
    violations.push(
      `the package has ${roomPackage.items.length} items (max ${MAX_PACKAGE_SIZE})`
    );
  }

  // Every required slot for the room type must be filled, when the catalogue
  // can fill it at all.
  for (const slot of blueprintFor(roomPackage.roomType)) {
    if (!slot.required) continue;
    const catalogueHasCategory = catalogue.some(
      (p) => p.category === slot.category
    );
    if (catalogueHasCategory && !categories.includes(slot.category)) {
      violations.push(`required category "${slot.category}" is missing`);
    }
  }

  const anchors = roomPackage.items.filter((i) => i.isAnchor).length;
  if (roomPackage.items.length > 0 && anchors !== 1) {
    violations.push(`expected exactly one anchor, found ${anchors}`);
  }

  return violations;
}

/** Categories a room of this type should contain, for tests and copy. */
export function requiredCategoriesFor(roomType: string): string[] {
  return blueprintFor(roomType)
    .filter((slot) => slot.required)
    .map((slot) => slot.category);
}
