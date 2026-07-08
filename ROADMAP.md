# ROADMAP.md — Koala AI Design Studio

Status legend: ✅ done · 🟡 partial / infra-only · ⬜ not started.
Organised by track. See `NEXT_SPRINT.md` for the sequenced next sprints.

Current position: **commercial + UX pilot shipped; AI infrastructure built;
AI quality tuning + backend persistence outstanding.** HEAD `070d9c5` on `main`,
deployed to `ai-room-stylist.vercel.app`.

---

## UI  (FROZEN — do not extend)

- ✅ Canonical Studio at `/` (retired legacy long-scroll app)
- ✅ Premium "Option C" dark visual system (atmospheric, layered, warm bronze accent)
- ✅ 3-step flow: Capture · Design · Shop
- ✅ Capture: photo-hero, overlay Retake/Change, fits mobile without scroll
- ✅ Design: AI-suggested room/style with "Change", Netflix-style product shelves,
  AI Concept toggle, Featured Collection
- ✅ Result: single vertical page (hero → Shop this room → slim toolbar → products
  → package summary → recommended additions)
- ✅ Meaningful progress + consistent header; premium micro-interactions
- ⬜ (Future, only if needed) decompose the ~2900-line `KoalaDesignStudio.tsx`

## Backend

- ✅ Studio generation route (`/api/studio/generate-gemini`) — generation + refine
- ✅ AI debug status endpoint (`/api/ai-debug/status`)
- 🟡 Persistence: leads / analytics / AI eval logs are **localStorage only**
- ⬜ Real backend datastore for leads + analytics + eval logs
- ⬜ Lead delivery to CRM / email (currently local + `quote_submitted` event only)
- ⬜ Server-side result caching (avoid re-billing on refine/regenerate)
- ⬜ Rate limiting / per-session cost caps on generation endpoints

## AI

- ✅ Product intelligence profiles (Phase 1)
- ✅ Multiple reference-image resolution (Phase 2) — infra; awaits real views
- ✅ Room understanding + **Scene Graph** (Phase 3 / Sprint 1)
- ✅ Dynamic prompt builder — room preservation, fixed-object protection,
  selected-category replacement, concept mode (Phase 4, tuned)
- ✅ Quality scoring (5 axes) + auto-regeneration (Phase 5)
- ✅ Dev-only AI evaluation logger + admin debug view
- 🟡 **Live tuning not done** — vision steps need a valid `GEMINI_API_KEY` in Vercel
- ⬜ **Replacement Planner** (Sprint 2) — explicit item→product swap plan
- ⬜ **Generation Pipeline V2** (Sprint 3) — put refine on the pipeline, masks/inpainting
- ⬜ **AI Quality Reviewer V2** (Sprint 4) — richer scoring + targeted re-prompting

## Product Data

- ✅ 55-product catalogue with local images (`main.jpg` each)
- ✅ 11 hero products with **verified real price + product URL** (koalaliving.com.au)
- ✅ Honest missing-data handling (no fabricated price/URL)
- ✅ Catalogue audit + product-intelligence-database generators
- ⬜ **Real Koala product feed** (full catalogue price/stock/URL/dimensions/tags)
- ⬜ Multiple real reference views per product
- ⬜ Richer style tags (currently most products share `modern luxury`)

## Commercial

- ✅ Shoppable result: products used, package subtotal/saving/total, add-to-cart CTA
- ✅ Quote / lead capture sheet (name/email/phone/postcode/contact/notes)
- ✅ Per-product "View on Koala" deep-links
- ✅ Recommended additions ("Complete the room")
- ✅ Pilot metrics + JSON exports (admin)
- ⬜ Real cart integration (deep-link into Koala's cart) or funded lead pipeline
- ⬜ Financing / price framing, saved rooms, remarketing

## Production

- ✅ Deployed to Vercel from GitHub `main` (auto-deploy), healthy
- ✅ Premium branding/metadata, Node-20 build, secret-free repo
- ⬜ `GEMINI_API_KEY` + `ENABLE_AI_DEBUG` configured in Vercel for AI tuning
- ⬜ Rotate any previously-exposed keys (operational reminder)
- ⬜ Analytics wired to a real destination + funnel dashboard
- ⬜ Move `/ops` (KoalaOps) to its own project

---

## Completed sprints (history)
1. P0 cleanup for pilot-ready Studio
2. Commercial spine (package pricing + quote)
3. AI interior consultant (recommendations + quote context)
4. Premium experience redesign → V2 experience redesign
5. Mobile polish series (capture, result flow, action bar, shelves, summary)
6. Product intelligence pipeline
7. AI quality tuning (eval logger, debug view, tuned prompts/scoring)
8. Scene graph for room understanding

## Next milestones (sequenced in `NEXT_SPRINT.md`)
- **Sprint 2:** Replacement Planner
- **Sprint 3:** Generation Pipeline V2
- **Sprint 4:** AI Quality Reviewer V2
- **Parallel track (whenever data is available):** real Koala product feed +
  backend persistence + lead delivery.
