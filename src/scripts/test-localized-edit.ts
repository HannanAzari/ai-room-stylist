/**
 * The localized multi-edit strategy: geometry, masks, compositing, eligibility,
 * orchestration and failure handling.
 *
 * Run with:  npm run test:localized
 *
 * Offline and free. The two orchestration sections drive the REAL production
 * path with `globalThis.fetch` stubbed, so the request bodies and the failure
 * policy are exercised as shipped — no paid generation happens anywhere here.
 */
import { readFileSync } from "node:fs";
import sharp from "sharp";
import {
  assessTargetGeometry,
  boxToPixels,
  clampRectToBounds,
  deriveCrop,
  deriveMaskRect,
  deriveProtectedRects,
  expandRect,
  findMaskOverlaps,
  intersectRects,
  LOCALIZED_DEFAULTS,
  rectsOverlap,
  snapToSupportedAspect,
  SUPPORTED_CROP_RATIOS,
  type PixelRect,
} from "@/lib/intelligence/localized-geometry";
import {
  buildLocalizedMask,
  compositeLocalizedEdits,
  maskStats,
} from "@/features/room-stylist/services/image-providers/localized-compositor";
import { buildLocalizedPrompt } from "@/lib/intelligence/localized-prompt";
import {
  checkLocalizedEligibility,
  maxLocalizedTargets,
  runLocalizedRoomEdit,
} from "@/features/room-stylist/services/localized-room-edit";
import { getFewShotSku } from "@/lib/intelligence/few-shot-references";
import { getRoomEditStrategy } from "@/lib/intelligence/room-edit-strategy";
import { getProductsByIdsInSelectionOrder } from "@/lib/products";
import type { BoundingBox } from "@/lib/intelligence/scene-graph";
import type { ReplacementContract } from "@/lib/intelligence/replacement-assignment";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const KELLY = "kelly-pearl-beige-fabric-3-seater-sofa-champagne-gold-legs";
const ELVA = "elva-green-pastel-nubuck-leather-3-seater-sofa";
const ASPEN = "aspen-white-sintered-stone-coffee-table-matte-black-legs";
const ROOM = { width: 2048, height: 1536 };

/** The benchmark room's real measured geometry, normalised. */
const BOX = {
  leftSofa: { x: 55 / 2048, y: 845 / 1536, width: 715 / 2048, height: 465 / 1536 },
  rightSofa: { x: 1290 / 2048, y: 845 / 1536, width: 758 / 2048, height: 691 / 1536 },
  coffeeTable: { x: 750 / 2048, y: 970 / 1536, width: 335 / 2048, height: 325 / 1536 },
  tvUnit: { x: 790 / 2048, y: 830 / 1536, width: 440 / 2048, height: 105 / 1536 },
};

async function main() {
  console.log("\nGeometry — primitives");
  {
    const rect = boxToPixels(BOX.leftSofa, ROOM);
    check("a normalised box maps to the measured pixels",
      rect.left === 55 && rect.top === 845 && rect.width === 715 && rect.height === 465,
      JSON.stringify(rect));
    check("clamping never resizes a rectangle that already fits",
      JSON.stringify(clampRectToBounds(rect, ROOM)) === JSON.stringify(rect));

    const oversize = clampRectToBounds({ left: -50, top: -50, width: 5000, height: 5000 }, ROOM);
    check("an oversize rectangle is clamped to the image",
      oversize.left === 0 && oversize.top === 0 && oversize.width === 2048 && oversize.height === 1536);

    const edge = expandRect({ left: 0, top: 0, width: 100, height: 100 }, 200, ROOM);
    check("expansion at the image edge stays inside bounds",
      edge.left === 0 && edge.top === 0 && edge.left + edge.width <= ROOM.width);

    check("overlapping rectangles are detected",
      rectsOverlap({ left: 0, top: 0, width: 100, height: 100 }, { left: 50, top: 50, width: 100, height: 100 }));
    check("touching-but-not-overlapping rectangles are not",
      !rectsOverlap({ left: 0, top: 0, width: 100, height: 100 }, { left: 100, top: 0, width: 100, height: 100 }));
    check("intersection of disjoint rectangles is null",
      intersectRects({ left: 0, top: 0, width: 10, height: 10 }, { left: 500, top: 500, width: 10, height: 10 }) === null);
  }

  console.log("\nGeometry — crop derivation");
  {
    for (const [name, box] of Object.entries(BOX)) {
      const derived = deriveCrop(box as BoundingBox, ROOM);
      check(`${name}: a crop is derivable`, Boolean(derived));
      if (!derived) continue;

      const target = boxToPixels(box as BoundingBox, ROOM);
      const contains =
        derived.crop.left <= target.left &&
        derived.crop.top <= target.top &&
        derived.crop.left + derived.crop.width >= target.left + target.width &&
        derived.crop.top + derived.crop.height >= target.top + target.height;
      check(`${name}: the crop fully contains the target`, contains, JSON.stringify(derived.crop));

      const ratio = SUPPORTED_CROP_RATIOS.find((r) => r.label === derived.aspectRatio);
      check(`${name}: the requested ratio is a supported one`, Boolean(ratio), derived.aspectRatio);
      const actual = derived.crop.width / derived.crop.height;
      check(`${name}: the crop's true shape matches the requested ratio (no distortion)`,
        Boolean(ratio) && Math.abs(actual - ratio!.value) < 0.01,
        `${actual.toFixed(4)} vs ${ratio?.value.toFixed(4)}`);
      check(`${name}: the crop stays inside the room`,
        derived.crop.left >= 0 && derived.crop.top >= 0 &&
        derived.crop.left + derived.crop.width <= ROOM.width &&
        derived.crop.top + derived.crop.height <= ROOM.height);
      check(`${name}: the crop adds real context`,
        derived.crop.width > target.width || derived.crop.height > target.height);
    }

    // A target hard against two edges still yields a legal crop.
    const corner = deriveCrop({ x: 0, y: 0, width: 0.2, height: 0.2 }, ROOM);
    check("a target in the corner still produces a legal crop", Boolean(corner));
    check("the corner crop is clamped, not shifted off-image",
      Boolean(corner) && corner!.crop.left >= 0 && corner!.crop.top >= 0);

    check("snapping refuses a shape no supported ratio can hold",
      snapToSupportedAspect({ left: 0, top: 0, width: 2048, height: 40 }, { width: 2048, height: 100 }) === null);
  }

  console.log("\nGeometry — eligibility per target");
  {
    check("a healthy target passes", assessTargetGeometry(BOX.leftSofa, ROOM) === null);
    check("a missing box is rejected", assessTargetGeometry(null, ROOM) === "missing-box");
    check("a zero-size box is rejected",
      assessTargetGeometry({ x: 0.1, y: 0.1, width: 0, height: 0.2 }, ROOM) === "degenerate-box");
    check("a NaN box is rejected",
      assessTargetGeometry({ x: Number.NaN, y: 0.1, width: 0.2, height: 0.2 }, ROOM) === "degenerate-box");
    check("a speck of a target is rejected",
      assessTargetGeometry({ x: 0.5, y: 0.5, width: 0.01, height: 0.01 }, ROOM) === "target-too-small");
    check("a target filling the room is rejected",
      assessTargetGeometry({ x: 0, y: 0, width: 0.95, height: 0.95 }, ROOM) === "target-too-large");
  }

  console.log("\nDefaults");
  {
    check("context margin leaves room for perspective",
      LOCALIZED_DEFAULTS.contextMargin >= 0.25 && LOCALIZED_DEFAULTS.contextMargin <= 1);
    check("the mask feather is softer than the protection feather",
      LOCALIZED_DEFAULTS.maskFeatherPx > LOCALIZED_DEFAULTS.protectFeatherPx);
    check("a crop floor stops starving the model of context",
      LOCALIZED_DEFAULTS.minCropPx >= 256);
    check("the target size window excludes specks and whole-room boxes",
      LOCALIZED_DEFAULTS.minTargetAreaFraction > 0 &&
        LOCALIZED_DEFAULTS.maxTargetAreaFraction < 1 &&
        LOCALIZED_DEFAULTS.minTargetAreaFraction < LOCALIZED_DEFAULTS.maxTargetAreaFraction);
    check("Aspen is classified, so a coffee table is a legal localized target",
      Boolean(getFewShotSku(ASPEN)));
    check("Aspen's coffee-table box yields a legal crop",
      assessTargetGeometry(BOX.coffeeTable, ROOM) === null);
  }

  console.log("\nGeometry — masks and overlap");
  {
    const masks = [
      { id: "left", rect: deriveMaskRect(BOX.leftSofa, ROOM) },
      { id: "right", rect: deriveMaskRect(BOX.rightSofa, ROOM) },
      { id: "table", rect: deriveMaskRect(BOX.coffeeTable, ROOM) },
    ];
    check("the mask sits outside the target box", masks[0].rect.width > boxToPixels(BOX.leftSofa, ROOM).width);
    check("the two sofa masks are disjoint",
      findMaskOverlaps([masks[0], masks[1]]).length === 0);

    /**
     * The case that motivated neighbour geometry: the left sofa's box and the
     * coffee table's are adjacent enough that their MASKS meet, so a three-way
     * selection must be caught before any spend.
     */
    const all = findMaskOverlaps(masks);
    check("the left sofa and coffee-table masks DO meet — the case neighbour geometry exists for",
      all.length > 0, `${all.length} overlaps`);
    check("overlapping masks are reported with the pair and the area",
      all.length > 0 && all.every((o) => o.a && o.b && o.area > 0));

    const protectedRects = deriveProtectedRects({
      crop: deriveCrop(BOX.leftSofa, ROOM)!.crop,
      ownMask: masks[0].rect,
      otherTargetBoxes: [BOX.rightSofa],
      protectedBoxes: [BOX.coffeeTable, BOX.tvUnit],
      bounds: ROOM,
    });
    check("neighbours inside the crop become protected rectangles", protectedRects.length > 0);
    check("every protected rectangle lies inside the crop",
      protectedRects.every((r) => intersectRects(r, deriveCrop(BOX.leftSofa, ROOM)!.crop) !== null));
    check("a neighbour outside the crop is not protected pointlessly",
      protectedRects.every((r) => r.left + r.width <= deriveCrop(BOX.leftSofa, ROOM)!.crop.left + deriveCrop(BOX.leftSofa, ROOM)!.crop.width + 1));
  }

  console.log("\nMask rasterisation — protected interiors must be HARD zero");
  {
    const crop: PixelRect = { left: 0, top: 651, width: 1180, height: 885 };
    const maskRect: PixelRect = { left: 20, top: 800, width: 800, height: 560 };
    const protectedRects: PixelRect[] = [
      { left: 700, top: 900, width: 300, height: 300 },
      { left: 100, top: 1250, width: 200, height: 150 },
    ];
    const mask = await buildLocalizedMask({ crop, maskRect, protectedRects });

    let nonZeroInsideProtected = 0;
    let checkedProtected = 0;
    for (const rect of protectedRects) {
      for (let y = rect.top - crop.top; y < rect.top - crop.top + rect.height; y += 1) {
        for (let x = rect.left - crop.left; x < rect.left - crop.left + rect.width; x += 1) {
          if (x < 0 || y < 0 || x >= crop.width || y >= crop.height) continue;
          checkedProtected += 1;
          if (mask[y * crop.width + x] !== 0) nonZeroInsideProtected += 1;
        }
      }
    }
    check(`protected interiors are exactly zero (${checkedProtected.toLocaleString()} px checked)`,
      nonZeroInsideProtected === 0, `${nonZeroInsideProtected} non-zero`);

    const stats = maskStats(mask);
    check("the mask has a real editable core", stats.fullyEditablePixels > 10000, JSON.stringify(stats));
    check("the mask has a soft edge, not a hard rectangle",
      stats.editablePixels > stats.fullyEditablePixels,
      `${stats.editablePixels} editable vs ${stats.fullyEditablePixels} full`);
    check("everything outside the editable region is protected",
      stats.protectedPixels > 0);

    const noProtection = await buildLocalizedMask({ crop, maskRect, protectedRects: [] });
    check("with no protected rectangles the mask is still feathered",
      maskStats(noProtection).editablePixels > maskStats(noProtection).fullyEditablePixels);
  }

  console.log("\nCompositing");
  {
    const W = 400;
    const H = 300;
    const room = await sharp({ create: { width: W, height: H, channels: 3, background: "#804020" } })
      .jpeg()
      .toBuffer();
    const crop: PixelRect = { left: 50, top: 50, width: 200, height: 150 };
    const maskRect: PixelRect = { left: 80, top: 80, width: 100, height: 80 };
    const protectedRects: PixelRect[] = [{ left: 150, top: 100, width: 40, height: 40 }];
    const mask = await buildLocalizedMask({ crop, maskRect, protectedRects, featherPx: 4, protectFeatherPx: 2 });
    const edited = await sharp({ create: { width: 200, height: 150, channels: 3, background: "#00ff00" } })
      .jpeg()
      .toBuffer();

    const { image, changedPixels } = await compositeLocalizedEdits({
      roomImage: room,
      roomWidth: W,
      roomHeight: H,
      layers: [{ id: "a", crop, mask, editedCrop: edited }],
    });

    const before = await sharp(room).removeAlpha().raw().toBuffer();
    const after = await sharp(image).removeAlpha().raw().toBuffer();
    check("compositing changed something", changedPixels > 0);
    check("compositing did not change the whole image", changedPixels < W * H);

    let outsideCropChanged = 0;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const inCrop = x >= crop.left && x < crop.left + crop.width && y >= crop.top && y < crop.top + crop.height;
        if (inCrop) continue;
        const i = (y * W + x) * 3;
        if (Math.abs(before[i] - after[i]) > 6) outsideCropChanged += 1;
      }
    }
    check("pixels outside the crop are untouched", outsideCropChanged === 0, `${outsideCropChanged} changed`);

    let protectedChanged = 0;
    for (const rect of protectedRects) {
      for (let y = rect.top; y < rect.top + rect.height; y += 1) {
        for (let x = rect.left; x < rect.left + rect.width; x += 1) {
          const i = (y * W + x) * 3;
          if (Math.abs(before[i] - after[i]) > 6) protectedChanged += 1;
        }
      }
    }
    check("protected pixels survive compositing", protectedChanged === 0, `${protectedChanged} changed`);

    // Disjoint layers must commute — the whole point of forbidding overlap.
    const cropB: PixelRect = { left: 260, top: 50, width: 120, height: 120 };
    const maskB: PixelRect = { left: 280, top: 70, width: 60, height: 60 };
    const maskBufB = await buildLocalizedMask({ crop: cropB, maskRect: maskB, protectedRects: [], featherPx: 3 });
    const editedB = await sharp({ create: { width: 120, height: 120, channels: 3, background: "#0000ff" } })
      .jpeg()
      .toBuffer();
    const layerA = { id: "a", crop, mask, editedCrop: edited };
    const layerB = { id: "b", crop: cropB, mask: maskBufB, editedCrop: editedB };
    const ab = await compositeLocalizedEdits({ roomImage: room, roomWidth: W, roomHeight: H, layers: [layerA, layerB] });
    const ba = await compositeLocalizedEdits({ roomImage: room, roomWidth: W, roomHeight: H, layers: [layerB, layerA] });
    check("disjoint layers composite identically in either order",
      Buffer.compare(ab.image, ba.image) === 0);
  }

  console.log("\nPrompt");
  {
    const prompt = buildLocalizedPrompt({
      productTitle: "Elva Pastel Nubuck 3 Seater Sofa",
      targetDescription: "dark charcoal fabric sofa",
      location: "on the left",
      sku: getFewShotSku(ELVA)!,
      referenceViews: ["front", "side"],
    });
    check("the prompt names the product", prompt.includes("Elva Pastel Nubuck 3 Seater Sofa"));
    check("the prompt describes the target visually", prompt.includes("the dark charcoal fabric sofa on the left"));
    check("the prompt carries the SKU signature", prompt.includes(getFewShotSku(ELVA)!.signature));
    check("the prompt names the reference views in order", /from the front and side/.test(prompt));
    check("the prompt says this is a region, not a whole room", /one region of a real room/.test(prompt));
    check("the prompt stays small", Buffer.byteLength(prompt, "utf8") < 900, `${Buffer.byteLength(prompt, "utf8")}B`);
    check("no room-wide preservation list is included", !/ceiling fan|TV unit/.test(prompt));
  }

  console.log("\nFeature flag");
  {
    const original = process.env.ROOM_EDIT_STRATEGY;
    delete process.env.ROOM_EDIT_STRATEGY;
    check("unset still means grounding", getRoomEditStrategy() === "grounding");
    process.env.ROOM_EDIT_STRATEGY = "localized";
    check("ROOM_EDIT_STRATEGY=localized selects the new path", getRoomEditStrategy() === "localized");
    process.env.ROOM_EDIT_STRATEGY = "localised";
    check("the British spelling also works", getRoomEditStrategy() === "localized");
    process.env.ROOM_EDIT_STRATEGY = "few-shot";
    check("few-shot is unaffected", getRoomEditStrategy() === "few-shot");
    process.env.ROOM_EDIT_STRATEGY = "nonsense";
    check("a typo still falls back to grounding", getRoomEditStrategy() === "grounding");
    if (original === undefined) delete process.env.ROOM_EDIT_STRATEGY;
    else process.env.ROOM_EDIT_STRATEGY = original;
  }

  // ---------------------------------------------------------------- fixtures
  const target = (id: string, box: BoundingBox, description: string) => ({
    targetId: id,
    sceneItemId: id,
    canonicalCategory: "sofa" as const,
    instanceLabel: `the ${description}`,
    displayName: "Sofa",
    boundingBox: box,
    selectionMethod: "smart" as const,
    originalObjectDescription: description,
    location: "on the left",
  });
  const contractOf = (entries: Array<{ id: string; box: BoundingBox; product: string; title: string }>, protectedBoxes: BoundingBox[] = []) =>
    ({
      assignments: entries.map((entry, index) => ({
        taskId: index + 1,
        action: "REPLACE" as const,
        target: target(entry.id, entry.box, "dark fabric sofa"),
        productId: entry.product,
        productTitle: entry.title,
        productCategorySlug: "sofas",
        canonicalCategory: "sofa" as const,
        scope: "this-only" as const,
      })),
      protectedItems: protectedBoxes.map((box, index) => ({
        sceneItemId: `p${index}`,
        label: "Coffee table",
        reason: "not assigned",
        boundingBox: box,
      })),
      sourceImage: ROOM,
    }) as unknown as ReplacementContract;

  console.log("\nEligibility — every ineligible case must fall back, never throw");
  {
    const one = contractOf([{ id: "t1", box: BOX.leftSofa, product: KELLY, title: "Kelly" }]);
    const base = { surpriseMe: false, roomWidth: ROOM.width, roomHeight: ROOM.height };
    check("a single valid target is eligible",
      checkLocalizedEligibility({ ...base, contract: one, productIds: [KELLY] }).eligible);

    const two = contractOf([
      { id: "t1", box: BOX.leftSofa, product: KELLY, title: "Kelly" },
      { id: "t2", box: BOX.rightSofa, product: ELVA, title: "Elva" },
    ]);
    check("two disjoint targets are eligible",
      checkLocalizedEligibility({ ...base, contract: two, productIds: [KELLY, ELVA] }).eligible);

    check("surprise-me is not eligible",
      !checkLocalizedEligibility({ ...base, surpriseMe: true, contract: one, productIds: [KELLY] }).eligible);
    check("a missing contract is not eligible",
      !checkLocalizedEligibility({ ...base, contract: null, productIds: [KELLY] }).eligible);
    check("an unclassified product is not eligible",
      !checkLocalizedEligibility({ ...base, contract: one, productIds: ["mystery-sofa"] }).eligible);

    const tooMany = contractOf(
      Array.from({ length: maxLocalizedTargets() + 1 }, (_, i) => ({
        id: `t${i}`,
        box: { x: 0.05 + i * 0.01, y: 0.6, width: 0.1, height: 0.1 },
        product: KELLY,
        title: "Kelly",
      }))
    );
    const capped = checkLocalizedEligibility({ ...base, contract: tooMany, productIds: [KELLY] });
    check("more targets than the cap is not eligible", !capped.eligible);
    check("the cap rejection says how many and what the cap is",
      !capped.eligible && /exceeds the localized cap/.test(capped.reason));

    const overlapping = contractOf([
      { id: "a", box: { x: 0.1, y: 0.6, width: 0.3, height: 0.25 }, product: KELLY, title: "Kelly" },
      { id: "b", box: { x: 0.2, y: 0.62, width: 0.3, height: 0.25 }, product: ELVA, title: "Elva" },
    ]);
    const overlapCheck = checkLocalizedEligibility({ ...base, contract: overlapping, productIds: [KELLY, ELVA] });
    check("OVERLAPPING MASKS force a fallback rather than a guess", !overlapCheck.eligible);
    check("the overlap rejection names the pair", !overlapCheck.eligible && /masks overlap/.test(overlapCheck.reason));

    const degenerate = contractOf([{ id: "t1", box: { x: 0.1, y: 0.1, width: 0, height: 0.2 }, product: KELLY, title: "Kelly" }]);
    check("a degenerate box is not eligible",
      !checkLocalizedEligibility({ ...base, contract: degenerate, productIds: [KELLY] }).eligible);
    check("missing room dimensions are not eligible",
      !checkLocalizedEligibility({ ...base, contract: one, productIds: [KELLY], roomWidth: 0 }).eligible);
  }

  // ---------------------------------------------------------------- harness
  const roomFile = async () => {
    const bytes = await sharp({ create: { width: 2048, height: 1536, channels: 3, background: "#a09080" } })
      .jpeg()
      .toBuffer();
    return new File([new Uint8Array(bytes)], "room.jpg", { type: "image/jpeg" });
  };

  const stubFetch = (behaviour: (url: string, body: Record<string, unknown>, call: number) => Response) => {
    let call = 0;
    const real = globalThis.fetch;
    const captured: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      call += 1;
      const body = JSON.parse(String(init.body));
      captured.push(body);
      return behaviour(String(url), body, call);
    }) as unknown as typeof fetch;
    return { captured, restore: () => { globalThis.fetch = real; }, calls: () => call };
  };

  const okResponse = async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#3060a0" } })
      .jpeg()
      .toBuffer();
    return () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { data: png.toString("base64"), mimeType: "image/jpeg" } }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
  };

  console.log("\nOrchestration — parallel, isolated, composited");
  {
    const ok = await okResponse();
    const stub = stubFetch(() => ok());
    try {
      const contract = contractOf(
        [
          { id: "t1", box: BOX.leftSofa, product: KELLY, title: "Kelly Pearl Beige Fabric 3 Seater Sofa" },
          { id: "t2", box: BOX.rightSofa, product: ELVA, title: "Elva Green Pastel Nubuck Leather 3 Seater Sofa" },
        ],
        [BOX.coffeeTable]
      );
      const result = await runLocalizedRoomEdit({
        roomImage: await roomFile(),
        contract,
        products: getProductsByIdsInSelectionOrder([KELLY, ELVA]),
        apiKey: "stub-not-used",
      });

      check("one request per target", stub.calls() === 2, `${stub.calls()} calls`);
      check("the composite is returned as an image", result.imageBase64.length > 0);
      check("the provider id passes the studio client guard", result.provider === "gemini");

      const debug = result.debug as Record<string, unknown>;
      check("debug names the strategy", debug.strategy === "localized");
      check("debug reports the target count", debug.targetCount === 2);
      check("debug reports parallel wall clock", typeof debug.parallelWallMs === "number");
      check("debug reports compositing time", typeof debug.compositeMs === "number");
      check("debug reports how much of the room changed",
        typeof debug.changedFraction === "number" && (debug.changedFraction as number) > 0);
      const edits = debug.edits as Array<Record<string, unknown>>;
      check("debug carries per-edit crop rectangles", edits.every((e) => Boolean(e.crop)));
      check("debug carries per-edit mask statistics", edits.every((e) => typeof e.editablePixels === "number"));
      check("debug carries per-edit latency", edits.every((e) => typeof e.latencyMs === "number"));

      /**
       * THE POINT OF THE WHOLE ARCHITECTURE: each request may contain only its
       * own product's references. Two images per request — the crop plus two
       * references — and no request may carry the other SKU's files.
       */
      const imageCounts = stub.captured.map(
        (body) => (body.contents as Array<{ parts: unknown[] }>)[0].parts.filter(
          (part) => typeof part === "object" && part !== null && "inline_data" in part
        ).length
      );
      check("each request carries the crop plus exactly two references",
        imageCounts.every((count) => count === 3), imageCounts.join(","));

      const prompts = stub.captured.map(
        (body) => ((body.contents as Array<{ parts: Array<{ text?: string }> }>)[0].parts[0].text ?? "")
      );
      check("the Kelly request mentions only Kelly",
        prompts.some((p) => p.includes("Kelly") && !p.includes("Elva")));
      check("the Elva request mentions only Elva",
        prompts.some((p) => p.includes("Elva") && !p.includes("Kelly")));
      check("every request sends exactly one text part",
        stub.captured.every((body) =>
          (body.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0].parts.filter((p) => "text" in p).length === 1));
      check("each request asks for its own crop's aspect ratio",
        stub.captured.every((body) =>
          Boolean(((body.generationConfig as { imageConfig?: { aspectRatio?: string } }).imageConfig ?? {}).aspectRatio)));
    } finally {
      stub.restore();
    }
  }

  console.log("\nFailure handling — all or nothing");
  {
    const ok = await okResponse();
    // Second edit 503s on every attempt; the first succeeds.
    const stub = stubFetch((_url, body) => {
      const text = ((body.contents as Array<{ parts: Array<{ text?: string }> }>)[0].parts[0].text ?? "");
      if (text.includes("Elva")) {
        return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503 });
      }
      return ok();
    });
    try {
      const contract = contractOf([
        { id: "t1", box: BOX.leftSofa, product: KELLY, title: "Kelly Pearl Beige Fabric 3 Seater Sofa" },
        { id: "t2", box: BOX.rightSofa, product: ELVA, title: "Elva Green Pastel Nubuck Leather 3 Seater Sofa" },
      ]);
      let threw: Error | null = null;
      try {
        await runLocalizedRoomEdit({
          roomImage: await roomFile(),
          contract,
          products: getProductsByIdsInSelectionOrder([KELLY, ELVA]),
          apiKey: "stub-not-used",
        });
      } catch (error) {
        threw = error as Error;
      }
      check("one failed edit fails the WHOLE request", threw !== null);
      check("no partial composite is returned", threw !== null && !("imageBase64" in (threw as object)));
      check("a capacity failure is reported as retryable",
        threw !== null && threw.name === "ProviderBusyError", threw?.name ?? "none");
      check("the failed edit was retried once on a 503",
        stub.calls() === 3, `${stub.calls()} calls (1 kelly + 2 elva)`);
    } finally {
      stub.restore();
    }
  }

  console.log("\nRoute wiring");
  {
    const ROUTE = readFileSync("src/app/api/studio/generate-gemini/route.ts", "utf8");
    const earlyAt = ROUTE.indexOf("const earlyLocalized = await attemptLocalized(");
    const analysisAt = ROUTE.indexOf("await analyzeSceneGraph");
    const readinessAt = ROUTE.indexOf("assessSceneReadiness({");
    const lateAt = ROUTE.indexOf("const resolvedLocalized = await attemptLocalized(");
    const planAt = ROUTE.indexOf("const replacementPlan =");

    check("both localized call sites exist", earlyAt > -1 && lateAt > -1);
    check("the client-contract attempt runs before scene analysis", earlyAt < analysisAt);
    check("the resolved-contract attempt runs after the readiness gate", lateAt > readinessAt);
    check("both run before the grounding plan is built", lateAt < planAt);
    check("localized declines are logged with a reason",
      /localized strategy declined/.test(ROUTE));
    check("a crash in the localized path falls back rather than failing",
      /localized path failed, falling back/.test(ROUTE));
    check("a busy provider returns a retryable 503", /retryable: true, reason: error\.reason/.test(ROUTE));
    check("the few-shot path is still wired", /attemptFewShot\(/.test(ROUTE));
    check("the grounding path is still wired",
      /buildIntelligentRoomPrompt\(\{/.test(ROUTE) && /reviewGeneratedRoom\(\{/.test(ROUTE));
    check("localized runs no quality reviewer",
      ROUTE.indexOf("return NextResponse.json(body)") < ROUTE.indexOf("const outcome = await reviewGeneratedRoom"));
  }

  console.log("\nContract carries neighbour geometry");
  {
    const SRC = readFileSync("src/lib/intelligence/replacement-assignment.ts", "utf8");
    check("ProtectedItem can carry a bounding box", /boundingBox\?: BoundingBox;/.test(SRC));
    check("the box is optional, so older callers still work",
      /\.\.\.\(object\.boundingBox \? \{ boundingBox: object\.boundingBox \} : \{\}\)/.test(SRC));
    const UI = readFileSync("src/components/studio/KoalaDesignStudio.tsx", "utf8");
    check("the client sends detected boxes through allDetected",
      /boundingBox: object\.boundingBox,/.test(UI));
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Passed: ${passed}   Failed: ${failures.length}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("All localized-edit tests passed.");
}

main();
