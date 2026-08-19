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
import type { LabelledProductImage } from "./image-providers/types";
import {
  buildFewShotPrompt,
  referenceLabel,
  ROOM_REFERENCE_LABEL,
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

  const replacements: FewShotReplacement[] = [];
  for (const assignment of input.contract.assignments) {
    const sku = getFewShotSku(assignment.productId);
    // Eligibility already guaranteed this, but the type does not know that.
    if (!sku) continue;
    replacements.push({
      existingLabel: assignment.target.displayName || assignment.target.instanceLabel,
      location: assignment.target.location || null,
      productTitle: assignment.productTitle,
      sku,
    });
  }

  const prompt = buildFewShotPrompt(replacements);

  // Group references per product so the labels read "1 of 2", "2 of 2" rather
  // than counting across the whole request.
  const references: LabelledProductImage[] = [];
  for (const product of input.products) {
    const forProduct = loaded
      .filter((reference) => reference.productId === product.id)
      .slice(0, MAX_FEW_SHOT_REFERENCES);
    forProduct.forEach((reference, index) => {
      references.push({
        label: referenceLabel({
          productTitle: reference.productTitle,
          view: reference.view,
          index: index + 1,
          total: forProduct.length,
        }),
        file: reference.file,
      });
    });
  }

  const generated = await generateFewShotRoomEdit({
    prompt,
    roomImage: input.roomImage,
    roomLabel: ROOM_REFERENCE_LABEL,
    references,
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
      referencesSent: references.length,
      // References plus the room photo — what actually went over the wire.
      imagesSent: references.length + 1,
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
