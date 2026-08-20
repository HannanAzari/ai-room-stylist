/**
 * The few-shot room edit, end to end.
 *
 * Kept out of the route because the route is already long, and because this
 * path shares almost nothing with the grounding one: no scene graph, no
 * replacement plan, no reference manifest, no prompt builder, no reviewer.
 * It takes the customer's explicit replacement contract at face value —
 * the contract already names every target, its location and its product — and
 * turns it straight into two references per product plus a short prompt.
 */
import {
  generateFewShotRoomEdit,
  ProviderBusyError,
} from "./image-providers/gemini-few-shot";
import {
  BASELINE_PRESERVED,
  buildFewShotPrompt,
  describeTarget,
  type FewShotReferenceNote,
  type FewShotReplacement,
} from "@/lib/intelligence/few-shot-prompt";
import {
  fewShotCoverage,
  getFewShotSku,
  loadFewShotReferences,
  MAX_FEW_SHOT_REFERENCES,
} from "@/lib/intelligence/few-shot-references";
import { createTimings, unattributedMs } from "@/lib/generation-timings";
import type { ReplacementContract } from "@/lib/intelligence/replacement-assignment";
import type { Product } from "@/lib/products";

export { ProviderBusyError };

/**
 * "Sofa 2" is the picker's label. Say what the thing is instead, so the prompt
 * reads as a description of the room rather than of the UI.
 */
function readableProtectedLabel(label: string, category?: string): string {
  const trimmed = label?.trim() ?? "";
  if (!trimmed) return category ? `the other ${category}` : "the other item";
  if (/^[A-Za-z ]+\s\d+$/.test(trimmed)) {
    return `the other ${trimmed.replace(/\s*\d+$/, "").trim().toLowerCase()}`;
  }
  return /^(the|a|an) /i.test(trimmed) ? trimmed : `the ${trimmed.toLowerCase()}`;
}

export type FewShotEligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

/**
 * Whether this request can take the few-shot path.
 *
 * Every condition here is a real limitation of the POC rather than a policy
 * choice, and failing any of them falls back to the grounding path rather than
 * erroring — the flag must never be able to break a request that would
 * otherwise have worked.
 */
export function checkFewShotEligibility(input: {
  contract: ReplacementContract | null;
  surpriseMe: boolean;
  productIds: string[];
}): FewShotEligibility {
  if (input.surpriseMe) {
    return { eligible: false, reason: "surprise-me composes a room rather than swapping named items" };
  }
  if (!input.contract || input.contract.assignments.length === 0) {
    return { eligible: false, reason: "no explicit replacement contract" };
  }
  if (input.contract.additions?.length || input.contract.removals?.length) {
    return { eligible: false, reason: "contract contains additions or removals, which this path does not model" };
  }
  const { uncovered } = fewShotCoverage(input.productIds);
  if (uncovered.length > 0) {
    return {
      eligible: false,
      reason: `no validated catalogue classification for: ${uncovered.join(", ")}`,
    };
  }
  return { eligible: true };
}

export type FewShotResult = {
  imageBase64: string;
  mimeType: string;
  provider: string;
  label: string;
  products: Product[];
  debug: {
    strategy: "few-shot";
    model: string;
    aspectRatio: string;
    prompt: string;
    promptBytes: number;
    referencesSent: number;
    imagesSent: number;
    textParts: number;
    roomNormalisedTo: string;
    roomBytes: number;
    targets: string[];
    preserved: string[];
    sameCategoryProtected: string[];
    customerNote: string | null;
    references: Array<{ productId: string; url: string; view: string; role: string; bytes: number }>;
    skipped: Array<{ productId: string; url: string; reason: string }>;
    timings: ReturnType<ReturnType<typeof createTimings>["snapshot"]> & { unattributedMs: number };
  };
};

export async function runFewShotRoomEdit(input: {
  roomImage: File;
  contract: ReplacementContract;
  products: Product[];
  apiKey: string;
  /** Optional free-text guidance. Never overrides product identity. */
  customerNote?: string | null;
}): Promise<FewShotResult> {
  const timings = createTimings();

  const { loaded, skipped } = await timings.measure("reference-prepare", () =>
    loadFewShotReferences(input.products.map((product) => ({ id: product.id, name: product.name })))
  );

  // A product whose references all failed to load cannot be rendered as itself,
  // and silently sending fewer is exactly the failure mode this path exists to
  // remove. Refuse instead, so the caller falls back rather than paying for a
  // render that cannot succeed.
  for (const product of input.products) {
    const count = loaded.filter((reference) => reference.productId === product.id).length;
    if (count === 0) {
      throw new Error(`No few-shot reference images loaded for ${product.id}.`);
    }
  }

  /**
   * What is being replaced, DESCRIBED rather than named.
   *
   * `displayName` is the picker's label ("Sofa 1") and tells the model nothing
   * about what to look for. `originalObjectDescription` is the scene graph's
   * own "dark fabric sofa", which is what the benchmark prompt used, so it is
   * preferred and the UI label is only a last resort.
   */
  const replacements: FewShotReplacement[] = [];
  for (const assignment of input.contract.assignments) {
    const sku = getFewShotSku(assignment.productId);
    // Eligibility already guaranteed this, but the type does not know that.
    if (!sku) continue;
    const target = assignment.target;
    replacements.push({
      targetDescription:
        target.originalObjectDescription?.trim() ||
        target.instanceLabel?.trim() ||
        target.displayName,
      location: target.location || null,
      productTitle: assignment.productTitle,
      category: assignment.canonicalCategory,
      sku,
    });
  }

  // References in transmission order, so the prompt's prose and the payload
  // cannot disagree about which image is which.
  const orderedReferences = input.products.flatMap((product) =>
    loaded
      .filter((reference) => reference.productId === product.id)
      .slice(0, MAX_FEW_SHOT_REFERENCES)
  );
  const referenceNotes: FewShotReferenceNote[] = orderedReferences.map((reference) => ({
    productTitle: reference.productTitle,
    view: reference.view,
  }));

  /**
   * Concrete preservation list.
   *
   * The baseline architecture always applies. Anything the contract explicitly
   * protected — the detected objects the customer did NOT assign a product to —
   * is added by name, so "the other sofa" and "the coffee table" are stated
   * rather than left to "every other part of the room".
   */
  const preserved: string[] = [...BASELINE_PRESERVED];
  for (const item of input.contract.protectedItems ?? []) {
    const label = item.label?.trim();
    if (!label) continue;
    const readable = readableProtectedLabel(label, item.canonicalCategory);
    if (!preserved.some((entry) => entry.toLowerCase() === readable.toLowerCase())) {
      preserved.push(readable);
    }
  }

  /**
   * Protected items of the SAME kind as something being replaced.
   *
   * This is the "I selected one sofa and it replaced both" case: told to swap
   * the left sofa for a green one, the model harmonises the room. Naming the
   * survivors and stating the arithmetic is what stops it.
   */
  const replacedCategories = new Set(replacements.map((replacement) => replacement.category));
  const sameCategoryProtected = (input.contract.protectedItems ?? [])
    .filter((item) => item.canonicalCategory && replacedCategories.has(item.canonicalCategory))
    .map((item) => ({
      label: readableProtectedLabel(item.label, item.canonicalCategory),
      category: String(item.canonicalCategory),
    }));

  const prompt = buildFewShotPrompt({
    replacements,
    references: referenceNotes,
    preserved,
    sameCategoryProtected,
    customerNote: input.customerNote ?? null,
  });

  const generated = await generateFewShotRoomEdit({
    prompt,
    roomImage: input.roomImage,
    references: orderedReferences.map((reference) => reference.file),
    apiKey: input.apiKey,
    timings,
  });

  const snapshot = timings.snapshot();

  return {
    imageBase64: generated.imageBase64,
    mimeType: generated.mimeType,
    provider: generated.provider,
    label: generated.label,
    products: input.products,
    debug: {
      strategy: "few-shot",
      model: process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3-pro-image",
      aspectRatio: generated.aspectRatio,
      prompt,
      promptBytes: Buffer.byteLength(prompt, "utf8"),
      referencesSent: orderedReferences.length,
      // References plus the room photo — what actually went over the wire.
      imagesSent: orderedReferences.length + 1,
      // Exactly one text part, then the images. Recorded so a regression back
      // to interleaved labels is visible in the response, not just in a test.
      textParts: 1,
      roomNormalisedTo: `${generated.roomWidth}x${generated.roomHeight}`,
      roomBytes: generated.roomBytes,
      targets: replacements.map((replacement) => describeTarget(replacement)),
      preserved,
      sameCategoryProtected: sameCategoryProtected.map((item) => item.label),
      customerNote: input.customerNote ?? null,
      references: loaded.map((reference) => ({
        productId: reference.productId,
        url: reference.url,
        view: reference.view,
        role: reference.role,
        bytes: reference.bytes,
      })),
      skipped,
      timings: { ...snapshot, unattributedMs: unattributedMs(snapshot) },
    },
  };
}
