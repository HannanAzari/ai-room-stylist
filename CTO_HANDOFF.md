# CTO Handoff — Koala AI Design Studio

> Read this first, then `NEXT_SPRINT.md`. This document is the single source of
> truth for a new session to continue development with full context.
> Last updated at commit `070d9c5` (branch `main`, deployed to production).

---

## 1. Project vision

Koala AI Design Studio is an **AI shopping designer** for Koala Living (an
Australian furniture retailer). The customer photographs their real room, the AI
redesigns it using **real Koala products while preserving the actual room**, and
the result is a **shoppable room package** that leads the customer toward
purchase.

It is **not** a room-placement tool (Koala already has a 3D Room Designer). The
positioning is: *"Let AI design your room and help you buy."* The experience must
feel like Apple / Airbnb / Arc / Linear — calm, premium, minimal — not an AI demo.

## 2. Current MVP goals

1. Generate a believable, room-preserving redesign using real Koala products.
2. Present it as a **shoppable package** (products used → price/total → add to cart).
3. Capture **leads** (quote requests) — the pilot's headline conversion metric.
4. Prove it with a **pilot demo** a furniture CEO would fund.

Status: the **commercial + UX layer is pilot-ready and deployed**. The **AI quality
layer is built as infrastructure** and awaits live tuning with a valid vision key.

## 3. Architecture overview

- **Framework:** Next.js 16 (App Router) + React + TypeScript + Tailwind v4.
- **Runtime:** Node 20 required (the machine default is Node 16 and will break
  builds — see §10).
- **Rendering:** the Studio is a single large client component; API routes are
  server functions.
- **Image generation:** Gemini `gemini-2.5-flash-image` for the Studio; the legacy
  app also has an OpenAI `gpt-image-1` hybrid path.
- **Vision understanding & scoring:** Gemini `gemini-2.5-flash` (text+vision).
- **Persistence:** none server-side yet. Leads, analytics and AI eval logs live in
  the browser's `localStorage`. Product catalogue is a static JSON file.
- **Deploy:** GitHub `main` → Vercel auto-deploy. Production
  **https://ai-room-stylist.vercel.app**.

### Three apps in one repo
| Route | Component | Status |
|---|---|---|
| `/` and `/studio` | `KoalaDesignStudio.tsx` | **Canonical** customer app |
| (unrouted) | `RoomStylistApp.tsx` | **Legacy** long-scroll app, kept for reference, not routed |
| `/ops` | KoalaOps (`features/ops/*`) | Internal tools prototype — **out of scope**, do not surface to customers |

## 4. Folder structure (the parts that matter)

```
src/
  app/
    page.tsx                     # renders KoalaDesignStudio (canonical /)
    studio/page.tsx              # also renders KoalaDesignStudio
    layout.tsx                   # metadata, fonts
    globals.css                  # Option C visual system (v2-* classes)
    api/
      studio/generate-gemini/route.ts   # ⭐ Studio generation + refinement pipeline
      ai-debug/status/route.ts           # exposes ENABLE_AI_DEBUG flag to client
      generate-room/route.ts             # legacy app generation (OpenAI+Gemini)
      refine-room/route.ts               # legacy refinement
      inventory|logistics|ops-*|support  # KoalaOps (out of scope)
  components/studio/
    KoalaDesignStudio.tsx        # ⭐ the entire customer UI (~2900 lines) — FROZEN
    studio-gemini-api.ts         # client fetch wrapper (Gemini-only assertion)
  features/room-stylist/
    services/
      ai-eval-log.ts             # dev-only AI evaluation logger (localStorage)
      leads.ts                   # lead capture model + store (localStorage)
      pilot-metrics.ts           # admin metrics from analytics events
      analytics-events.ts        # trackXxx() event helpers
      room-consultant.ts         # palette/mood/budget/recommendations/rationale
      product-helpers.ts         # pricing, category labels, product lookups
      image-upload.ts            # HEIC handling, normalisation, validation
      image-providers/gemini.ts  # Gemini image generation call
      generated-concepts.ts      # normalise provider responses
  lib/
    products.ts                  # Product type + catalogue accessors
    prompts.ts                   # base prompt fragments (room preservation, scale)
    product-image-references.ts  # loads product reference images from /public
    openai*.ts                   # OpenAI client + image provider (legacy path)
    intelligence/                # ⭐ AI intelligence layer (see AI_PIPELINE.md)
      scene-graph.ts             # structured room understanding
      room-analysis.ts           # simpler room analysis + adapter target
      product-profile.ts         # per-product AI profile derivation
      product-references.ts      # multi-view reference resolution
      prompt-builder.ts          # dynamic prompt assembly
      quality-score.ts           # generated-image quality scoring
  data/products.json             # 55-product catalogue
  scripts/                       # build-product-profiles, audit-product-data, scrapers
docs/
  product-profiles.json          # generated product-intelligence database
  product-data-audit.md          # generated catalogue coverage report
```

## 5. AI generation pipeline (summary — full detail in `AI_PIPELINE.md`)

```
Room photo → Scene Graph → (adapt to Room Analysis) → Product Profiles
          → Prompt Builder → Gemini generation → Quality Score
          → auto-regenerate if below threshold → best result
```
Every vision step (scene graph, quality score) is **fallback-safe**: with no key
or on failure it degrades and generation still proceeds.

## 6. Product intelligence pipeline (summary — full detail in `PRODUCT_INTELLIGENCE.md`)

Each catalogue product is turned into a rich `ProductProfile` (style, colour,
materials, finish, shape, silhouette, legs/base, texture, tags, room types, a
prompt fragment, negative prompts, replacement rules, and matching products).
Derived deterministically at runtime; also exported to `docs/product-profiles.json`
via `npm run intelligence:profiles`. **No commercial data is ever fabricated.**

## 7. Current generation flow (customer path)

1. **Capture** — upload/take a room photo (HEIC handled; photo becomes the hero).
2. **Design** — AI-suggested room type + style (with "Change"), Netflix-style
   product shelves, AI Concept toggle, Featured Collection. → "Generate my room".
3. **Shop (result)** — single vertical page: hero image → "Shop this room" →
   slim icon toolbar (Edit/Regenerate/Save/Share/Delete) → Products used →
   Room package summary + "Add room package to cart" → Recommended additions.
   "Add room package to cart" opens the **quote/lead sheet**.

## 8. Admin / debug tools (full detail in `DEBUG_GUIDE.md`)

- **`?admin=1`** opens a hidden admin panel: pilot metrics, most-selected
  products, and **Export leads / analytics JSON**.
- With **`ENABLE_AI_DEBUG=true`**, the panel adds an **AI evaluations** section:
  latest 10 generations with room/scene analysis, products, quality scores,
  prompt preview, and **Export AI evaluations JSON**.

## 9. Environment variables

| Var | Purpose | Notes |
|---|---|---|
| `GEMINI_API_KEY` | Studio image generation + all vision (scene graph, quality) | **Required** for the Studio to generate |
| `ENABLE_GEMINI_IMAGE` | Enables Gemini in the legacy hybrid path | `true`/`false` |
| `OPENAI_API_KEY` | Legacy app image generation (`/api/generate-room`) | Not used by the canonical Studio |
| `ENABLE_AI_DEBUG` | Exposes AI debug tooling in `?admin=1` | Keep **`false` in production** |

`.env.example` holds placeholders only. `.env.local` is git-ignored (never commit keys).

## 10. Production deployment process

1. `npm run lint` and `npm run build` **using Node 20** (`nvm use 20`). The default
   shell Node is 16 and will fail the build (`structuredClone` / Next 16 needs 20+).
2. Commit; push to `main`.
3. **Push auth quirk:** the macOS Keychain credential helper **hangs** in headless
   shells. Push with the `store` helper:
   `git -c credential.helper= -c credential.helper=store push origin main`.
4. Vercel auto-deploys `main` to production. Verify status via the GitHub
   deployments/commit-status API, and check `https://ai-room-stylist.vercel.app`.
5. Deployment-specific `*.vercel.app` URLs 302-redirect (deployment protection);
   the canonical public URL is `ai-room-stylist.vercel.app`.

## 11. Known limitations

- **Vision steps need a valid `GEMINI_API_KEY`** set in Vercel. They were built
  fallback-safe and unit-tested, but **not exercised with a live key** — real
  output quality is unproven until tuned against real generations.
- **No backend persistence.** Leads, analytics and AI eval logs are `localStorage`
  only — cleared per browser, not aggregated.
- **No real cart integration.** "Add room package to cart" opens the quote/lead
  sheet; per-product "View on Koala" deep-links go to the live store.
- **Only 11 / 55 products are priced** (verified hero set from koalaliving.com.au).
  The rest show honest "Pricing available on product pages".
- **Single generated concept** per request (no multi-variant grid on the Studio).
- **Product reference images:** only `main.jpg` exists per product; multi-view
  (front/45/side/lifestyle/detail) support is built but has nothing to load yet.

## 12. Technical debt

- `KoalaDesignStudio.tsx` is a ~2900-line client component (all state + all UI).
  It is **frozen**; do not extend it. If it must change, decompose first.
- Two generation paths (`generate-room` legacy + `studio/generate-gemini`). Only
  the studio path is on the intelligence pipeline. Legacy path is stale.
- `/ops` (KoalaOps) is unrelated internal tooling living in the same repo/build.
- Product profiles are recomputed at runtime (cached in-memory per process); fine
  for now, but a real feed should persist enriched fields on the products.

## 13. Current branch / deployment status

- Branch: **`main`** (only branch). HEAD `070d9c5`.
- Production: **deployed & healthy** (HTTP 200) at `ai-room-stylist.vercel.app`.
- Working tree: clean.

## 14. Current UI state

**FROZEN.** The customer experience is complete and pilot-ready: 3-step flow
(Capture · Design · Shop), premium "Option C" dark visual system, single-page
shoppable result, quote/lead capture. Do not redesign or add UX features. The
only permissible UI touch is the hidden admin/debug panel.

## 15. Current AI state

**Infrastructure complete, tuning pending.** Built: scene graph, product
intelligence profiles, multi-view references, dynamic prompt builder (room
preservation, fixed-object protection, selected-category replacement, concept
mode), quality scoring (5 axes) with auto-regeneration. All fallback-safe. Needs a
live `GEMINI_API_KEY` in Vercel to actually run vision + be tuned against real output.

## 16. Outstanding bugs

- None known/blocking. Lint + build are green.
- **Unverified (not a bug yet):** live vision output quality, threshold calibration,
  and prompt effectiveness are untested against real generations.

## 17. Next recommended sprint

**Sprint 2 — Replacement Planner** (Scene Graph = Sprint 1 = done). Turn the scene
graph into an explicit plan of *which existing items to replace with which
products, where*, before prompting. See `NEXT_SPRINT.md` for the full agreed
roadmap (Replacement Planner → Generation Pipeline V2 → AI Quality Reviewer V2).

---

### Companion documents
- `NEXT_SPRINT.md` — agreed sprint plan (read after this).
- `ROADMAP.md` — full roadmap by track (UI/Backend/AI/Data/Commercial/Production).
- `AI_PIPELINE.md` — every AI stage and module.
- `PRODUCT_INTELLIGENCE.md` — profiles, references, matching, negatives, rules.
- `DEBUG_GUIDE.md` — `?admin=1`, AI debug, eval logs, exports.
- `DECISIONS.md` — *why* the key architectural choices were made.
