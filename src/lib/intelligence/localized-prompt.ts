/**
 * The localized edit prompt: one product, one region, nothing else.
 *
 * This is deliberately shorter than the full-room few-shot prompt, because the
 * localized architecture has already removed most of what that prompt was
 * arguing for. There is no need to list what must be preserved, or to state how
 * many sofas the room contains and which one changes — the request only shows
 * the model one target, and the compositor restores everything else from the
 * original photograph regardless of what comes back.
 *
 * What remains is the part a prompt is genuinely good at: naming the product,
 * naming what it replaces, and holding the camera still.
 */
import type { FewShotSku } from "./few-shot-references";

export type LocalizedPromptInput = {
  productTitle: string;
  /** Visual description of the object being replaced, e.g. "dark fabric sofa". */
  targetDescription: string;
  /** Human-readable position, e.g. "on the left". Optional. */
  location: string | null;
  /** The validated per-SKU signature sentence. */
  sku: FewShotSku;
  /** Reference views in transmission order, so the prose matches the payload. */
  referenceViews: string[];
};

export function buildLocalizedPrompt(input: LocalizedPromptInput): string {
  const views = input.referenceViews.map((view) => view.replace(/-/g, " ")).join(" and ");
  const description = input.targetDescription.trim();
  const target = /^(the|a|an) /i.test(description) ? description : `the ${description}`;
  const where = input.location ? ` ${input.location}` : "";

  return `The ${input.referenceViews.length === 1 ? "reference image shows" : "two reference images show"} the exact ${input.productTitle}, from the ${views}.

This photograph is one region of a real room. Replace only ${target}${where} in it with this exact product. Match the position, scale, viewing direction, room perspective and daylight of the object it replaces.

${input.sku.signature} Do not redesign the product.

Preserve the surrounding architecture, floor and furnishings exactly as photographed.`;
}
