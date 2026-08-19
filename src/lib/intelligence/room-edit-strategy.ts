/**
 * Which prompt/reference architecture the room edit uses.
 *
 * `grounding` is everything that exists today: scene graph, replacement plan,
 * reference manifest, the ~19KB intelligent prompt, and the quality reviewer.
 * `few-shot` is the POC path: two validated catalogue views per product, a
 * short prompt, one render, no reviewer.
 *
 * This is a strategy switch, NOT a provider switch — `ROOM_EDIT_PROVIDER` still
 * decides which renderer runs, and both strategies go through it. The default
 * stays `grounding`, so nothing changes until a deployment opts in.
 */
export type RoomEditStrategyId = "grounding" | "few-shot";

export const DEFAULT_ROOM_EDIT_STRATEGY: RoomEditStrategyId = "grounding";

export function getRoomEditStrategy(): RoomEditStrategyId {
  const raw = process.env.ROOM_EDIT_STRATEGY?.trim().toLowerCase();
  if (raw === "few-shot" || raw === "fewshot" || raw === "few_shot") {
    return "few-shot";
  }
  // An unset or misspelled value takes the default rather than failing: a typo
  // in an env var must not take the product down.
  return DEFAULT_ROOM_EDIT_STRATEGY;
}
