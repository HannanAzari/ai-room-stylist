/**
 * Few-shot reference selection.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS ALONGSIDE THE EXISTING SELECTOR
 * ---------------------------------------------------------------------------
 * `product-references.ts` infers a view type from the FILENAME, and the
 * enrichment data in `product-intelligence.json` mirrors those same filenames.
 * For this catalogue the filenames are wrong often enough to change what gets
 * sent: Kelly's `02-45-degree.webp` is recorded as a `45-degree` view but is
 * actually a cropped shot of one arm. Because `selectReferenceViews` ranks the
 * angled family as 45-degree → side → lifestyle, that crop is what production
 * currently transmits as Kelly's second reference — instead of `03-side.webp`,
 * which is the rear three-quarter that carries the depth information.
 *
 * These classifications were made by opening every image. They are deliberately
 * hard-coded for the three POC SKUs rather than inferred: a vision classifier
 * is a separate piece of work, and guessing is what produced the bug.
 *
 * Products with no entry here fall through — the caller decides whether to
 * refuse or defer to the grounding path.
 */
import { readFile } from "fs/promises";
import { detectImageMimeType } from "@/lib/product-image-references";

/** How a catalogue image actually looks, not what it is called. */
export type FewShotView =
  | "front"
  | "front-three-quarter"
  | "side"
  | "rear-three-quarter"
  | "elevation-front"
  | "elevation-side";

export type FewShotReference = {
  /** File name inside the product's image directory. */
  file: string;
  view: FewShotView;
  /** Why this image earned its place, for the debug packet. */
  role: "hero" | "depth";
};

export type FewShotSku = {
  productId: string;
  /** Public path of the product's image directory. */
  directory: string;
  references: FewShotReference[];
  /**
   * ONE short sentence naming the features that decide whether a person would
   * accept the render as this exact product. Not a metadata dump — everything
   * here was a demonstrated failure mode in the experiments.
   */
  signature: string;
};

/**
 * Maximum references transmitted per product.
 *
 * Two, always. The isolated-angle pilot showed one image cannot supply depth
 * (the model invents a generic chunky silhouette), and that a third image helps
 * only when it is another COMPLETE view — a cropped third reference pushed
 * proportions back toward the one-image failure mode by leaking its own
 * apparent scale.
 */
export const MAX_FEW_SHOT_REFERENCES = 2;

/**
 * Validated classifications for the POC SKUs.
 *
 * Each set is a hero plus the complete alternate view that exposes the depth
 * the hero cannot show. No macros, no fabric details, no cropped part-views, no
 * occluded lifestyle shots.
 */
export const FEW_SHOT_SKUS: Record<string, FewShotSku> = {
  "kelly-pearl-beige-fabric-3-seater-sofa-champagne-gold-legs": {
    productId: "kelly-pearl-beige-fabric-3-seater-sofa-champagne-gold-legs",
    directory: "/products/sofas/kelly-pearl-beige-fabric-3-seater-sofa-champagne-gold-legs",
    references: [
      { file: "main.jpg", view: "front", role: "hero" },
      // Named "side"; it is really a rear three-quarter, and it is the only
      // other complete view Kelly has.
      { file: "03-side.webp", view: "rear-three-quarter", role: "depth" },
    ],
    signature:
      "Kelly is cream boucle with all-over diamond button tufting across the back and the arms, curved rolled arms, one single long bench seat cushion, and low champagne-gold feet.",
  },
  "elva-green-pastel-nubuck-leather-3-seater-sofa": {
    productId: "elva-green-pastel-nubuck-leather-3-seater-sofa",
    directory: "/products/sofas/elva-green-pastel-nubuck-leather-3-seater-sofa",
    references: [
      { file: "main.jpg", view: "front", role: "hero" },
      // Genuinely the side view, and the only image showing the bolster-arm
      // section, the plinth height and the strap-and-buckle detail.
      { file: "01-side.webp", view: "side", role: "depth" },
    ],
    signature:
      "Elva is pastel green nubuck leather with thick vertical padded channel segments across the seat and back, rounded cylindrical bolster arms, loose square back cushions, and a solid plinth base with no visible legs.",
  },
  "aspen-white-sintered-stone-coffee-table-matte-black-legs": {
    productId: "aspen-white-sintered-stone-coffee-table-matte-black-legs",
    directory: "/products/coffee-tables/aspen-white-sintered-stone-coffee-table-matte-black-legs",
    references: [
      // Aspen's hero is a side elevation, not a front view — it is the image
      // that reads the looping base and the glass tier's separate height.
      { file: "main.jpg", view: "elevation-side", role: "hero" },
      { file: "03-front.webp", view: "elevation-front", role: "depth" },
    ],
    signature:
      "Aspen has an asymmetric white sintered-stone top with a separate clear glass tier that overlaps it at a different height, both carried on a sculptural matte-black looping ribbon base pierced by a large oval void.",
  },
};

export function getFewShotSku(productId: string): FewShotSku | null {
  return FEW_SHOT_SKUS[productId] ?? null;
}

/** True when every selected product has a validated classification. */
export function fewShotCoverage(productIds: string[]): {
  covered: string[];
  uncovered: string[];
} {
  const covered: string[] = [];
  const uncovered: string[] = [];
  for (const id of productIds) {
    (getFewShotSku(id) ? covered : uncovered).push(id);
  }
  return { covered, uncovered };
}

export type LoadedFewShotReference = {
  productId: string;
  productTitle: string;
  file: File;
  view: FewShotView;
  role: FewShotReference["role"];
  url: string;
  bytes: number;
};

export type FewShotReferenceLoad = {
  loaded: LoadedFewShotReference[];
  skipped: Array<{ productId: string; url: string; reason: string }>;
};

/**
 * Read the validated references off disk.
 *
 * The MIME type is sniffed from magic bytes rather than the extension — this
 * catalogue stores WebP files named `.jpg`, and a declared type that disagrees
 * with the bytes is silently dropped by the provider.
 */
export async function loadFewShotReferences(
  products: Array<{ id: string; name: string }>
): Promise<FewShotReferenceLoad> {
  const loaded: LoadedFewShotReference[] = [];
  const skipped: FewShotReferenceLoad["skipped"] = [];

  for (const product of products) {
    const sku = getFewShotSku(product.id);
    if (!sku) {
      skipped.push({
        productId: product.id,
        url: "",
        reason: "no validated few-shot classification for this product",
      });
      continue;
    }

    for (const reference of sku.references.slice(0, MAX_FEW_SHOT_REFERENCES)) {
      const url = `${sku.directory}/${reference.file}`;
      const path = `${process.cwd()}/public${url}`;

      let buffer: Buffer;
      try {
        buffer = await readFile(path);
      } catch {
        skipped.push({ productId: product.id, url, reason: "file not found on disk" });
        continue;
      }

      const mimeType = detectImageMimeType(buffer);
      if (!mimeType) {
        skipped.push({ productId: product.id, url, reason: "unrecognised image format" });
        continue;
      }

      loaded.push({
        productId: product.id,
        productTitle: product.name,
        file: new File([new Uint8Array(buffer)], reference.file, { type: mimeType }),
        view: reference.view,
        role: reference.role,
        url,
        bytes: buffer.length,
      });
    }
  }

  return { loaded, skipped };
}
