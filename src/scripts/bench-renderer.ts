/**
 * Renderer benchmark — one real generation, either provider, same inputs.
 *
 * Usage:
 *   ROOM_EDIT_PROVIDER=gemini GEMINI_IMAGE_MODEL=gemini-3-pro-image \
 *     npx tsx src/scripts/bench-renderer.ts data/bench/room.jpg
 *
 * Reuses the production pipeline end to end — scene graph, contract, plan,
 * enriched grounding, signature traits, reference manifest, renderer — so the
 * result is what the app would actually produce, not a bespoke approximation.
 * The ONLY thing this adds is fixing the three SKUs and saving the output.
 *
 * MAKES A REAL, PAID API CALL. Nothing here is mocked.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import sharp from "sharp";
import { basename, extname } from "node:path";
import { getAllProducts } from "@/lib/products";
import { getProductProfiles } from "@/lib/intelligence/product-profile";
import { resolveCategoryIntents } from "@/lib/intelligence/category-intent";
import { contractToReplacementPlan } from "@/lib/intelligence/replacement-assignment";
import { buildIntelligentRoomPrompt } from "@/lib/intelligence/prompt-builder";
import { buildReferenceManifest } from "@/lib/intelligence/reference-manifest";
import { buildGroundingDebugPacket } from "@/lib/intelligence/grounding-debug";
import { loadProductReferenceImages } from "@/lib/product-image-references";
import { getRoomEditProvider } from "@/features/room-stylist/services/image-providers/room-edit-provider";
import {
  analyzeSceneGraph,
  sceneGraphToRoomAnalysis,
} from "@/lib/intelligence/scene-graph";

/** The three SKUs under test. */
const SKUS = {
  kelly: "kelly-pearl-beige-fabric-3-seater-sofa-champagne-gold-legs",
  elva: "elva-green-pastel-nubuck-leather-3-seater-sofa",
  aspen: "aspen-white-sintered-stone-coffee-table-matte-black-legs",
};

function mimeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".heic" || ext === ".heif") return "image/heic";
  return "image/jpeg";
}

async function main() {
  const roomPath = process.argv[2];
  if (!roomPath) {
    console.error("Usage: tsx src/scripts/bench-renderer.ts <room-photo>");
    process.exit(1);
  }

  const catalogue = getAllProducts();
  const products = Object.values(SKUS).map((id) => {
    const product = catalogue.find((p) => p.id === id);
    if (!product) throw new Error(`SKU not in catalogue: ${id}`);
    return product;
  });
  const [kelly, elva, aspen] = products;

  // The room photo. Normalisation to a renderer-safe format happens inside the
  // provider (image-normalisation.ts), so HEIC is handled there, not here.
  const roomBytes = await readFile(roomPath);
  const roomImage = new File([new Uint8Array(roomBytes)], basename(roomPath), {
    type: mimeFor(roomPath),
  });

  const renderer = getRoomEditProvider();
  console.log(`\nrenderer      : ${renderer.label} (${renderer.id})`);
  console.log(`model         : ${process.env.GEMINI_IMAGE_MODEL || process.env.GPT_IMAGE_MODEL || "(provider default)"}`);
  console.log(`room photo    : ${roomPath} (${(roomBytes.length / 1024).toFixed(0)} KB)`);
  if (!renderer.available) {
    throw new Error(renderer.unavailableReason ?? "renderer unavailable");
  }

  // --- 1. Analyse the room (same call the route makes) --------------------
  const analysisKey = process.env.GEMINI_API_KEY?.trim();
  if (!analysisKey) throw new Error("GEMINI_API_KEY is required for scene analysis.");
  /**
   * Scene analysis gets a DOWNSCALED copy; the renderer still gets the full
   * image. A 4032x3024 phone photo took the analysis call past its 45s budget
   * and timed out, which silently produced a zero-object scene graph — and a
   * plan with no REPLACE tasks at all. Analysis needs semantic understanding,
   * not 12 megapixels, so 1568px on the long edge is ample and fast.
   */
  const analysisBytes = await sharp(roomBytes)
    .rotate()
    .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  const analysisImage = new File([new Uint8Array(analysisBytes)], "room-analysis.jpg", {
    type: "image/jpeg",
  });
  console.log(`\nanalysing the room... (${(analysisBytes.length / 1024).toFixed(0)} KB downscaled copy)`);
  const analysisStart = Date.now();
  const sceneGraph = await analyzeSceneGraph(analysisImage, {
    apiKey: analysisKey,
    roomTypeHint: "living room",
  });
  console.log(`  ${((Date.now() - analysisStart) / 1000).toFixed(1)}s — ${sceneGraph.furniture.length} objects detected`);
  for (const item of sceneGraph.furniture) {
    console.log(`    ${item.canonicalCategory.padEnd(14)} ${item.instanceLabel}`);
  }

  // --- 2. Contract + plan, exactly as the route builds them ---------------
  const profiles = getProductProfiles(products);
  const resolved = resolveCategoryIntents({
    intents: [
      {
        canonicalCategory: "sofa",
        seatingSelection: [
          { kind: "sofa-3-seater", count: 1, productId: kelly.id, productName: kelly.name },
          { kind: "sofa-3-seater", count: 1, productId: elva.id, productName: elva.name },
        ],
      },
      { canonicalCategory: "coffee-table", productId: aspen.id },
    ],
    sceneGraph,
    catalogue,
    profiles,
    sourceImage: { width: 0, height: 0 },
  });
  if (!resolved?.contract) throw new Error("no contract resolved");
  const plan = contractToReplacementPlan(resolved.contract, profiles);

  /**
   * Do not pay for a render the plan cannot use.
   *
   * Scene analysis is unreliable on this photo — measured 41.8s to 94.8s, and
   * it sometimes returns zero objects even when it completes. A zero-object
   * graph produces ADD tasks only: the sofas get placed rather than replaced,
   * and the coffee table gets no task at all. Rendering that is money spent on
   * a run that cannot be compared.
   */
  const sofas = sceneGraph.furniture.filter(
    (item) => item.canonicalCategory === "sofa"
  ).length;
  const tables = sceneGraph.furniture.filter(
    (item) => item.canonicalCategory === "coffee-table"
  ).length;
  if (sofas < 2 || tables < 1) {
    console.error(
      `\nABORTED before the paid render — detection found ${sofas} sofa(s) and ${tables} coffee table(s); need 2 and 1. Re-run; the analysis call is flaky.\n`
    );
    process.exit(2);
  }
  console.log(`  usable: ${sofas} sofas + ${tables} coffee table`);

  if (process.env.ANALYSE_ONLY === "1") {
    console.log("\nANALYSE_ONLY=1 — stopping before the paid render.\n");
    return;
  }

  // --- 3. References + prompt ---------------------------------------------
  const referenceLoad = await loadProductReferenceImages(products, "[bench]");
  const manifest = buildReferenceManifest({
    loaded: referenceLoad.loaded,
    plan,
    selectedProductIds: products.map((p) => p.id),
    maxReferences: 12,
  });
  const debug = buildGroundingDebugPacket({ plan, manifest });

  console.log(`\nplan          : ${debug.totalTasks} tasks, ${debug.totalProducts} products, ${debug.totalReferenceImages} references`);
  for (const entry of debug.products) {
    console.log(`  ${entry.productId}`);
    console.log(`    tasks ${entry.taskIds.join(",")} | ${entry.referenceViewCount} refs (${entry.referenceViewTypes.join(", ")})`);
    console.log(`    signature: ${entry.signatureTraits.slice(0, 3).join(" | ")}`);
    if (entry.materialComponents.length > 1) {
      console.log(`    materials: ${entry.materialComponents.join(", ")}`);
    }
  }

  const { prompt } = buildIntelligentRoomPrompt({
    roomAnalysis: sceneGraphToRoomAnalysis(sceneGraph),
    profiles,
    style: "modern luxury",
    roomType: "living room",
    aiConceptMode: false,
    replacementPlan: plan,
    referenceViewCount: manifest.transmitted.length,
    sceneGraph,
  });

  // --- 4. The real render --------------------------------------------------
  console.log("\nrendering (real, paid call)...");
  const renderStart = Date.now();
  const image = await renderer.generate({
    prompt,
    roomImage,
    productImages: [],
    labelledProductImages: manifest.transmitted.map((entry) => ({
      label: entry.label,
      file: referenceLoad.loaded.find(
        (loaded) => loaded.productId === entry.productId && loaded.view === entry.viewType
      )!.file,
    })),
    apiKey: renderer.apiKey,
  });
  const renderMs = Date.now() - renderStart;
  console.log(`  ${(renderMs / 1000).toFixed(1)}s`);

  // --- 5. Save -------------------------------------------------------------
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tag = `${renderer.id}-${(process.env.GEMINI_IMAGE_MODEL || process.env.GPT_IMAGE_MODEL || "default").replace(/[^a-z0-9.-]/gi, "")}`;
  await mkdir("data/bench/out", { recursive: true });
  const imagePath = `data/bench/out/${stamp}-${tag}.png`;
  await writeFile(imagePath, Buffer.from(image.imageBase64, "base64"));
  await writeFile(
    `data/bench/out/${stamp}-${tag}.json`,
    JSON.stringify({ renderer: renderer.id, model: process.env.GEMINI_IMAGE_MODEL || process.env.GPT_IMAGE_MODEL || null, renderMs, debug, prompt }, null, 2)
  );
  await writeFile(`data/bench/out/${stamp}-${tag}.prompt.txt`, prompt);

  console.log(`\nimage         : ${imagePath}`);
  console.log(`debug + prompt: data/bench/out/${stamp}-${tag}.json`);
  console.log(`render time   : ${(renderMs / 1000).toFixed(1)}s\n`);
}

main().catch((error) => {
  console.error("\nBENCH FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
