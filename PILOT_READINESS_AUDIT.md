# Koala AI Design Studio — Pilot Readiness Audit

**Auditor role:** Lead Product Designer / CTO / Senior FE / UX Researcher / AI Product Architect
**Date:** 2026-07-07
**Verdict up front:** Promising engine, unshippable shopfront. The AI pipeline is genuinely good. The commercial layer — the entire reason a furniture CEO would fund this — is currently **fake**. **I would not fund it today.** I would fund it in ~2 focused weeks of work. Details below, nothing softened.

---

## 0. What this product actually is right now

There are **two parallel apps** in one repo, ~3,400 lines of overlapping UI:

| Route | Component | Lines | State |
|---|---|---|---|
| `/` (default) | `RoomStylistApp` | 1,443 | Old long-scroll, dark, everything on one page |
| `/studio` | `KoalaDesignStudio` | 1,975 | Newer mobile-first wizard, premium gold palette |
| `/ops` | KoalaOps (inventory/logistics/support/brain) | — | Internal-tools prototype, **out of scope** for a shopping product |

**The single most damaging fact in the whole audit:** the *better* experience (`/studio`) is hidden, and `/` — the first thing anyone types — serves the *weaker* one. A CEO clicking your link lands on the worst version you built.

---

## PHASE 1 — Scored Audit (1–10)

Scores are for the product a customer actually reaches today (the `/` app), with `/studio` noted where it changes the picture.

### Business & Commercial value — **2/10** 🔴
The premise is "design your room and **help you buy**." You cannot buy anything.
- **0 of 55 products have a price** (`price: null` across the entire catalog).
- **0 of 55 products have a working URL** (`url: ""` everywhere). "View product" links go nowhere.
- Cart is a fake toast: *"added to demo cart."* No cart, no total, no checkout, no handoff.
- The "Suggested bundle" advertises **"10% off full room package"** but **never shows a bundle total or a dollar saving** — the one number that drives AOV is absent.
This isn't "needs polish." The commercial spine does not exist. This is the P0 of P0s.

### AI Workflow & Architecture — **7.5/10** 🟢
Genuinely the strongest part.
- Hybrid **OpenAI `gpt-image-1` + Gemini `2.5-flash-image`** with graceful fallback and provider warnings.
- **Product reference images are injected** into the edit call — real product-aware generation, not just a text prompt.
- Structured, well-decomposed prompt builder (`prompts.ts`): room preservation, scale instructions, category placement, concept-mode ON/OFF. This is above the bar for most pilots.
- Refinement is iterative and appends new concepts. Good.
Losing points for: no image caching (every refine re-bills), no cost/latency guardrails, no evaluation of output quality, dimensions leaned on heavily but only 15/55 products have them.

### Visual Design (studio) — **6.5/10** 🟡 / (root) — **4/10** 🔴
`/studio` has a coherent premium direction: near-black `#050505/#111`, gold accent `#F4C430`, generous radius, real step previews. It's the right instinct.
The root app is generic dark-SaaS: flat neutrals, no accent, `font-serif` headings that **fall back to Times New Roman** because no serif font is ever loaded. For a brand claiming "Apple / Airbnb / luxury," shipping headings in Times is a tell that undermines the whole promise.

### Typography — **3/10** 🔴
- Body font is literally `Arial, Helvetica, sans-serif` (untouched create-next-app default in `globals.css`).
- `font-serif` used on every hero heading with **no serif font family defined** → browser default serif.
- No type scale, no font loading strategy (`next/font` unused). This is the cheapest, highest-perception fix available.

### UX / Flow — **6/10** 🟡
- `/studio` wizard (upload → room type → style → products → result) is the correct model and well-sequenced.
- Root app dumps upload, room type, style, 3 dimension inputs, and a 10-category product accordion onto one screen — cognitively heavy, not "calm."
- Both share solid touches: cached last result, HEIC handling, lightbox, native share, escape-to-close, `aria` on accordions.

### Navigation — **4/10** 🔴
No nav, no way to move between `/` and `/studio`, no back-to-home, no clear "start over" hierarchy. Two products, zero wayfinding.

### Trust & Credibility — **3/10** 🔴
- The **"Design Confidence" card is fabricated**: "Scale realism: Good", "Room fit: Good" are hardcoded strings, badged "Demo score." A retail CEO will read this as dishonest instrumentation, not a feature. Either make it real or delete it.
- Footer admits "prototype … for demonstration." Fine internally, fatal on a customer pilot.

### Loading / Progress — **7/10** 🟢
Rotating step messages, skeleton with luxury pulse, spinner rings. Actually nice. Slightly over-animated (`luxuryPulse` glow) but on-brand.

### Iconography — **3/10** 🔴
Buttons render the literal **letter "X"** for close ("X Close", "X Clear concepts"), and `♥/♡` unicode for favourites. No icon system. Reads as unfinished.

### Product Discovery — **3/10** 🔴
- **All 55 products carry a single style tag: `"modern luxury"`.** So `getProductsForStyle()` returns products only for that one style; the other four styles ("warm neutral", "minimal", "hotel style", "family living") match **nothing** — complementary suggestions silently come back empty. The style picker is largely decorative.
- No search, no filter by price/room/colour, no "why this was suggested."

### Code Quality / Maintainability — **4/10** 🔴
- Two 1,400–2,000 line "god components" holding all state and all JSX.
- Heavy duplication between the two apps (product accordion, sheets, refine flow copy-pasted).
- `eslint-disable @next/next/no-img-element` throughout; base64 `<img>` everywhere.
- Solid parts: clean `services/` and `lib/` separation, typed products, isolated prompt builder.

### Scalability / Production Readiness — **3/10** 🔴
- **Live secrets committed to git in `.env.example`** — a real `OPENAI_API_KEY` and `GEMINI_API_KEY`. Rotate immediately; this alone fails a security review.
- No auth, no rate limiting, no per-user cost ceiling on an endpoint that calls two paid image models per request.
- Catalog is a static 55-item JSON; no CMS/feed sync with Koala's real inventory or pricing.
- `layout.tsx` metadata still says **"Create Next App" / "Generated by create next app."** No favicon-as-brand, no OG image, no SEO.

### Accessibility — **5/10** 🟡
Good `aria-expanded/controls/pressed`, focus management on lightbox. Gaps: colour-only selection states, "X" as accessible label content, no reduced-motion handling for the pulse animations.

**Weighted headline scores**
| Area | Score |
|---|---|
| AI Architecture | 7.5 |
| Loading/Motion | 7.0 |
| Visual (studio) | 6.5 |
| UX Flow | 6.0 |
| Accessibility | 5.0 |
| Navigation | 4.0 |
| Code Quality | 4.0 |
| Typography | 3.0 |
| Trust | 3.0 |
| Product Discovery | 3.0 |
| Production Readiness | 3.0 |
| **Business Value** | **2.0** |

---

## PHASE 2 — Roadmap (ordered by impact)

### P0 — Must fix before the CEO demo
1. **Rotate the leaked API keys** and scrub `.env.example`. (Security; do first.)
2. **Make products shoppable with real data**: real prices + real product URLs for the demo catalog. Without this there is no product.
3. **Pick ONE app.** Make `/studio` the canonical `/`. Retire or archive the root long-scroll app. Kill the dual-maintenance tax.
4. **Show bundle economics**: bundle subtotal, the 10%-off saving in dollars, and a final price. This is the AOV lever — it must be visible.
5. **Replace or remove the fake "Design Confidence" card.** Fabricated trust scores in front of a CEO is a credibility risk.
6. **Brand the shell**: real `<title>`/metadata/OG, load a real premium font, remove "Create Next App."

### P1 — Must fix before the pilot
7. **Real product-catalog feed** from Koala (price, availability, URL, image) instead of static JSON.
8. **Working cart handoff** — deep-link "Add to cart" into Koala's real cart/PDP, or a lead-capture "Email me this room" if cart integration isn't ready.
9. **Fix style tagging** so all 5 styles actually return relevant products; fix `getProductsForStyle`.
10. **Typography + icon system** (replace literal "X", unify to an icon set).
11. **Cost/rate controls** on generation endpoints (per-session cap, basic abuse protection).
12. **Lead capture** (email/phone gate on save/share) — the pilot's core measurable outcome.

### P2 — Should fix before production
13. Break the god components into composable pieces; de-duplicate shared UI.
14. Image caching / result persistence server-side (stop re-billing on refine).
15. Real inventory sync + "in stock / lead time" on each product.
16. Analytics wired to a real destination + a conversion funnel dashboard.
17. Accessibility pass (reduced-motion, non-colour selection cues, contrast audit).
18. Move `/ops` to its own project — it's not part of the shopping product.

### P3 — Nice to have
19. Save multiple room projects / accounts.
20. AR/room-scan for auto dimensions.
21. Social share templates with Koala branding.
22. A/B testing on bundle discount depth.

---

## PHASE 3 — UX Review (screen by screen)

**Landing / hero** — Copy is decent but generic ("Redesign your room with luxury furniture"). Times-fallback heading kills the premium feel. *Fix:* real font, one confident sentence, one primary CTA. Remove the right-aligned "route summary" paragraph — it reads like internal documentation.

**Upload** — Studio's version (big dashed drop target + Take photo / Gallery) is good; keep it. Root's bare file input is not premium. *Remove:* nothing. *Improve:* add an example room + a "why a wide shot helps" micro-hint (studio already hints this — good).

**Room type / Style** — Studio's visual card pickers are the right pattern. Root's `<select>` dropdowns are not. *Challenge:* 5 styles that mostly don't filter products is worse than 3 that do. Cut to styles you can actually back with product data.

**Room measurements (root)** — Three number inputs on the main screen add friction for a feature only 15/55 products can even honour. *Simplify:* collapse behind an optional "Improve accuracy" disclosure; don't tax every user upfront.

**Product selection** — 10-category accordion is thorough but heavy. *Simplify:* default to "Let AI choose" (studio already does this — good), make manual selection the secondary path.

**Result / concepts** — Strong: lightbox, choose/download/share, refine with quick-prompt chips. *Remove:* the fake confidence card. *Improve:* put the **shop-this-room** module and its **total price** immediately under the chosen concept, not a scroll away.

**Bundle** — Right idea, no numbers. *Fix:* itemized total, saving, single primary "Add room to cart." This is where money is made; it currently makes none.

Overall UX principle violated: **"calm/effortless"** — the root app is a dense control panel. The studio wizard is the effortless one. Ship the wizard.

---

## PHASE 4 — Visual Design System (recommended)

Anchor on the studio's instincts and make them a real system.

- **Palette:** near-black canvas `#0A0A0A`, panel `#141414`, hairline borders `rgba(255,255,255,.10)`, text `#F5F3EE`, muted `#9C9C94`, **single accent gold `#C8A24B`** (warmer/more furniture-luxe than the current neon-ish `#F4C430`). One accent, used sparingly.
- **Typography:** load via `next/font` — a refined serif for headings (e.g. *Fraunces* / *Canela*-like) and a clean grotesque for UI (e.g. *Inter* / *Söhne*-like). Define a real scale (48/32/24/18/15/13). **This is the highest perception-per-hour fix in the whole audit.**
- **Radius:** settle on 2 tokens (cards 24px, controls 12px). Currently drifts 12→32.
- **Shadows:** one soft elevation token; drop the `luxuryPulse` glow to a single subtle hover.
- **Icons:** adopt one line-icon set (Lucide). Kill every literal "X" and unicode heart.
- **Imagery:** generated concepts are the hero — give them a consistent frame, subtle grain-free border, and never crop. Product thumbs: consistent aspect ratio, neutral bg.
- **Motion:** keep the soft-rise entrance; remove infinite pulses (also for `prefers-reduced-motion`). Aim "Arc/Linear calm," not "AI demo shimmer."
- **Emotional target:** quiet confidence. Less chrome, more whitespace, one gold moment per screen.

---

## PHASE 5 — AI Review

**What's good (keep):** hybrid provider + fallback, product-image injection into `images.edit`, structured prompt with room-preservation + scale + concept-mode. This architecture is pilot-appropriate — don't rebuild it.

**Recommended architecture for pilot:**
- **Primary: Gemini 2.5 Flash Image** for the room edit (faster/cheaper, strong at edit-with-reference), **OpenAI `gpt-image-1` as fallback** — you already have both; make Gemini the default via `providerStrategy: "gemini-first"` and stop calling *both* on every request (currently the default path bills OpenAI **and** Gemini).
- **Add a light vision pre-pass** (one cheap vision call) to extract room type, existing palette, lighting, and detected furniture → feed structured facts into the prompt. This is the single biggest generation-quality lever and enables auto room-type detection (removes a wizard step).
- **Product-aware matching:** move from "tag contains style" to embeddings over product attributes so all styles return sensible matches and you can rank "goes with your room."
- **Caching + cost guardrails:** hash (image+prompt+products) → cache results; cap generations/session; log latency + cost per request.
- **Quality eval:** a tiny automated check (did the room structure survive? are selected products present?) before showing the result — protects against the occasional broken render in front of a customer.

**Prompt-level fixes:** dedupe the near-identical instruction blocks between `buildRoomPrompt` and the Gemini suffix; only 15/55 products have dimensions, so stop implying precise scale you can't back — request plausible scale instead.

---

## PHASE 6 — Business Review (the point of the exercise)

Every item below maps to a revenue lever, not "AI for AI's sake."

1. **Shoppable bundle with a real total + saving** → **AOV**. The room *is* the basket. Selling a $6k room beats selling one $900 sofa. This is the whole thesis and it's currently unbuilt.
2. **"Add whole room to cart" → Koala cart deep-link** → **conversion**. One click from inspiration to checkout.
3. **Lead capture ("Email/Save my room")** → **lead gen + retention**. Even non-buyers become a remarketing list; this is the pilot's headline metric.
4. **Salesperson mode (in-store iPad):** staff photographs the customer's room, generates, and the bundle lands in the customer's cart/email → **salesperson productivity + close rate**. Furniture is high-consideration; this shortens the "will it fit my room?" objection.
5. **"Complete the look" cross-sell** (rug/lighting/decor auto-added to the concept) → **attach rate / units per transaction**.
6. **Confidence-to-buy: real room-fit using dimensions** → **fewer returns, higher conversion**. "It fits your 4.2m wall" is worth more than a fake "Good."
7. **Financing / price framing on the bundle** ("from $X/wk") → **conversion on high tickets**.
8. **Saved rooms + re-engagement email** → **retention / repeat AOV** across rooms.

Cut for lack of business value: the `/ops` internal AI tools (interesting, but not a customer revenue lever — different product, different audit).

---

## PHASE 7 — Pilot Readiness: would I fund it as Koala's CEO?

**Today: No.** Not because the idea is weak — the idea is strong and the AI works — but because you're showing me a shopping product where **nothing is priced, nothing links to a product, the cart is a toast message, and a "confidence score" is faked.** I'd conclude the team built an impressive tech demo and mistook it for a commerce pilot. The leaked keys and "Create Next App" title tell me it isn't production-serious yet.

**What flips me to Yes (and it's close — ~2 weeks):**
1. Real prices + real product links + a bundle that shows total and saving, with "Add room to cart" handing off to my actual cart.
2. One branded, premium app (the studio wizard as `/`), real fonts, no fake scores.
3. A single believable end-to-end demo: *customer photo → AI room → priced bundle → into cart / captured as a lead.*
4. One number that proves the thesis: *"in our test, X% of generated rooms produced a cart or a captured lead."*

Show me that, and I fund the pilot — because the hard part (a product-aware AI that renders my furniture into a customer's actual room) already works. You've built the engine. You haven't attached the wheels.

---

## PHASE 8 — Execution Plan (approve before I touch code)

Difficulty D / Time T (focused eng-days) / Risk R / Customer impact C / Business impact B.

### P0 — before CEO demo
| # | Task | D | T | R | C | B | Depends on |
|---|---|---|---|---|---|---|---|
| 1 | Rotate leaked keys, scrub `.env.example`, move to env vars | Low | 0.25 | Low | – | – | – |
| 2 | Add real price + URL to demo catalog (55 items) | Low–Med | 1 | Low | High | **High** | catalog data |
| 3 | Make `/studio` the canonical `/`; archive root app | Med | 0.5 | Med | High | High | 2 |
| 4 | Bundle economics: subtotal + $ saving + total + one CTA | Med | 1 | Low | High | **High** | 2 |
| 5 | Remove/replace fake Design Confidence card | Low | 0.25 | Low | Med | Med | – |
| 6 | Brand shell: metadata/OG + `next/font` premium type | Low–Med | 0.75 | Low | High | Med | – |

*P0 subtotal ≈ 3.75 days → a fundable demo.*

### P1 — before pilot
| # | Task | D | T | R | C | B | Depends on |
|---|---|---|---|---|---|---|---|
| 7 | Real Koala product feed (price/stock/url/img) | High | 3 | High | High | High | Koala data access |
| 8 | Cart handoff / deep-link (or lead-capture fallback) | Med–High | 2 | Med | High | **High** | 7 |
| 9 | Fix style tagging + `getProductsForStyle` | Med | 1 | Low | Med | Med | 7 |
| 10 | Icon system + type polish | Low–Med | 1 | Low | Med | Low | 6 |
| 11 | Cost/rate guardrails on generation | Med | 1 | Med | – | Med (margin) | – |
| 12 | Lead capture (email/save room) + analytics dest | Med | 1.5 | Low | High | High | 8 |

### P2 — before production
| # | Task | D | T | R |
|---|---|---|---|---|
| 13 | Decompose god components, de-dupe shared UI | High | 3 | Med |
| 14 | Server-side result caching (stop re-billing refines) | Med | 1.5 | Med |
| 15 | Live inventory sync + stock/lead-time badges | High | 3 | High |
| 16 | Real analytics + conversion funnel dashboard | Med | 2 | Low |
| 17 | Accessibility pass (motion/contrast/labels) | Med | 1.5 | Low |
| 18 | Extract `/ops` to its own project | Low | 0.5 | Low |

### P2/P5 — AI upgrades
| # | Task | D | T | Payoff |
|---|---|---|---|---|
| A1 | Gemini-first default; stop dual-billing per request | Low | 0.5 | Cost/latency |
| A2 | Vision pre-pass (auto room type + palette) | Med | 2 | Quality + fewer steps |
| A3 | Embedding-based product matching | Med–High | 3 | Discovery relevance |
| A4 | Output quality gate before display | Med | 1.5 | Demo reliability |

### P3 — nice to have
Accounts/multi-room, AR auto-measure, branded share templates, discount-depth A/B.

---

## The one-paragraph truth

The AI is the hard part and you nailed it — product-aware, hybrid-provider, room-preserving generation is genuinely good work and world-class relative to most "AI room" demos. But you've been polishing the engine while the car has no wheels: **no prices, no working product links, a fake cart, a fabricated trust score, leaked keys, a "Create Next App" title, two competing apps, and the better one hidden.** None of that is hard to fix. Spend the next ~4 focused days turning the concept into something a customer can actually *buy* from, put the studio wizard front and centre, brand it properly, and you walk into the CEO meeting with a fundable pilot instead of a tech demo.
