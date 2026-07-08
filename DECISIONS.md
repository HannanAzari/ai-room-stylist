# DECISIONS.md — Why, not just what

Architectural decision record. Captures the *reasoning* behind choices so they
aren't re-litigated or accidentally reversed as the project grows.

---

## D1 — Freeze the UI before doing AI work
**Decision:** Lock the customer UI/shopping flow; only the hidden admin/debug panel
may change.
**Why:** The UX and commercial layer reached a pilot-ready, CEO-fundable state
after many focused sprints. AI-quality work is deep backend iteration that can
churn for a long time. Freezing the UI (a) protects a known-good demo, (b) removes
the temptation to "polish" instead of improving the AI, and (c) keeps diffs small
and reviewable. The AI can get dramatically smarter without moving a single pixel.

## D2 — Replacement-planning approach over prompt-only generation
**Decision:** Build structured understanding (scene graph → replacement plan) that
drives generation, rather than relying on one clever text prompt.
**Why:** Prompt-only generation is non-deterministic about *what changes* — it
hallucinates, duplicates, or removes furniture and alters architecture. Treating
the room as **structured data** (objects, boxes, replaceable flags, zones) lets us
tell the model exactly which item becomes which product and where, and what to
leave alone. This is the single biggest lever for consistent, room-preserving,
product-accurate output. (Scene graph = Sprint 1 done; explicit planner = Sprint 2.)

## D3 — Product intelligence lives separately from the prompt builder
**Decision:** `product-profile.ts` derives structured product intelligence; the
prompt builder only *consumes* it.
**Why:** Separation of concerns and testability. The profile layer is a pure,
unit-testable transformation of catalogue data (and the natural insertion point for
a real Koala feed later). The prompt builder stays a thin assembler. Mixing them
would make both harder to test, reuse (e.g. for matching, admin export), and
replace when real feed data arrives. It also lets non-prompt consumers
(recommendations, admin, quality scoring) reuse the same intelligence.

## D4 — Only selected products should be replaced
**Decision:** Replace only the categories of the products the customer selected
(plus, in Concept Mode ON, explicitly-listed complementary items).
**Why:** Trust and predictability. The customer chose specific pieces; silently
restyling the whole room erodes trust and produces unshoppable results (products
that aren't for sale). Constraining changes to selected categories keeps the room
recognisable, keeps every changed item shoppable, and makes the "products used"
package honest. Concept Mode OFF adds nothing at all — a hard guarantee.

## D5 — Architecture and fixed objects must be preserved
**Decision:** Never change walls, windows, doors, ceiling, floor, camera; never
move/remove fixed objects (TV, air conditioner, curtains, radiators, built-ins).
The scene graph's `replaceable` flag enforces this.
**Why:** The core promise is *"your actual room, redesigned"*. If the AI changes the
architecture or removes the customer's wall-mounted TV/AC, the result stops being
*their* room and becomes a generic render — breaking believability and the reason
to buy. Fixed objects are things a customer physically cannot/should not change to
buy furniture, so they must be inviolable. This also anchors perspective, which
keeps furniture scale believable.

## D6 — Commercial flow prioritises "Shop this room" over technical AI details
**Decision:** The result page sells the room (image → shop → products → package →
add to cart). All AI internals (scene graph, prompts, scores, "designer notes")
are hidden behind `?admin=1` + `ENABLE_AI_DEBUG`.
**Why:** The audience is a furniture buyer, not an AI enthusiast. Showing model
internals dilutes the path to purchase and makes it feel like a demo, not a shop.
Every visible element must move the customer toward buying; everything else is
debug tooling. (Earlier versions leaked "AI report" content and implementation
details like "priced & shoppable now" — deliberately removed.)

## D7 — All vision/AI steps are fallback-safe
**Decision:** Scene graph, room analysis and quality scoring each return a safe
default on missing key / failure; generation never hard-blocks on them.
**Why:** Resilience and deployability. Keys rotate, vision calls fail or time out,
and the pilot must keep working. Fallback-safe design means the app degrades to
"prompt + product references" rather than erroring, and we can ship the
infrastructure before the vision layer is fully tuned/keyed.

## D8 — Gemini-only for the Studio (OpenAI kept only for the legacy app)
**Decision:** The canonical Studio uses Gemini (`2.5-flash-image` for images,
`2.5-flash` for vision); the legacy `RoomStylistApp` retains the OpenAI hybrid path.
**Why:** One provider for the live product keeps the pipeline, cost, and prompt
tuning coherent, and Gemini's image-edit + vision combo suits room-preserving edits
and structured analysis. Keeping OpenAI only in the unrouted legacy path avoids a
risky rip-out while not complicating the shipping product.

## D9 — Never fabricate commercial catalogue data
**Decision:** Price, URL and dimensions are only ever real (verified) or null.
Derived "intelligence" (profiles, prompt fragments) is clearly separate and never
written back as if it were feed data.
**Why:** A furniture pilot's credibility dies the moment it shows a made-up price
or a dead product link. Honest "Pricing available on product pages" is trustworthy;
a fabricated number is not. (This is also why only 11 hero products are priced —
those were individually verified against koalaliving.com.au.)

## D10 — Local-only persistence for the pilot (leads/analytics/eval logs)
**Decision:** Store leads, analytics and AI eval logs in `localStorage`; no backend
datastore yet.
**Why:** Speed to a demonstrable pilot without standing up infrastructure. It's
enough to prove the funnel and tune the AI. The conscious debt: data isn't
aggregated or durable — the first backend sprint replaces this (see ROADMAP
"Backend"). Documented so it isn't mistaken for a finished lead pipeline.

## D11 — Compute product profiles at runtime (not baked into products.json)
**Decision:** Derive profiles on the fly (cached per process); export a snapshot to
`docs/product-profiles.json` only for inspection.
**Why:** Keeps the catalogue as the single source of truth and avoids stale/derived
data drifting out of sync. When a real feed lands, the enriched fields come from the
feed and the heuristics fall away — no migration of baked-in guesses needed.

## D12 — Keep `KoalaDesignStudio.tsx` monolithic for now
**Decision:** Tolerate the ~2900-line component rather than refactor it mid-flight.
**Why:** It works, it's frozen, and a refactor is pure risk with no customer value
during the AI-quality phase. Decomposition is deferred to a dedicated cleanup
sprint (only if a real need arises), to avoid destabilising a known-good UI.
