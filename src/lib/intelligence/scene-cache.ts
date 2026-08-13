/**
 * Remembering what a room looks like.
 *
 * Scene analysis is the slowest and most expensive step in the pipeline —
 * fifteen to thirty seconds of vision model, per call. The same photo gets
 * analysed more than once in a single sitting: the advanced picker analyses it
 * to list the individual pieces, then generation analyses it again to resolve
 * the customer's choices into targets. That is the same photo, the same
 * question, and the same answer, paid for twice.
 *
 * So the answer is keyed by the photo's bytes. Identical bytes, identical
 * room, identical analysis — there is nothing about a JPEG that changes
 * between two requests thirty seconds apart.
 *
 * Deliberately in-memory and deliberately small. This is a warm-instance
 * optimisation, not a durable store: a cold start simply analyses again, which
 * is exactly what happens today. Nothing depends on a hit.
 */
import { createHash } from "node:crypto";
import type { SceneGraph } from "./scene-graph";

/** Entries live long enough for one sitting, not long enough to go stale. */
const TTL_MS = 15 * 60 * 1000;
/** A few concurrent users on a warm instance. Bounded so memory cannot grow. */
const MAX_ENTRIES = 12;

type CacheEntry = {
  sceneGraph: SceneGraph;
  storedAt: number;
};

const cache = new Map<string, CacheEntry>();

/** Cache key for a room photo: the bytes themselves, hashed. */
export function roomImageKey(bytes: ArrayBuffer | Uint8Array): string {
  const view =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return createHash("sha256").update(view).digest("hex");
}

/** A previously analysed scene for these exact bytes, if we still hold one. */
export function getCachedSceneGraph(key: string): SceneGraph | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;

  if (Date.now() - entry.storedAt > TTL_MS) {
    cache.delete(key);
    return undefined;
  }

  // Refresh recency so an actively used photo is not the one evicted.
  cache.delete(key);
  cache.set(key, entry);
  return entry.sceneGraph;
}

/**
 * Remember an analysis. A FAILED analysis is never stored: caching "we
 * couldn't see this room" would turn one bad call into fifteen minutes of
 * pretending the room is empty.
 */
export function setCachedSceneGraph(key: string, sceneGraph: SceneGraph): void {
  if (!sceneGraph.analysed) return;

  cache.set(key, { sceneGraph, storedAt: Date.now() });

  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** Test seam. */
export function clearSceneCache(): void {
  cache.clear();
}

/** Test seam: how many entries are held. */
export function sceneCacheSize(): number {
  return cache.size;
}
