/**
 * The short few-shot replacement prompt.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SHORT
 * ---------------------------------------------------------------------------
 * The grounding path builds ~19KB of prompt for a three-product room (measured:
 * `data/bench/out/…-21-52-904Z-…prompt.txt` is 19,142 bytes). The experiments
 * that produced the best fidelity used roughly one twentieth of that: a naming
 * sentence, a per-object instruction, one signature sentence per SKU, and a
 * preservation clause.
 *
 * So this builder is not a trimmed version of the other one. It is the prompt
 * that was actually measured, and nothing else is added to it. In particular no
 * product-intelligence metadata is interpolated here — that is the thing being
 * tested against.
 */
import type { FewShotSku } from "./few-shot-references";

export type FewShotReplacement = {
  /** What is being replaced, as the customer's selection named it. */
  existingLabel: string;
  /** Human-readable position, e.g. "on the left". */
  location: string | null;
  productTitle: string;
  sku: FewShotSku;
};

/**
 * One line per reference image, used as the text part immediately before it so
 * the model is never guessing which image belongs to which product.
 */
export function referenceLabel(input: {
  productTitle: string;
  view: string;
  index: number;
  total: number;
}): string {
  return `Reference ${input.index} of ${input.total} for the ${input.productTitle} — ${input.view.replace(/-/g, " ")} view, complete product.`;
}

/** The room image's own introductory line. */
export const ROOM_REFERENCE_LABEL =
  "ROOM PHOTOGRAPH — the customer's real room. Keep this camera, framing, lighting and architecture exactly.";

export function buildFewShotPrompt(replacements: FewShotReplacement[]): string {
  const instructions = replacements
    .map((replacement, index) => {
      const where = replacement.location ? ` (${replacement.location})` : "";
      return `${index + 1}. Replace the ${replacement.existingLabel}${where} with the ${replacement.productTitle}. ${replacement.sku.signature}`;
    })
    .join("\n");

  return `The reference images show the exact retail products selected by the customer.

Replace only the selected furniture in the room with those exact products. Match each replacement to the position, footprint, viewing direction and perspective of the object it replaces.

Preserve the exact product design, proportions, materials and distinctive structural features. Keep every other part of the room and all unrelated objects unchanged.

${instructions}

Objects resting on or around the furniture being replaced stay in the room — cushions, throws, toys, books, cups and anything else settle naturally onto or beside the replacement. Only move an object if the replacement makes its original position physically impossible. Do not clear, tidy or restyle the room, and add nothing that is not already in the photograph.`;
}
