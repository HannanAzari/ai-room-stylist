# AI_PIPELINE.md — The Koala AI generation pipeline

End-to-end pipeline that turns a customer's room photo + selected products into a
room-preserving, product-accurate redesign. Orchestrated by
`src/app/api/studio/generate-gemini/route.ts` (`handleGeneration`).

```
Room Photo
   ↓
Scene Analysis (Scene Graph)
   ↓
Product Intelligence (profiles + reference images)
   ↓
Prompt Builder (dynamic, per-request)
   ↓
Generation (Gemini image)
   ↓
Quality Scoring (5 axes)
   ↓
Auto Regeneration (if below threshold)
   ↓
Result (best attempt) + debug payload
```

**Design principle:** every vision/AI step is **fallback-safe**. If
`GEMINI_API_KEY` is missing or a call fails, the step returns a sensible default
and generation still completes. No step can hard-block a generation.

---

## Stage 0 — Request intake
`handleGeneration(req)` parses the multipart form: room `image`, `style`,
`roomType`, `aiConceptMode`, `selectedProductIds`, optional room measurements.
Validates image type (JPEG/PNG/WebP; HEIC rejected with guidance). Resolves the
product set: selected products, plus (in concept mode) style-matched
complementary products, merged & capped at 6.

## Stage 1 — Scene Analysis (Scene Graph)
**Module:** `src/lib/intelligence/scene-graph.ts` — `analyzeSceneGraph(image, {apiKey, roomTypeHint})`

Vision call (`gemini-2.5-flash`) that returns structured room understanding:
`roomType, camera, walls, floor, ceiling, windows, doors, fixedObjects[],
furniture[], emptyWalls[], emptyFloorAreas[], lighting, palette`.

Each **furniture object**: `id, category, boundingBox (0–1), approximateDepth,
orientation, dominantColor, material, size, replaceable, confidence`.
Each **fixed object**: `{ name, confidence }`.

- **Does not guess:** the prompt instructs the model to only include visible
  objects and give a confidence for each; the parser clamps confidences and drops
  category-less entries.
- **Replaceable enforcement:** `isReplaceableCategory()` overrides the model so
  TV / air conditioner / curtains / windows / doors / built-ins are always
  `replaceable=false`; sofa / rug / coffee table / chairs / lamps are `true`.
- `sceneGraphToRoomAnalysis(sceneGraph)` adapts the graph to the simpler
  `RoomAnalysis` shape the prompt builder consumes (marking fixed items `[fixed]`).
- **Fallback:** `defaultSceneGraph(roomTypeHint)` (`analysed: false`).

Related: `src/lib/intelligence/room-analysis.ts` holds the `RoomAnalysis` type,
`defaultRoomAnalysis()`, and a standalone `analyzeRoom()` (superseded by the scene
graph in the studio route but still available).

## Stage 2 — Product Intelligence
**Modules:** `product-profile.ts`, `product-references.ts`
(full detail in `PRODUCT_INTELLIGENCE.md`).

- `getProductProfiles(products)` → a `ProductProfile` per product (style, colour,
  materials, finish, shape, silhouette, legs/base, texture, tags, room types,
  `promptFragment`, `negativePrompt[]`, `replacementRules[]`, `matchingProducts[]`).
- `loadProductReferenceImageFiles(products)` → up to 3 reference views per product,
  8 total, resolved via `getProductReferenceViewUrls()` (main/front/45/side/
  lifestyle/detail). Fed to the image model as visual ground truth.

## Stage 3 — Prompt Builder
**Module:** `src/lib/intelligence/prompt-builder.ts` — `buildIntelligentRoomPrompt(input)`

Assembles a **dynamic, per-request prompt** (no generic template). Inputs: scene
graph, room analysis, product profiles, style, room type, concept mode, selected
ids, measurements, reference count. Produces `{ prompt, negativePrompt[] }`.

The prompt encodes the tuned rules:
- Keep the **entire room in frame** — no crop/zoom/reframe.
- Preserve camera, walls, windows, doors, ceiling, floor exactly.
- **KEEP THESE FIXED OBJECTS** (TV/AC/curtains + non-replaceable furniture from
  the scene graph); list replaceable existing pieces that may be swapped.
- **Replace only the selected products' categories**; everything else stays.
- Concept mode **ON** → add only listed complementary Koala items;
  **OFF** → change only selected products, add nothing.
- Product fidelity (match colour/material/finish/shape/silhouette/base), placement
  & scale, material/lighting/perspective fidelity, and an aggregated `AVOID:` list.

## Stage 4 — Generation
**Module:** `src/features/room-stylist/services/image-providers/gemini.ts` —
`generateGeminiImage({ prompt, roomImage, productImages, apiKey })`

Calls Gemini `gemini-2.5-flash-image` with the room photo (fixed reference) +
product reference images + the built prompt. Returns `{ provider, imageBase64,
mimeType, ... }`. The Studio is **Gemini-only** (asserted in `studio-gemini-api.ts`).

## Stage 5 — Quality Scoring
**Module:** `src/lib/intelligence/quality-score.ts` — `scoreRoomImage(input)`

Vision call that scores the generated image (0–100) against the original room on
**five explicit axes**:
- `roomPreservation` — walls/windows/doors/ceiling/floor/camera preserved
- `productSimilarity` — placed products match the intended products
- `fullRoomVisible` — whole room visible (penalises cropping/zoom)
- `furnitureScale` — realistic proportions and clearances
- `realism` — photorealism, believable lighting, no artefacts

`computeOverall()` weights room fidelity + framing highest
(roomPreservation .30, fullRoomVisible .22, realism .20, furnitureScale .16,
productSimilarity .12). **Fallback:** returns `null` (scoring unavailable →
non-blocking).

## Stage 6 — Auto Regeneration
In the route: up to `MAX_GENERATION_ATTEMPTS = 2`. Generate → score → if
`meetsQualityThreshold(score)` (overall ≥ `QUALITY_THRESHOLD = 70`, or score is
`null`) accept; otherwise regenerate once. The **best attempt by overall score**
is returned. Bounded to keep latency/cost predictable.

## Stage 7 — Result + debug payload
Response always includes `{ images, imageBase64, products }` (the frozen UI
contract). When `ENABLE_AI_DEBUG=true`, an `aiDebug` object is added:
`{ provider, sceneGraph, roomAnalysis, qualityScore, generationAttempts,
autoRegenerated, prompt, negativePrompt, referenceViewCount }`. The client logs
this into the AI evaluation log (see `DEBUG_GUIDE.md`).

---

## Module responsibility map

| Module | Responsibility |
|---|---|
| `intelligence/scene-graph.ts` | Structured room understanding + replaceable classifier + RoomAnalysis adapter |
| `intelligence/room-analysis.ts` | `RoomAnalysis` type, defaults, standalone analyzer |
| `intelligence/product-profile.ts` | Per-product AI profile derivation + matching |
| `intelligence/product-references.ts` | Multi-view reference URL resolution |
| `intelligence/prompt-builder.ts` | Dynamic prompt + negative prompt assembly |
| `intelligence/quality-score.ts` | 5-axis scoring, weighting, threshold |
| `lib/product-image-references.ts` | Loads reference image files from `/public` |
| `lib/prompts.ts` | Base prompt fragments (room preservation, scale) |
| `services/image-providers/gemini.ts` | Gemini image generation call |
| `api/studio/generate-gemini/route.ts` | **Orchestrator** (generation + refinement) |

## Refinement path
`handleRefinement` (JSON body) refines an existing concept from a text change
request + optional product swaps, preserving framing/architecture. Not yet on the
full intelligence pipeline — a candidate for Generation Pipeline V2.

## What to tune first (once a live key is set)
1. `QUALITY_THRESHOLD` and `computeOverall()` weights against real scores.
2. Prompt wording in `prompt-builder.ts` (crop/architecture adherence).
3. Scene-graph prompt precision (bounding boxes, replaceable accuracy).
