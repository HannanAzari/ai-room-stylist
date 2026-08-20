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
import { customerNoteSection } from "./customer-note";
import type { FewShotSku } from "./few-shot-references";

export type FewShotReplacement = {
  /** Visual description of what is being replaced, e.g. "the dark fabric sofa". */
  targetDescription: string;
  /** Human-readable position, e.g. "on the left". */
  location: string | null;
  productTitle: string;
  /** Canonical category of the object being replaced, e.g. "sofa". */
  category: string;
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
  /**
   * Items of the SAME kind as something being replaced, that are NOT being
   * replaced — e.g. the second sofa in a two-sofa room when only one was
   * selected. Called out separately because this is the case the model gets
   * wrong: told to replace "the sofa on the left" with a green sofa, it
   * harmonises the room and replaces both.
   */
  sameCategoryProtected?: Array<{ label: string; category: string }>;
  /** Optional customer instruction. Always rendered last, always subordinate. */
  customerNote?: string | null;
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

  /**
   * The count is stated explicitly. "Do not change the other sofa" is weaker
   * than "the room contains 2 sofas and exactly 1 of them changes" — the
   * second gives the model an arithmetic check on its own output.
   */
  const sameCategory = input.sameCategoryProtected ?? [];
  let sameCategoryClause = "";
  if (sameCategory.length > 0) {
    const byCategory = new Map<string, string[]>();
    for (const item of sameCategory) {
      byCategory.set(item.category, [...(byCategory.get(item.category) ?? []), item.label]);
    }
    const sentences: string[] = [];
    const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
    const plural = (word: string, count: number) => (count === 1 ? word : `${word}s`);

    for (const [category, labels] of byCategory) {
      const replacedHere = input.replacements.filter(
        (replacement) => replacement.category === category
      ).length;
      const survivors = labels.join(" and ");
      const it = labels.length === 1 ? "it" : "them";
      const stay = labels.length === 1 ? "it is" : "they are";
      const mustStay = `${capitalise(survivors)} must stay in the photograph exactly as ${stay}: do not replace ${it}, do not restyle ${it}, do not remove ${it}, and do not recolour ${it} to match the new furniture.`;

      if (replacedHere === 0) {
        // Nothing of this kind is being replaced, so a count would only invite
        // the model to wonder which one it missed.
        sentences.push(mustStay);
        continue;
      }

      const total = replacedHere + labels.length;
      sentences.push(
        `This room contains ${total} ${plural(category, total)}. Exactly ${replacedHere} of them ${replacedHere === 1 ? "is" : "are"} replaced — the ${replacedHere === 1 ? "one" : "ones"} named above. ${mustStay}`
      );
    }
    sameCategoryClause = `\n\n${sentences.join(" ")}`;
  }

  const note = customerNoteSection(
    input.customerNote ?? null,
    input.replacements.map((replacement) => replacement.productTitle)
  );

  return `The first image is a photograph of a real living room. The images after it show the exact retail products the customer selected, in this order: ${referenceList}.

${instructions}

Objects resting on or around the furniture being replaced stay where they are — cushions, throws, toys, books and anything else settle naturally onto or beside the replacement, and only move if the replacement makes their original position physically impossible.

Every other part of the photograph — ${preserved} — stays exactly as it is. Do not clear, tidy or restyle the room. Add nothing to the room.${sameCategoryClause}${note}`;
}
