# NEXT_SPRINT.md — Read me first

You are continuing the Koala AI Design Studio. **Read `CTO_HANDOFF.md` next** for
full context. This file is the agreed sprint sequence for the AI-quality track.

## Hard constraints (apply to every sprint below)
- **UI is FROZEN.** Do not redesign or add customer UX. The only allowed UI touch
  is the hidden `?admin=1` debug panel.
- **Do not break the response contract** the Studio expects:
  `{ images, imageBase64, products }` (extra fields are fine).
- Every new AI/vision step must be **fallback-safe** (works with no `GEMINI_API_KEY`).
- Node 20 for lint/build. Push via the `store` credential helper. Verify Vercel.

## Where we are
- **Sprint 1 — Scene Graph: ✅ DONE** (`src/lib/intelligence/scene-graph.ts`,
  wired into `/api/studio/generate-gemini`, persisted to the eval log).
- **Next to start: Sprint 2 — Replacement Planner.**

---

## Sprint 2 — Replacement Planner

**Goal:** Convert the scene graph + selected products into an explicit
*replacement plan* before prompting: for each replaceable item in the room, decide
which selected/complementary product replaces it and where; for each product with
no existing counterpart, decide the placement zone. Fixed objects are never
touched. This makes generation deterministic about *what changes*, reducing
hallucinated/duplicated furniture.

**Architecture:**
- Pure planner module (no vision call) consuming `SceneGraph` + `ProductProfile[]`
  + `selectedProductIds` + `aiConceptMode` → a `ReplacementPlan`.
- Plan shape (suggested): `{ replacements: [{ existingItemId, existingCategory,
  productId, placement, boundingBox? }], additions: [{ productId, zone }],
  preserved: [fixedObjectNames] }`.
- Match products to existing furniture by category + colour/material affinity
  (reuse `product-profile` matching + scene-graph `replaceable` flags + bounding
  boxes for placement hints).
- `prompt-builder.ts` gains an optional `replacementPlan` and renders an explicit
  numbered "REPLACEMENT PLAN" section instead of / in addition to the current
  category-scope text.

**Expected files:**
- `src/lib/intelligence/replacement-planner.ts` (new)
- edits: `prompt-builder.ts` (consume the plan), `api/studio/generate-gemini/route.ts`
  (build plan, pass to prompt, add to `aiDebug`), `ai-eval-log.ts` (persist plan).

**Acceptance criteria:**
- Given a scene graph + products, the planner returns a deterministic plan with no
  fixed object in `replacements`/`additions`.
- Prompt contains an explicit item-by-item replacement plan.
- Plan appears in the exported AI evaluation JSON.
- `npm run lint` + `npm run build` pass; unit-test the planner via `tsx`.

**Potential risks:**
- Bounding boxes from the model may be noisy → treat placement as guidance, not
  hard constraint. Keep the planner robust to empty/low-confidence scene graphs
  (fall back to category-based placement).
- Don't over-constrain the image model (leave room for realistic composition).

---

## Sprint 3 — Generation Pipeline V2

**Goal:** Raise fidelity and put **refinement on the same intelligence pipeline** as
generation. Explore region/mask-guided edits so only replaceable areas change.

**Architecture:**
- Unify `handleGeneration` and `handleRefinement` around a shared pipeline that
  takes `{ roomImage, sceneGraph, plan, profiles, references, prompt }`.
- Investigate mask/inpainting-style prompting (or provider features) using scene
  graph bounding boxes to constrain edits to replaceable regions.
- Optional multi-candidate generation (N images) with scoring-based selection
  (still returning one to the frozen UI, but logging the alternatives).

**Expected files:**
- `src/lib/intelligence/generation-pipeline.ts` (new orchestration helper)
- edits: `api/studio/generate-gemini/route.ts` (both handlers use it),
  `image-providers/gemini.ts` (mask/region support if feasible).

**Acceptance criteria:**
- Refinement uses scene graph + plan + profiles (not the old static prompt).
- Region/mask approach prototyped or a clear written finding on provider limits.
- Contract unchanged; fallback-safe; lint + build pass.

**Potential risks:**
- `gemini-2.5-flash-image` may not support true masks/inpainting — validate early;
  if unsupported, achieve region focus via prompt + reference framing instead.
- Latency/cost of multi-candidate generation — keep bounded and behind the debug flag.

---

## Sprint 4 — AI Quality Reviewer V2

**Goal:** Turn scoring into an actionable reviewer: not just a number, but a
structured critique that drives a **targeted re-prompt** (fix the specific failure)
rather than a blind regenerate.

**Architecture:**
- Extend `quality-score.ts` (or add `quality-reviewer.ts`) to return, alongside the
  5 axes, a `issues: [{ axis, severity, note, fixHint }]` list.
- The route uses `fixHint`s to append corrective instructions to the prompt on the
  retry (e.g. "the left wall was altered — restore it"), instead of re-running the
  same prompt.
- Tune `QUALITY_THRESHOLD` + `computeOverall` weights against real exported evals.

**Expected files:**
- `src/lib/intelligence/quality-reviewer.ts` (new) or extended `quality-score.ts`
- edits: `api/studio/generate-gemini/route.ts` (corrective retry loop),
  `ai-eval-log.ts` (persist issues), admin section may show issues (debug UI only).

**Acceptance criteria:**
- Reviewer returns structured issues + fix hints; retry uses them.
- Thresholds/weights calibrated from ≥ a handful of real generations.
- Fallback-safe; contract unchanged; lint + build pass.

**Potential risks:**
- Reviewer hallucinating issues → keep it conservative, cap corrective retries
  (still ≤ 2 total generations to bound cost).
- Requires live vision + real test data to calibrate meaningfully.

---

## Cross-cutting prerequisite (do this before/with Sprint 4 tuning)
Set **`GEMINI_API_KEY`** (valid) and **`ENABLE_AI_DEBUG=true`** in Vercel, run real
generations, and use `?admin=1` → **Export AI evaluations JSON** to calibrate. Until
then, all of the above is built and testable deterministically but unproven on
real output.

## Do not start any sprint from this file automatically.
Wait for the operator to choose the sprint. Then implement only that sprint,
validate (lint/build, `tsx` unit tests, admin verification where possible), and
ship (commit → push → confirm Vercel).
