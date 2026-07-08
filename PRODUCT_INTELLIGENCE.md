# PRODUCT_INTELLIGENCE.md — The product intelligence layer

Turns the raw Koala catalogue (`src/data/products.json`) into rich, structured
intelligence the AI pipeline can reason about. Lives in
`src/lib/intelligence/product-profile.ts` and `product-references.ts`.

**Core principle:** commercial catalogue data (price, URL, dimensions) is **never
fabricated**. When a field is missing it stays null/empty. The *derived*
descriptors below are prompt-engineering intelligence, computed at runtime — they
are not written back into the catalogue as if they were real feed data.

---

## Product profiles

`buildProductProfile(product, catalogue)` → `ProductProfile`. Cached per-process by
`getProductProfile(product)`; batch via `getProductProfiles(products)`.

Fields:
| Field | Source |
|---|---|
| `style` | `product.styleTags[0]` (fallback "modern luxury") |
| `colour` / `colours` | `product.colors`, else inferred from the name |
| `materials` | `product.materials` |
| `finish` | feed field, else inferred (matte/gloss/veneer/sintered stone/leather sheen/wood grain…) |
| `shape` | feed field, else inferred from name (round/oval/curved/modular/rectangular…) |
| `silhouette` | inferred (sectional/low-profile/slim vertical/compact sculptural…) |
| `legsBase` | inferred from name (gold/black/wooden legs, plinth, platform…) |
| `texture` | inferred (woven/bouclé/velvet/leather/stone/glass…) |
| `tags` | de-duped union of the above |
| `roomTypes` | feed `roomCompatibility`, else category→room map |
| `availability` | `product.availability` or `stockStatus`, else "unknown" |
| `promptFragment` | one-line descriptor used verbatim in prompts |
| `negativePrompt[]` | per-product things to avoid (wrong colour/material, wrong scale, warped legs…) |
| `replacementRules[]` | `{ target, placement }` — what it replaces + where |
| `matchingProducts[]` | ids of well-pairing products (see matching logic) |

Example `promptFragment`:
> *"sofa in cream / stone fabric (soft matte textile finish, modular shape,
> generous sectional silhouette, plinth base)"*

The full database for all 55 products can be regenerated for inspection:
```
npm run intelligence:profiles   # → docs/product-profiles.json
```

## Reference images

`product-references.ts` — `getProductReferenceViewUrls(product)` returns an ordered,
de-duplicated list of candidate reference-view image URLs:
`main → front → 45°/angle → side → lifestyle → detail → close-up`.

Sources, in priority order:
1. `product.referenceViews` (explicit feed data)
2. `product.imageUrls` / `imageUrl` (scraped images)
3. Conventional per-view paths in the product's image dir (`.jpg`/`.webp`)

`loadProductReferenceImageFiles()` (in `lib/product-image-references.ts`) loads up
to **3 views/product, 8 total**, validating file signatures. **Today only
`main.jpg` exists per product**, so one image per product is used; richer views
light up automatically when added — no code change needed.

## Matching logic

In `buildProductProfile`, `matchingProducts` is scored across the catalogue:
`+2` same style tag, `+1` different category (so packages are coordinated, not
duplicated), `+1` per overlapping colour. Top 6 by score. Used to suggest coherent
"complete the room" pairings. (The customer-facing recommendation UI uses a
separate `room-consultant.ts` category-gap approach; the profile matching is the
AI-side pairing intelligence.)

## Negative prompts

Two layers, aggregated in the prompt builder:
- **Per-product** (`profile.negativePrompt`): wrong colour/material for this
  product, distorted/duplicated furniture, wrong scale for its category, warped
  legs / floating / bad proportions.
- **Global** (in `prompt-builder.ts`): no cropping/zoom/reframe, no camera or
  architecture changes, no people/text/logos, no CGI/cartoon, etc.

## Replacement rules

Each category maps to a `{ target, placement }` rule, e.g. a sofa replaces
"existing main seating" and is placed "against the primary wall or within the main
seating zone, facing the focal point". Combined with the **scene graph's
replaceable classifier** (TV/AC/curtains = fixed), this tells generation *what may
be replaced and where* — the seed of the future Replacement Planner (Sprint 2).

## Current limitations

- Derived fields are heuristic (name/attribute rules), not model-generated or
  feed-verified. Good enough for prompting; not authoritative product metadata.
- Only 11/55 products have real price + URL; dimensions on 15/55.
- Only `main.jpg` per product — no true multi-view references yet.
- Matching is attribute-based, not embedding/semantic.

## Future improvements

- Ingest a **real Koala product feed** to populate price/URL/stock/dimensions and
  the optional profile fields (finish/shape/silhouette/texture/referenceViews)
  directly, replacing the heuristics.
- Add **embedding-based** product matching for richer pairing/complementary logic.
- Capture **multiple real reference views** per product (front/45/side/lifestyle).
- Feed the profile's replacement rules into the **Replacement Planner** so the
  prompt gets an explicit item-by-item swap plan (Sprint 2).
