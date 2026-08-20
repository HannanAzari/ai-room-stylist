/**
 * The localized multi-edit strategy, end to end.
 *
 * ---------------------------------------------------------------------------
 * THE IDEA
 * ---------------------------------------------------------------------------
 * One Gemini request per selected target, each seeing only its own crop of the
 * room and its own product's references, all fired from the SAME untouched
 * photograph and composited back through disjoint masks.
 *
 * Two properties fall out of that structure rather than out of a prompt:
 *
 *  - A product cannot borrow another product's features, because the other
 *    product's references are not in the request.
 *  - Untouched furniture cannot be deleted, because its pixels are restored
 *    from the original regardless of what the model returns.
 *
 * Both were previously asked for in prose and granted inconsistently.
 */
import {
  buildLocalizedMask,
  compositeLocalizedEdits,
  extractCrop,
  maskStats,
  type LocalizedEditLayer,
} from "./image-providers/localized-compositor";
import { generateLocalizedEdit } from "./image-providers/gemini-localized";
import { normaliseRoomForEdit, ProviderBusyError } from "./image-providers/gemini-few-shot";
import { buildLocalizedPrompt } from "@/lib/intelligence/localized-prompt";
import {
  assessTargetGeometry,
  deriveCrop,
  deriveMaskRect,
  deriveProtectedRects,
  findMaskOverlaps,
  type PixelRect,
} from "@/lib/intelligence/localized-geometry";
import {
  getFewShotSku,
  loadFewShotReferences,
  MAX_FEW_SHOT_REFERENCES,
} from "@/lib/intelligence/few-shot-references";
import { createTimings, unattributedMs } from "@/lib/generation-timings";
import type { BoundingBox } from "@/lib/intelligence/scene-graph";
import type { ReplacementContract } from "@/lib/intelligence/replacement-assignment";
import type { Product } from "@/lib/products";

export { ProviderBusyError };

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name]?.trim() || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Cap on simultaneous edits. Each one is a paid call and a latency risk. */
export function maxLocalizedTargets(): number {
  return Math.min(envInt("LOCALIZED_MAX_TARGETS", 3), 6);
}

export type LocalizedEligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

/**
 * Whether this request can take the localized path.
 *
 * Every condition is a real limitation, and failing any of them falls back to
 * the configured strategy rather than erroring — a feature flag must never be
 * able to break a request that would otherwise have worked.
 *
 * Geometry is checked here, before any paid call, because a target whose box we
 * cannot turn into a legal crop is exactly the case that would otherwise
 * produce a distorted or half-cropped product.
 */
export function checkLocalizedEligibility(input: {
  contract: ReplacementContract | null;
  surpriseMe: boolean;
  productIds: string[];
  roomWidth: number;
  roomHeight: number;
}): LocalizedEligibility {
  if (input.surpriseMe) {
    return { eligible: false, reason: "surprise-me composes a room rather than swapping named items" };
  }
  if (!input.contract || input.contract.assignments.length === 0) {
    return { eligible: false, reason: "no explicit replacement contract" };
  }
  if (input.contract.additions?.length || input.contract.removals?.length) {
    return { eligible: false, reason: "contract contains additions or removals, which this path does not model" };
  }

  const cap = maxLocalizedTargets();
  if (input.contract.assignments.length > cap) {
    return {
      eligible: false,
      reason: `${input.contract.assignments.length} targets exceeds the localized cap of ${cap}`,
    };
  }

  const uncovered = input.productIds.filter((id) => !getFewShotSku(id));
  if (uncovered.length > 0) {
    return { eligible: false, reason: `no validated catalogue classification for: ${uncovered.join(", ")}` };
  }

  if (!input.roomWidth || !input.roomHeight) {
    return { eligible: false, reason: "room dimensions unavailable, so no crop can be derived" };
  }

  const bounds = { width: input.roomWidth, height: input.roomHeight };
  for (const assignment of input.contract.assignments) {
    const issue = assessTargetGeometry(assignment.target.boundingBox, bounds);
    if (issue) {
      return { eligible: false, reason: `target ${assignment.target.targetId}: ${issue}` };
    }
  }

  // Masks are derived and checked BEFORE spending: two edits writing the same
  // pixel would make the composite order-dependent, which is the one thing this
  // architecture must never allow.
  const masks = input.contract.assignments.map((assignment) => ({
    id: assignment.target.targetId,
    rect: deriveMaskRect(assignment.target.boundingBox, bounds),
  }));
  const overlaps = findMaskOverlaps(masks);
  if (overlaps.length > 0) {
    const described = overlaps.map((o) => `${o.a}/${o.b} (${o.area}px)`).join(", ");
    return { eligible: false, reason: `edit masks overlap: ${described}` };
  }

  return { eligible: true };
}

export type LocalizedEditPlan = {
  id: string;
  productId: string;
  productTitle: string;
  crop: PixelRect;
  aspectRatio: string;
  maskRect: PixelRect;
  protectedRects: PixelRect[];
  prompt: string;
  references: Array<{ mimeType: string; data: Buffer; url: string; view: string }>;
};

export type LocalizedResult = {
  imageBase64: string;
  mimeType: string;
  provider: string;
  label: string;
  products: Product[];
  debug: Record<string, unknown>;
};

/**
 * Failure policy: ALL OR NOTHING.
 *
 * If any edit fails, the whole request fails with a structured error naming the
 * target. Compositing the survivors would show a room missing a product the
 * basket still lists — silent corruption of exactly the kind that is hardest to
 * notice and worst to ship. Each edit is allowed one retry on a fast 429/503 so
 * that a single transient blip does not throw away its siblings' spend.
 */
export async function runLocalizedRoomEdit(input: {
  roomImage: File;
  contract: ReplacementContract;
  products: Product[];
  apiKey: string;
}): Promise<LocalizedResult> {
  const timings = createTimings();

  const room = await timings.measure("room-preprocess", () => normaliseRoomForEdit(input.roomImage));
  const bounds = { width: room.width, height: room.height };
  if (!bounds.width || !bounds.height) {
    throw new Error("Room normalisation produced no dimensions; cannot derive localized crops.");
  }

  const productById = new Map(input.products.map((product) => [product.id, product]));
  const assignments = input.contract.assignments;

  /**
   * Neighbours that must survive, WITH geometry.
   *
   * `ProtectedItem.boundingBox` is optional because the field was added for
   * this path; entries without one are still protected, just by being outside
   * the mask rather than by an explicit cut-out.
   */
  const protectedBoxes: BoundingBox[] = (input.contract.protectedItems ?? [])
    .map((item) => item.boundingBox)
    .filter((box): box is BoundingBox => Boolean(box));

  // ------------------------------------------------------------ plan
  const plans = await timings.measure("reference-prepare", async () => {
    const built: LocalizedEditPlan[] = [];

    for (const assignment of assignments) {
      const sku = getFewShotSku(assignment.productId);
      const product = productById.get(assignment.productId);
      if (!sku || !product) {
        throw new Error(`No validated references for ${assignment.productId}.`);
      }

      const derived = deriveCrop(assignment.target.boundingBox, bounds);
      if (!derived) {
        throw new Error(`Could not derive a crop for ${assignment.target.targetId}.`);
      }

      const maskRect = deriveMaskRect(assignment.target.boundingBox, bounds);
      const protectedRects = deriveProtectedRects({
        crop: derived.crop,
        ownMask: maskRect,
        otherTargetBoxes: assignments
          .filter((other) => other.target.targetId !== assignment.target.targetId)
          .map((other) => other.target.boundingBox),
        protectedBoxes,
        bounds,
      });

      const { loaded } = await loadFewShotReferences([{ id: product.id, name: product.name }]);
      const references = loaded.slice(0, MAX_FEW_SHOT_REFERENCES);
      if (references.length === 0) {
        throw new Error(`No reference images loaded for ${product.id}.`);
      }

      const target = assignment.target;
      built.push({
        id: target.targetId,
        productId: product.id,
        productTitle: assignment.productTitle,
        crop: derived.crop,
        aspectRatio: derived.aspectRatio,
        maskRect,
        protectedRects,
        prompt: buildLocalizedPrompt({
          productTitle: assignment.productTitle,
          targetDescription:
            target.originalObjectDescription?.trim() ||
            target.instanceLabel?.trim() ||
            target.displayName,
          location: target.location || null,
          sku,
          referenceViews: references.map((reference) => reference.view),
        }),
        references: await Promise.all(
          references.map(async (reference) => ({
            mimeType: reference.file.type,
            data: Buffer.from(await reference.file.arrayBuffer()),
            url: reference.url,
            view: reference.view,
          }))
        ),
      });
    }
    return built;
  });

  // ------------------------------------------------------------ generate
  const timeoutMs = envInt("LOCALIZED_EDIT_TIMEOUT_MS", 120_000);
  const totalBudgetMs = envInt("LOCALIZED_TOTAL_BUDGET_MS", 180_000);
  const deadline = Date.now() + totalBudgetMs;

  const wallStart = Date.now();
  const settled = await Promise.allSettled(
    plans.map(async (plan) => {
      const crop = await extractCrop(room.data, plan.crop);
      timings.recordProviderAttempt();
      return generateLocalizedEdit({
        id: plan.id,
        prompt: plan.prompt,
        cropJpeg: crop,
        aspectRatio: plan.aspectRatio,
        references: plan.references.map((r) => ({ mimeType: r.mimeType, data: r.data })),
        apiKey: input.apiKey,
        timeoutMs,
        deadline,
        allowRetry: true,
      });
    })
  );
  const parallelWallMs = Date.now() - wallStart;
  timings.add("provider-request", parallelWallMs);

  const succeeded: Array<{ plan: LocalizedEditPlan; image: Buffer; latencyMs: number; attempts: number }> = [];
  const failed: Array<{ id: string; reason: string; retryable: boolean }> = [];

  settled.forEach((outcome, index) => {
    const plan = plans[index];
    if (outcome.status === "fulfilled") {
      succeeded.push({ plan, image: outcome.value.image, latencyMs: outcome.value.latencyMs, attempts: outcome.value.attempts });
    } else {
      const error = outcome.reason;
      failed.push({
        id: plan.id,
        reason: error instanceof Error ? error.message : String(error),
        retryable: error instanceof ProviderBusyError,
      });
    }
  });

  if (failed.length > 0) {
    console.warn("[localized] edit failure — failing the whole request", {
      failed,
      succeeded: succeeded.map((s) => s.plan.id),
      parallelWallMs,
    });
    // All-or-nothing: never composite a partial room. Surfaced as retryable
    // when every failure was a capacity blip, so the UI can offer a retry
    // rather than a dead end.
    const allRetryable = failed.every((entry) => entry.retryable);
    const message =
      failed.length === plans.length
        ? "The image provider could not complete this room. Please try again in a moment."
        : `One of the ${plans.length} product edits could not be completed, so the room was not changed. Please try again.`;
    if (allRetryable) throw new ProviderBusyError("provider_busy", message);
    throw new Error(message);
  }

  // ------------------------------------------------------------ composite
  const compositeStart = Date.now();
  const layers: LocalizedEditLayer[] = [];
  const maskSummaries: Array<Record<string, unknown>> = [];

  for (const entry of succeeded) {
    const mask = await buildLocalizedMask({
      crop: entry.plan.crop,
      maskRect: entry.plan.maskRect,
      protectedRects: entry.plan.protectedRects,
    });
    const stats = maskStats(mask);
    maskSummaries.push({
      id: entry.plan.id,
      productId: entry.plan.productId,
      crop: entry.plan.crop,
      aspectRatio: entry.plan.aspectRatio,
      maskRect: entry.plan.maskRect,
      protectedRects: entry.plan.protectedRects.length,
      ...stats,
    });
    layers.push({ id: entry.plan.id, crop: entry.plan.crop, mask, editedCrop: entry.image });
  }

  const { image, changedPixels } = await compositeLocalizedEdits({
    roomImage: room.data,
    roomWidth: bounds.width,
    roomHeight: bounds.height,
    layers,
  });
  const compositeMs = Date.now() - compositeStart;
  timings.add("response-encode", compositeMs);

  const snapshot = timings.snapshot();

  return {
    imageBase64: image.toString("base64"),
    mimeType: "image/jpeg",
    // The RENDERER's id, not the strategy's — the studio client validates this.
    provider: "gemini",
    label: "Gemini",
    products: input.products,
    debug: {
      strategy: "localized",
      model: process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3-pro-image",
      room: { width: bounds.width, height: bounds.height, bytes: room.data.length, aspectRatio: room.aspectRatio },
      targetCount: plans.length,
      edits: succeeded.map((entry, index) => ({
        ...maskSummaries[index],
        productTitle: entry.plan.productTitle,
        references: entry.plan.references.map((r) => ({ url: r.url, view: r.view })),
        promptBytes: Buffer.byteLength(entry.plan.prompt, "utf8"),
        prompt: entry.plan.prompt,
        latencyMs: entry.latencyMs,
        attempts: entry.attempts,
      })),
      failedEdits: failed,
      changedPixels,
      changedFraction: Number((changedPixels / (bounds.width * bounds.height)).toFixed(4)),
      parallelWallMs,
      sumOfEditLatencyMs: succeeded.reduce((sum, entry) => sum + entry.latencyMs, 0),
      compositeMs,
      timings: { ...snapshot, unattributedMs: unattributedMs(snapshot) },
    },
  };
}
