# DEBUG_GUIDE.md — Admin & AI debug tools

Hidden, developer-only tooling for inspecting the pilot and tuning AI quality.
None of it is visible to customers; nothing is sent to any external service.

---

## 1. The admin panel — `?admin=1`

Append `?admin=1` to any Studio URL (e.g.
`https://ai-room-stylist.vercel.app/?admin=1`). A full-screen admin overlay opens.

Always available (no flag needed):
- **Pilot metrics:** generations, quote submits, package opens, leads stored,
  recommendations added/removed.
- **Most selected products** (from local analytics events).
- **Export leads JSON** and **Export analytics JSON**.

Implementation: `AdminPanel` in `KoalaDesignStudio.tsx`; data from
`services/pilot-metrics.ts` (analytics in `localStorage: ai-room-stylist:events`)
and `services/leads.ts` (`localStorage: koala-ai-studio:leads`).

## 2. AI debug mode

The AI evaluation section only appears when **both** are true:

```
?admin=1   AND   ENABLE_AI_DEBUG=true
```

- The server flag is read by `GET /api/ai-debug/status` → `{ enabled: boolean }`.
- On load the Studio fetches this and sets an internal `aiDebugEnabled` flag.
- When enabled, the generate route (`/api/studio/generate-gemini`) includes an
  `aiDebug` payload in its response; when disabled it does not (production stays
  lean, and nothing is logged).

### How to enable
- **Local:** add `ENABLE_AI_DEBUG=true` to `.env.local` (git-ignored) and restart
  `next dev`. (Also needs `GEMINI_API_KEY` for real vision output.)
- **Production/preview:** set `ENABLE_AI_DEBUG=true` in the Vercel project's
  Environment Variables and redeploy. **Keep it `false` for the public pilot.**

## 3. Evaluation logs

For every generation (when debug is on) the client writes an `AiEvalRecord` to
`localStorage: koala-ai-studio:ai-eval-log` (latest 10). Module:
`services/ai-eval-log.ts`.

Each record captures:
- `timestamp`, `roomType`, `style`
- `roomHash` + a tiny `roomThumbnail` (downscaled ~96px JPEG data URL)
- `selectedProducts` (id/name/category)
- `provider`
- **`sceneGraph`** — full structured scene graph (architecture, fixed objects,
  furniture with bounding boxes / confidence / replaceable flags, empty zones)
- `roomAnalysis` — adapted analysis
- `prompt` — the exact dynamic prompt sent to the model
- `imageHash` — hash of the generated image (not the payload)
- `qualityScore` — 5 axes + overall
- `generationAttempts`, `autoRegenerated`, `referenceViewCount`
- `failureReason` (if the generation failed)

Nothing here leaves the browser.

## 4. Quality scores

Shown per generation in the admin AI section as an overall badge (green ≥ 70,
red < 70) plus the five axes: **Room** (preservation), **Prod** (similarity),
**Full** (full-room visibility), **Scale** (furniture scale), **Real** (realism).
See `AI_PIPELINE.md` §5 for definitions and weighting.

## 5. Generation history & how to inspect

In `?admin=1` with debug on, the **AI DEBUG → Generation evaluations** section
lists the latest 10 generations. For each you can see the room thumbnail, quality
axes, provider/attempts (and whether it auto-regenerated), the products used, the
room-analysis summary, and an expandable **Prompt preview**.

## 6. How to export logs

- **Export AI evaluations JSON** (in the AI debug section) → downloads all stored
  eval records, **including the full scene graph and prompt** for each — the
  primary artifact for offline AI-quality analysis.
- **Export leads JSON** / **Export analytics JSON** (always available) for the
  commercial funnel.

## 7. Related generated artifacts (not runtime)

- `npm run intelligence:profiles` → `docs/product-profiles.json` (product
  intelligence database).
- `npm run audit:products` → `docs/product-data-audit.md` (catalogue price/URL/
  dimension coverage).

## 8. Quick tuning loop
1. Set `ENABLE_AI_DEBUG=true` + a valid `GEMINI_API_KEY` (Vercel or local).
2. Run several generations across different rooms/products.
3. Open `?admin=1` → review quality axes + prompt previews.
4. **Export AI evaluations JSON**; adjust `QUALITY_THRESHOLD`, scoring weights, and
   prompt wording; redeploy; repeat.
