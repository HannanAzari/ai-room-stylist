/**
 * Reference Manifest (Replacement Accuracy sprint, Phases 6–8).
 *
 * Decides exactly which product reference images are transmitted to the image
 * model, in what order, with what label — and records everything that was NOT
 * transmitted together with the reason.
 *
 * Three bugs motivated this module:
 *
 *  1. The provider silently truncated product images to the first two
 *     (`productImages.slice(0, 2)`), so the third and later selected products
 *     reached the model with no visual reference at all while their tasks were
 *     still described in the prompt.
 *  2. Images were appended as anonymous inline blobs, so nothing told the model
 *     which image belonged to which product or task.
 *  3. The prompt announced the number of images LOADED, not the number SENT, so
 *     it routinely claimed references that never arrived.
 *
 * The manifest is the single source of truth: the payload and the prompt are
 * both derived from it, so they cannot disagree.
 *
 * Allocation policy — first-view coverage before depth:
 *   round 1: the primary view of every SELECTED product, in selection order
 *   round 2: the primary view of every COMPLEMENTARY product
 *   round 3+: additional views, same ordering, only if budget remains
 * So four selected products yield four primary views, never three views of one
 * product while another gets none.
 */
import type { LoadedProductReference } from "@/lib/product-image-references";
import type { ReplacementPlan } from "./replacement-planner";

/**
 * Maximum product reference images attached to one generation request.
 *
 * Chosen against the ACTUAL request implementation in
 * `services/image-providers/gemini.ts`, which inlines every image as base64 in
 * a single `generateContent` call:
 *  - Probing the live model, requests carrying the room photo plus 6 references
 *    (7 images) failed consistently, while 5 and fewer succeeded. The provider
 *    also returns intermittent 500s at smaller sizes, so this is a prudent
 *    ceiling rather than a proven hard limit — the provider call retries on
 *    5xx separately.
 *  - Inline request payloads must stay well under the API's 20MB request limit.
 *    Catalogue images average ~109KB and peak at ~786KB, so 6 images is ~0.7MB
 *    typical and ~4.7MB worst case, leaving ample headroom alongside the room
 *    photo. `MAX_TOTAL_REFERENCE_BYTES` enforces this independently of count.
 * This is a deliberate, bounded budget rather than an unlimited fan-out.
 */
export const MAX_TRANSMITTED_REFERENCES = 5;

/** Byte ceiling for all product references combined (room photo excluded). */
export const MAX_TOTAL_REFERENCE_BYTES = 12 * 1024 * 1024;

export type ReferenceManifestEntry = {
  productId: string;
  productName: string;
  /**
   * The FIRST plan task this reference supports; null if it has none. Kept for
   * debug/eval readers that show one task per row — `taskIds` is the complete
   * answer and the one the label is built from.
   */
  taskId: number | null;
  /**
   * Every plan task this reference supports. More than one when the same
   * product fills several tasks (two identical sofas), which is precisely the
   * case a single-task field used to lose.
   */
  taskIds: number[];
  selectedOrComplementary: "selected" | "complementary";
  viewType: string;
  /** Ordinal of this view for its product: 1 = primary view. */
  viewIndex: number;
  transmitted: boolean;
  /** Populated only when `transmitted` is false. */
  reason?: string;
  /** The text part that introduces this image in the payload. */
  label: string;
  bytes: number;
};

export type ReferenceManifest = {
  entries: ReferenceManifestEntry[];
  /** Entries actually sent, in payload order. */
  transmitted: ReferenceManifestEntry[];
  /** True when at least one selected product has no transmitted reference. */
  hasUncoveredSelectedProduct: boolean;
  /** Ids of selected products with no transmitted reference image. */
  uncoveredSelectedProductIds: string[];
  transmittedBytes: number;
};

/**
 * Map every product in the plan to EVERY task it serves, plus its role.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A LIST AND NOT A SINGLE TASK ID
 * ---------------------------------------------------------------------------
 * This was the "I asked for two sofas and only one changed" bug.
 *
 * One product can legitimately serve several tasks — a room getting two
 * identical 3-seaters produces two REPLACE tasks bound to the same product id.
 * This index used to store one task per product, so the second `set` silently
 * overwrote the first, and the single reference image that product got was
 * labelled "TASK 2 PRODUCT REFERENCE ... the product in task 2".
 *
 * Nothing downstream could recover from that. The prompt still said "Task 1 —
 * ... IDENTITY (must match the reference image for task 1)", but no image
 * claimed task 1; and the provider's own instructions say to use each image
 * ONLY for the task named above it and never to reuse one across tasks. So the
 * model was explicitly told it had no authorised reference for task 1, did the
 * one task it had an image for, and left the other sofa alone — exactly the
 * reported symptom, with the product shelf still showing ×2.
 *
 * Keeping every task id means one shared image is labelled for all of them,
 * and the count of instances the image is expected to produce is stated
 * outright.
 */
function buildProductTaskIndex(plan?: ReplacementPlan) {
  const index = new Map<
    string,
    { taskIds: number[]; source: "selected" | "complementary" }
  >();
  if (!plan) return index;

  const add = (
    productId: string,
    taskId: number,
    source: "selected" | "complementary"
  ) => {
    const existing = index.get(productId);
    if (existing) {
      if (!existing.taskIds.includes(taskId)) existing.taskIds.push(taskId);
      // A product used by any selected task is a selected product, even if it
      // also happens to appear as a complementary one.
      if (source === "selected") existing.source = "selected";
      return;
    }
    index.set(productId, { taskIds: [taskId], source });
  };

  for (const task of plan.replacements) {
    add(task.productId, task.taskId, "selected");
  }
  for (const task of plan.additions) {
    add(task.productId, task.taskId, task.source);
  }
  for (const entry of index.values()) entry.taskIds.sort((a, b) => a - b);
  return index;
}

/** "task 3", "tasks 1 and 2", "tasks 1, 2 and 4". */
export function formatTaskList(taskIds: number[]): string {
  if (taskIds.length === 1) return `task ${taskIds[0]}`;
  const head = taskIds.slice(0, -1).join(", ");
  return `tasks ${head} and ${taskIds[taskIds.length - 1]}`;
}

function buildLabel(entry: {
  taskIds: number[];
  productName: string;
  source: "selected" | "complementary";
  viewType: string;
  viewIndex: number;
}): string {
  const view =
    entry.viewIndex > 1 ? ` / VIEW ${entry.viewIndex} (${entry.viewType})` : "";

  if (entry.taskIds.length === 0) {
    return `COMPLEMENTARY PRODUCT REFERENCE${view} — ${entry.productName}. This image is the exact appearance of this complementary product.`;
  }

  const taskList = formatTaskList(entry.taskIds);
  const heading =
    entry.taskIds.length === 1
      ? `TASK ${entry.taskIds[0]} PRODUCT REFERENCE`
      : `TASKS ${entry.taskIds.join(" AND ")} PRODUCT REFERENCE`;

  // When one image covers several tasks the model must be told, in the same
  // breath, that this means several separate pieces of furniture — otherwise
  // "one image, one product" reads as "one object in the finished room".
  const shared =
    entry.taskIds.length > 1
      ? ` This ONE image serves ${entry.taskIds.length} separate tasks: the finished room must contain ${entry.taskIds.length} separate, physically distinct pieces matching it, one for each of ${taskList}. Use it for every one of those tasks.`
      : "";

  return `${heading}${view} — ${entry.productName}. This image is the exact appearance of the product in ${taskList}.${shared}`;
}

/**
 * Build the manifest from loaded references + the plan.
 *
 * `loaded` must already be grouped per product in the order products should be
 * prioritised (i.e. customer-selection order).
 */
export function buildReferenceManifest(input: {
  loaded: LoadedProductReference[];
  plan?: ReplacementPlan;
  selectedProductIds: string[];
  maxReferences?: number;
  maxBytes?: number;
}): ReferenceManifest {
  const maxReferences = input.maxReferences ?? MAX_TRANSMITTED_REFERENCES;
  const maxBytes = input.maxBytes ?? MAX_TOTAL_REFERENCE_BYTES;
  const taskIndex = buildProductTaskIndex(input.plan);
  const selectedIds = new Set(input.selectedProductIds);

  // Group loaded views per product, preserving both product order and view
  // order as supplied by the loader.
  const byProduct = new Map<string, LoadedProductReference[]>();
  for (const reference of input.loaded) {
    const existing = byProduct.get(reference.productId);
    if (existing) existing.push(reference);
    else byProduct.set(reference.productId, [reference]);
  }

  // Selected products first (in selection order), then complementary ones.
  const orderedProductIds = [
    ...input.selectedProductIds.filter((id) => byProduct.has(id)),
    ...[...byProduct.keys()].filter((id) => !selectedIds.has(id)),
  ];

  // Round-based allocation: view 1 of every product, then view 2, and so on.
  const maxViews = Math.max(
    0,
    ...orderedProductIds.map((id) => byProduct.get(id)?.length ?? 0)
  );
  const ordered: { reference: LoadedProductReference; viewIndex: number }[] = [];
  for (let viewIndex = 0; viewIndex < maxViews; viewIndex += 1) {
    for (const productId of orderedProductIds) {
      const reference = byProduct.get(productId)?.[viewIndex];
      if (reference) ordered.push({ reference, viewIndex: viewIndex + 1 });
    }
  }

  const entries: ReferenceManifestEntry[] = [];
  let transmittedCount = 0;
  let transmittedBytes = 0;

  for (const { reference, viewIndex } of ordered) {
    const task = taskIndex.get(reference.productId);
    const source: "selected" | "complementary" = selectedIds.has(
      reference.productId
    )
      ? "selected"
      : (task?.source ?? "complementary");
    const taskIds = task?.taskIds ?? [];
    const taskId = taskIds[0] ?? null;
    const label = buildLabel({
      taskIds,
      productName: reference.productName,
      source,
      viewType: reference.view,
      viewIndex,
    });

    const exceedsCount = transmittedCount >= maxReferences;
    const exceedsBytes = transmittedBytes + reference.bytes > maxBytes;
    const transmitted = !exceedsCount && !exceedsBytes;

    if (transmitted) {
      transmittedCount += 1;
      transmittedBytes += reference.bytes;
    }

    entries.push({
      productId: reference.productId,
      productName: reference.productName,
      taskId,
      taskIds,
      selectedOrComplementary: source,
      viewType: reference.view,
      viewIndex,
      transmitted,
      reason: transmitted
        ? undefined
        : exceedsCount
          ? `reference budget of ${maxReferences} images reached; lower-priority view not sent`
          : `reference byte budget of ${maxBytes} bytes reached; view not sent`,
      label,
      bytes: reference.bytes,
    });
  }

  const transmitted = entries.filter((entry) => entry.transmitted);
  const coveredSelected = new Set(
    transmitted
      .filter((entry) => entry.selectedOrComplementary === "selected")
      .map((entry) => entry.productId)
  );
  const uncoveredSelectedProductIds = input.selectedProductIds.filter(
    (id) => !coveredSelected.has(id)
  );

  return {
    entries,
    transmitted,
    hasUncoveredSelectedProduct: uncoveredSelectedProductIds.length > 0,
    uncoveredSelectedProductIds,
    transmittedBytes,
  };
}

/**
 * Manifest entries for selected products that could not be given a reference
 * image at all, annotated with why — used to surface the condition explicitly
 * instead of dropping the reference silently.
 */
export function describeUncoveredSelectedProducts(
  manifest: ReferenceManifest,
  skippedReasonsByProductId: Map<string, string>
): { productId: string; reason: string }[] {
  return manifest.uncoveredSelectedProductIds.map((productId) => ({
    productId,
    reason:
      skippedReasonsByProductId.get(productId) ||
      "no usable reference image was available for this product",
  }));
}
