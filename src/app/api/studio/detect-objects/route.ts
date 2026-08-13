import { NextResponse } from "next/server";
import {
  analyzeSceneGraph,
  type SceneGraph,
} from "@/lib/intelligence/scene-graph";
import { toSelectableObjects } from "@/lib/intelligence/room-selection";
import {
  getCachedSceneGraph,
  roomImageKey,
  setCachedSceneGraph,
} from "@/lib/intelligence/scene-cache";

/**
 * Smart Select — detect the room objects a customer may choose to replace.
 *
 * This deliberately REUSES `analyzeSceneGraph` rather than adding a second
 * vision call: the scene graph already returns bounding boxes, canonical
 * categories, spatial instance labels and the replaceable/fixed classification,
 * all of which this feature needs. One call, one source of truth, and the same
 * fixed-object protection the generation pipeline uses.
 *
 * Representation is BOUNDING BOXES, not masks. A direct probe of
 * `gemini-2.5-flash` showed its segmentation mask field returns either the
 * placeholder string "gimme_mask_for_this" or undecodable internal
 * "<seg_N>" codebook tokens — neither is a renderable mask. The response shape
 * carries optional `polygon`/`mask` so a real segmentation source can be added
 * later without changing any consumer.
 *
 * Fallback-safe: with no API key or on failure it returns an empty object list
 * plus `analysed: false`, so the client can offer manual drawing instead of
 * showing an error.
 */

/**
 * Scene analysis measures at 15-30s for a real room photo, so the platform's
 * default function timeout is not enough. Without this the request is killed
 * before the model answers and Smart Select silently degrades to "unavailable".
 */
export const maxDuration = 60;

const SUPPORTED_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isAiDebugEnabled() {
  return process.env.ENABLE_AI_DEBUG?.toLowerCase() === "true";
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";

    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Send the room photo as multipart/form-data." },
        { status: 415 }
      );
    }

    const formData = await req.formData();
    const image = formData.get("image");
    const roomTypeHint = formData.get("roomType");

    if (!(image instanceof File) || image.size === 0) {
      return NextResponse.json(
        { error: "Missing room image." },
        { status: 400 }
      );
    }

    if (!SUPPORTED_UPLOAD_TYPES.has(image.type.toLowerCase())) {
      return NextResponse.json(
        { error: "Unsupported image type. Use JPG, PNG or WebP." },
        { status: 415 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim() || "";

    // Fallback-safe by design: no key means no detection, not an error page.
    // The client falls back to manual drawing.
    let sceneGraph: SceneGraph | undefined;
    // Keyed by the photo's bytes, so generating right after this costs one
    // analysis rather than two.
    const sceneCacheKey = roomImageKey(await image.arrayBuffer());
    const cachedScene = getCachedSceneGraph(sceneCacheKey);
    try {
      sceneGraph =
        cachedScene ??
        (await analyzeSceneGraph(image, {
          apiKey,
          roomTypeHint:
            typeof roomTypeHint === "string" ? roomTypeHint : undefined,
        }));
      if (!cachedScene && sceneGraph) {
        setCachedSceneGraph(sceneCacheKey, sceneGraph);
      }
    } catch (error) {
      console.warn("[detect-objects] scene analysis failed", error);
      sceneGraph = undefined;
    }

    const objects = toSelectableObjects(sceneGraph);

    const body: Record<string, unknown> = {
      objects,
      analysed: Boolean(sceneGraph?.analysed),
      // Honest capability reporting: the client uses this to describe what the
      // customer is actually looking at.
      selectionRepresentation: "bounding-box",
      supportsMasks: false,
    };

    if (isAiDebugEnabled()) {
      body.debug = {
        detectedFurnitureCount: sceneGraph?.furniture.length ?? 0,
        selectableCount: objects.length,
        excluded: (sceneGraph?.furniture ?? [])
          .filter((item) => !objects.some((o) => o.sceneItemId === item.id))
          .map((item) => ({
            id: item.id,
            category: item.category,
            canonicalCategory: item.canonicalCategory,
            replaceable: item.replaceable,
            reason: !item.replaceable
              ? "fixed object or architecture"
              : item.boundingBox === null
                ? "no bounding box"
                : "category not offerable",
          })),
      };
    }

    return NextResponse.json(body);
  } catch (error) {
    console.error("[detect-objects] request failed", error);
    return NextResponse.json(
      { error: "Could not analyse the room photo." },
      { status: 500 }
    );
  }
}
