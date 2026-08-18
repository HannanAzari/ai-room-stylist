/**
 * Structured product grounding for the renderer.
 *
 * ---------------------------------------------------------------------------
 * WHY
 * ---------------------------------------------------------------------------
 * Live test: both sofas now change and the room is preserved, but the rendered
 * furniture is "in the spirit of" the chosen Koala product rather than being
 * that product. The prompt already carried an IDENTITY line per task, but three
 * things it never said turn out to matter:
 *
 *  1. WHICH SLOT a product belongs to. "2 x 3-seater" produces two tasks, and
 *     the customer may have chosen two DIFFERENT sofas for them. Nothing in the
 *     prompt bound "the sofa you picked first" to "the left sofa".
 *
 *  2. WHETHER TWO SLOTS MUST DIFFER. When the same product filled both slots
 *     the prompt said so (formatDuplicateProductTasks). When two DIFFERENT
 *     products were chosen it said nothing at all — so a renderer that drew two
 *     identical sofas satisfied every instruction it was given. That is a
 *     silent fidelity bug, and the mirror image of the one fixed last sprint.
 *
 *  3. THAT THE PRODUCT IS THE OUTCOME, not a mood reference. Nothing ruled out
 *     "inspired by".
 *
 * This module builds ONE deterministic record per replacement task carrying
 * every grounding field available, and renders it as a stable, machine-like
 * block. Deterministic on purpose: same plan in, byte-identical block out, so
 * a fidelity regression is diffable rather than a matter of opinion.
 *
 * It invents nothing. Every field is read from the ProductProfile/identity the
 * catalogue already supports, and absent fields are omitted rather than filled
 * with plausible text.
 */
import type { ProductIdentity } from "./product-profile";
import type { ReplacementPlan } from "./replacement-planner";
import { canonicalCategoryLabel } from "./scene-taxonomy";
import { getEnrichedProduct } from "./product-intelligence";

/** One product, bound to one physical slot in the finished room. */
export type ProductGroundingPacket = {
  taskId: number;
  productId: string;
  productName: string;
  /** Catalogue category slug, e.g. "sofas". */
  categorySlug: string;
  /** Human-readable category, e.g. "sofa". */
  categoryLabel: string;
  /**
   * 1-based position among the tasks of this category, and the total. Two
   * 3-seaters give slot 1 of 2 and slot 2 of 2 — the binding that lets the
   * prompt say which chosen product goes where.
   */
  slotIndex: number;
  slotCount: number;
  /** Which physical object this replaces, e.g. "the left 3 seater sofa". */
  targetInstanceLabel: string;
  /** Where it sits, e.g. "lower left of the room". */
  targetLocation: string;
  /** Its role in the finished room — the placement instruction. */
  placementRole: string;
  /** Seat configuration where the category has one, e.g. "3-seater modular". */
  configuration: string;
  colour: string;
  material: string;
  shape: string;
  silhouette: string;
  legsBase: string;
  notableTraits: string[];
  /**
   * Enrichment-only fields. Empty when the product has no enriched record, and
   * omitted from the rendered block in that case rather than printed blank —
   * a field with nothing after the colon reads as missing data to a renderer.
   */
  armStyle: string;
  backStyle: string;
  texture: string;
  visualWeight: string;
  /** Official catalogue subcategory, e.g. "2 Seater Sofa". */
  subcategory: string;
  /**
   * How this slot relates to the other slots of the same category:
   *   - "only": the single piece of its category
   *   - "same-as": must be visually identical to the other slots
   *   - "different-from": must be visibly a DIFFERENT model
   */
  pairing: "only" | "same-as" | "different-from";
  /** Task ids this packet must match, or differ from. */
  pairedTaskIds: number[];
};

function cleanList(values: (string | undefined | null)[]): string[] {
  return values
    .map((value) => (value ?? "").trim())
    .filter((value) => value.length > 0);
}

/**
 * Build one packet per replacement task, in task order.
 *
 * Slot numbering is per CANONICAL CATEGORY, matching how the customer chose:
 * the seating configurator asks for "2 x 3-seater sofa" and the shelves are
 * "1 of 2" / "2 of 2", so the prompt uses the same numbers the customer saw.
 */
export function buildProductGroundingPackets(
  plan: ReplacementPlan
): ProductGroundingPacket[] {
  const byCategory = new Map<string, typeof plan.replacements>();
  for (const task of plan.replacements) {
    const key = task.existingCanonicalCategory;
    const existing = byCategory.get(key);
    if (existing) existing.push(task);
    else byCategory.set(key, [task]);
  }

  const packets: ProductGroundingPacket[] = [];

  for (const [, tasks] of byCategory) {
    // Stable ordering: task id is assigned deterministically by the planner.
    const ordered = [...tasks].sort((a, b) => a.taskId - b.taskId);

    ordered.forEach((task, index) => {
      const siblings = ordered.filter((other) => other.taskId !== task.taskId);
      const sameProductSiblings = siblings.filter(
        (other) => other.productId === task.productId
      );
      const differentProductSiblings = siblings.filter(
        (other) => other.productId !== task.productId
      );

      /**
       * Pairing is decided by what the customer actually chose, not by how
       * many slots exist. Both cases must be stated: "identical" prevents two
       * mismatched sofas, and "different" prevents two identical ones. Only the
       * first of those was ever said out loud.
       */
      let pairing: ProductGroundingPacket["pairing"] = "only";
      let pairedTaskIds: number[] = [];
      if (differentProductSiblings.length > 0) {
        pairing = "different-from";
        pairedTaskIds = differentProductSiblings.map((other) => other.taskId);
      } else if (sameProductSiblings.length > 0) {
        pairing = "same-as";
        pairedTaskIds = sameProductSiblings.map((other) => other.taskId);
      }

      const identity: ProductIdentity = task.identity;
      const enriched = getEnrichedProduct(task.productId);

      packets.push({
        taskId: task.taskId,
        productId: task.productId,
        productName: task.productTitle,
        categorySlug: task.productCategorySlug,
        categoryLabel:
          task.productCategory ||
          canonicalCategoryLabel(task.existingCanonicalCategory),
        slotIndex: index + 1,
        slotCount: ordered.length,
        targetInstanceLabel: task.existingInstanceLabel,
        targetLocation: task.location,
        placementRole: task.placement,
        configuration: identity.configuration ?? "",
        colour: identity.colourFamily ?? "",
        material: identity.material ?? "",
        shape: identity.shape ?? "",
        silhouette: identity.silhouette ?? "",
        legsBase: identity.legsBase ?? "",
        notableTraits: identity.notableTraits ?? [],
        armStyle: enriched?.visual.armStyle ?? "",
        backStyle: enriched?.visual.backStyle ?? "",
        texture: enriched?.visual.texture ?? "",
        visualWeight: enriched?.visual.visualWeight ?? "",
        subcategory: enriched?.official.subcategory ?? "",
        pairing,
        pairedTaskIds,
      });
    });
  }

  return packets.sort((a, b) => a.taskId - b.taskId);
}

/** One `KEY: value` line, omitted entirely when the value is empty. */
function field(key: string, value: string): string | null {
  const clean = value.trim();
  return clean ? `  ${key}: ${clean}` : null;
}

/**
 * Render the packets as a deterministic block.
 *
 * Deliberately machine-shaped rather than prose: the renderer follows an
 * explicit field list far more reliably than a sentence, and a stable shape
 * means a fidelity regression shows up as a diff.
 */
export function formatProductGroundingSection(
  packets: ProductGroundingPacket[]
): string {
  if (packets.length === 0) return "";

  const blocks = packets.map((packet) => {
    const slot =
      packet.slotCount > 1
        ? `${packet.categoryLabel} ${packet.slotIndex} of ${packet.slotCount}`
        : packet.categoryLabel;

    const pairingLine =
      packet.pairing === "different-from"
        ? `  MUST DIFFER FROM: task ${packet.pairedTaskIds.join(", ")} — the customer chose a DIFFERENT model for that slot. These must be visibly different pieces of furniture, not two of the same.`
        : packet.pairing === "same-as"
          ? `  MUST MATCH: task ${packet.pairedTaskIds.join(", ")} — the customer chose the SAME model for both slots. These must be identical pieces, a matching pair.`
          : null;

    return cleanList([
      `PRODUCT FOR TASK ${packet.taskId} — ${slot}`,
      field("product id", packet.productId),
      field("product name", packet.productName),
      field("category", packet.categoryLabel),
      field("configuration", packet.configuration),
      field("catalogue type", packet.subcategory),
      field("colour", packet.colour),
      field("material / texture", packet.material),
      field("shape", packet.shape),
      field("silhouette", packet.silhouette),
      field("visual weight", packet.visualWeight),
      field("arms", packet.armStyle),
      field("back", packet.backStyle),
      field("base / legs", packet.legsBase),
      packet.notableTraits.length > 0
        ? `  identifying details: ${packet.notableTraits.join("; ")}`
        : "",
      field("replaces", packet.targetInstanceLabel),
      field("position in room", packet.targetLocation),
      field("placement role", packet.placementRole),
      pairingLine ?? "",
    ]).join("\n");
  });

  return [
    "SELECTED PRODUCTS — THE REQUIRED OUTCOME",
    "These are the actual products the customer chose and is being quoted for.",
    "Each block below is bound to one numbered task and to one physical piece of",
    "furniture in the finished room. Reproduce the product in the reference image",
    "labelled for that task: same silhouette, proportions, colour, material and",
    "base treatment.",
    "",
    "These are NOT mood boards, style hints or loose inspiration. A piece that is",
    "merely 'in the same style' is a failed render. If a field below conflicts",
    "with what you would otherwise draw, the field wins.",
    "",
    // Blank line between blocks: each is a self-contained record, and runs of
    // adjacent `key: value` lines read as one block otherwise.
    blocks.join("\n\n"),
  ].join("\n");
}

/**
 * The one-line summary of how many of each category the finished room must
 * hold, and whether they are the same model. Stated as a fact about the
 * finished room, which is the form the reviewer's instance-count check
 * measures — so the prompt and the gate ask the same question.
 */
export function formatSlotSummary(packets: ProductGroundingPacket[]): string[] {
  const byCategory = new Map<string, ProductGroundingPacket[]>();
  for (const packet of packets) {
    const existing = byCategory.get(packet.categoryLabel);
    if (existing) existing.push(packet);
    else byCategory.set(packet.categoryLabel, [packet]);
  }

  const lines: string[] = [];
  for (const [categoryLabel, group] of byCategory) {
    if (group.length < 2) continue;
    const distinctProducts = new Set(group.map((packet) => packet.productId));
    lines.push(
      distinctProducts.size === 1
        ? `The finished room must contain exactly ${group.length} ${categoryLabel}s, and they must be the SAME model (${group[0].productName}) — a matching pair.`
        : `The finished room must contain exactly ${group.length} ${categoryLabel}s, and they must be ${distinctProducts.size} DIFFERENT models: ${group
            .map((packet) => `${packet.productName} (task ${packet.taskId})`)
            .join(", ")}. Do not draw the same ${categoryLabel} twice.`
    );
  }
  return lines;
}
