/**
 * The short few-shot replacement prompt — benchmark-style.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS SHAPED LIKE THIS
 * ---------------------------------------------------------------------------
 * The grounding path builds ~19KB for a three-product room (measured: 19,142
 * bytes). The renders that actually held product identity used roughly one
 * twentieth of that, and — this turned out to matter — sent it as ONE text part
 * followed by the images back to back.
 *
 * Three differences from the first version of this builder, each traced to a
 * literal diff against the benchmark request:
 *
 *  1. ONE text part. Per-image labels used to be interleaved between the
 *     images, so the request alternated text/image/text/image. The reference
 *     order is now stated in prose instead, exactly as the benchmark did it.
 *  2. Targets are DESCRIBED, not named. The prompt said "Replace the Sofa 1",
 *     a label from the picker that tells the model nothing about what to look
 *     for (and reads ungrammatically). It now says "the dark fabric sofa on the
 *     left", built from the contract's own description and location.
 *  3. Preservation is CONCRETE. "Keep every other part of the room unchanged"
 *     became an explicit list, because that is what the benchmark carried.
 *
 * No product-intelligence metadata is interpolated here; that is the thing this
 * strategy is being tested against.
 */
import type { FewShotSku } from "./few-shot-references";

export type FewShotReplacement = {
  /** Visual description of what is being replaced, e.g. "the dark fabric sofa". */
  targetDescription: string;
  /** Human-readable position, e.g. "on the left". */
  location: string | null;
  productTitle: string;
  sku: FewShotSku;
};

/** One reference image, in the order it is sent. */
export type FewShotReferenceNote = {
  productTitle: string;
  /** e.g. "front", "rear-three-quarter". */
  view: string;
};

/**
 * Baseline of things that must survive any room edit.
 *
 * Concrete rather than generic, and stated even when the contract carries no
 * protected items — a resolved contract from the category flow often does not,
 * and "every other part of the room" measurably under-constrains the model.
 */
export const BASELINE_PRESERVED = [
  "the walls",
  "the ceiling",
  "the floor and carpet",
  "the windows and curtains",
  "the rug",
  "the ceiling fan",
  "the television and TV unit",
] as const;

/** "the dark fabric sofa on the left", from description + location. */
export function describeTarget(replacement: {
  targetDescription: string;
  location: string | null;
}): string {
  const description = replacement.targetDescription.trim();
  const withArticle = /^(the|a|an) /i.test(description)
    ? description
    : `the ${description}`;
  return replacement.location ? `${withArticle} ${replacement.location}` : withArticle;
}

export function buildFewShotPrompt(input: {
  replacements: FewShotReplacement[];
  /** In transmission order, so the prose matches the payload exactly. */
  references: FewShotReferenceNote[];
  /** Everything in this room that must not change. */
  preserved: string[];
}): string {
  const referenceList = input.references
    .map((reference, index) => `${index + 1}. the ${reference.productTitle} — ${reference.view.replace(/-/g, " ")} view`)
    .join("; ");

  const instructions = input.replacements
    .map((replacement) => {
      const target = describeTarget(replacement);
      return `Replace ${target} with the ${replacement.productTitle}. It must stand in exactly the same place, at the same size and the same orientation, following the same perspective and the same daylight as the object it replaces. ${replacement.sku.signature} Do not restyle it.`;
    })
    .map((line, index, all) => (all.length > 1 ? `${index + 1}. ${line}` : line))
    .join("\n\n");

  const preserved = input.preserved.join(", ");

  return `The first image is a photograph of a real living room. The images after it show the exact retail products the customer selected, in this order: ${referenceList}.

${instructions}

Objects resting on or around the furniture being replaced stay where they are — cushions, throws, toys, books and anything else settle naturally onto or beside the replacement, and only move if the replacement makes their original position physically impossible.

Every other part of the photograph — ${preserved} — stays exactly as it is. Do not clear, tidy or restyle the room. Add nothing to the room.`;
}
