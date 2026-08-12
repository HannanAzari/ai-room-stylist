/**
 * Scene Graph (structured room understanding).
 *
 * Before image generation, the AI understands the room as structured data
 * instead of raw pixels: architecture, fixed objects, replaceable furniture
 * (with bounding boxes, depth, orientation, colour, material, size and a
 * per-object confidence), empty walls/floor zones, lighting and palette.
 *
 * Fully fallback-safe: with no API key / network failure / unparseable output
 * it returns an empty scene graph and generation still proceeds.
 */
import {
  defaultRoomAnalysis,
  type RoomAnalysis,
} from "./room-analysis";
import {
  canonicaliseCategory,
  isReplaceableCanonical,
  type CanonicalCategory,
} from "./scene-taxonomy";

const SCENE_MODEL = "gemini-2.5-flash";
const SCENE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${SCENE_MODEL}:generateContent`;
const SCENE_TIMEOUT_MS = 14_000;

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SceneFurniture = {
  id: string;
  /** The raw, free-text label the vision model returned (kept for debugging). */
  category: string;
  /** Deterministically derived planner-facing category. */
  canonicalCategory: CanonicalCategory;
  /** False when the raw label matched no taxonomy rule. */
  categoryRecognised: boolean;
  boundingBox: BoundingBox | null;
  approximateDepth: string;
  orientation: string;
  dominantColor: string;
  material: string;
  size: string;
  replaceable: boolean;
  confidence: number;
};

export type SceneFixedObject = {
  name: string;
  confidence: number;
};

export type SceneGraph = {
  roomType: string;
  camera: string;
  walls: string;
  floor: string;
  ceiling: string;
  windows: string;
  doors: string;
  fixedObjects: SceneFixedObject[];
  furniture: SceneFurniture[];
  emptyWalls: string[];
  emptyFloorAreas: string[];
  lighting: string;
  palette: string[];
  analysed: boolean;
};

/**
 * May an object with this raw vision label be replaced by generation?
 *
 * Delegates to the canonical taxonomy. The previous implementation tested raw
 * substrings, so "tv unit" matched the protected token "tv" and entertainment
 * units became permanently non-replaceable. Canonicalisation resolves "tv unit"
 * to the `tv-unit` furniture category first, so only an actual television is
 * protected.
 */
export function isReplaceableCategory(category: string): boolean {
  return isReplaceableCanonical(canonicaliseCategory(category).canonical);
}

export function defaultSceneGraph(roomTypeHint = "living room"): SceneGraph {
  return {
    roomType: roomTypeHint || "living room",
    camera: "eye-level, straight-on interior photograph",
    walls: "as shown in the uploaded room",
    floor: "as shown in the uploaded room",
    ceiling: "as shown in the uploaded room",
    windows: "preserve existing windows and light direction",
    doors: "preserve existing doors and openings",
    fixedObjects: [],
    furniture: [],
    emptyWalls: [],
    emptyFloorAreas: ["the main open floor area"],
    lighting: "match the existing natural and ambient lighting",
    palette: [],
    analysed: false,
  };
}

/** Adapter so the existing prompt builder keeps working from the scene graph. */
export function sceneGraphToRoomAnalysis(scene: SceneGraph): RoomAnalysis {
  const base = defaultRoomAnalysis(scene.roomType);
  return {
    roomType: scene.roomType || base.roomType,
    cameraAngle: scene.camera || base.cameraAngle,
    vanishingPoint: base.vanishingPoint,
    floor: scene.floor || base.floor,
    walls: scene.walls || base.walls,
    windows: scene.windows || base.windows,
    doors: scene.doors || base.doors,
    ceiling: scene.ceiling || base.ceiling,
    lighting: scene.lighting || base.lighting,
    existingFurniture: scene.furniture.map(
      (item) =>
        `${item.category}${item.dominantColor ? ` (${item.dominantColor})` : ""}${item.replaceable ? "" : " [fixed]"}`
    ),
    emptyAreas:
      scene.emptyFloorAreas.length > 0 ? scene.emptyFloorAreas : base.emptyAreas,
    placementZones:
      scene.emptyFloorAreas.length > 0
        ? scene.emptyFloorAreas
        : base.placementZones,
    colourPalette: scene.palette,
    style: base.style,
    analysed: scene.analysed,
  };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  // Accept both 0-1 and 0-100 inputs; normalise to 0-1.
  const normalised = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, Math.round(normalised * 100) / 100));
}

function parseBoundingBox(value: unknown): BoundingBox | null {
  if (!value || typeof value !== "object") return null;
  const box = value as Record<string, unknown>;
  const toNum = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return null;
    return n > 1 ? n / 100 : n; // accept 0-1 or 0-100
  };
  const x = toNum(box.x);
  const y = toNum(box.y);
  const width = toNum(box.width);
  const height = toNum(box.height);
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

function parseFurniture(value: unknown): SceneFurniture[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw, index): SceneFurniture | null => {
      if (!raw || typeof raw !== "object") return null;
      const item = raw as Record<string, unknown>;
      const category = asString(item.category);
      if (!category) return null;
      // Canonicalise once, here, so every downstream consumer reasons about the
      // enum rather than re-parsing free text.
      const { canonical, recognised } = canonicaliseCategory(category);
      // Enforce the fixed-object rule regardless of what the model returned.
      const modelReplaceable =
        typeof item.replaceable === "boolean" ? item.replaceable : true;
      const replaceable = isReplaceableCanonical(canonical) && modelReplaceable;
      return {
        id: asString(item.id, `obj-${index + 1}`),
        category,
        canonicalCategory: canonical,
        categoryRecognised: recognised,
        boundingBox: parseBoundingBox(item.boundingBox),
        approximateDepth: asString(item.approximateDepth, "unknown"),
        orientation: asString(item.orientation, "unknown"),
        dominantColor: asString(item.dominantColor, "unknown"),
        material: asString(item.material, "unknown"),
        size: asString(item.size, "unknown"),
        replaceable,
        confidence: clampConfidence(item.confidence),
      };
    })
    .filter((item): item is SceneFurniture => item !== null)
    .slice(0, 20);
}

function parseFixedObjects(value: unknown): SceneFixedObject[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): SceneFixedObject | null => {
      if (typeof raw === "string") {
        return raw.trim() ? { name: raw.trim(), confidence: 0.5 } : null;
      }
      if (raw && typeof raw === "object") {
        const item = raw as Record<string, unknown>;
        const name = asString(item.name);
        return name ? { name, confidence: clampConfidence(item.confidence) } : null;
      }
      return null;
    })
    .filter((item): item is SceneFixedObject => item !== null)
    .slice(0, 12);
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function fileToInlineData(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return {
    inline_data: {
      mime_type: file.type || "image/jpeg",
      data: buffer.toString("base64"),
    },
  };
}

const SCENE_PROMPT = `You are a computer-vision system that turns an interior photo into a structured scene graph. Return ONLY a JSON object with EXACTLY these keys:
{
  "roomType": string,
  "camera": string,                 // camera height and orientation
  "walls": string, "floor": string, "ceiling": string,
  "windows": string, "doors": string,
  "fixedObjects": [ { "name": string, "confidence": number } ],   // built-ins & non-movable items: TV, air conditioner, curtains, radiator, fireplace...
  "furniture": [
    {
      "id": string,
      "category": string,           // prefer one of: sofa, armchair, chair, coffee table, dining table, desk, bed, bedside table, dresser, sideboard, bookshelf, tv unit, rug, mirror, artwork, floor lamp, table lamp, ceiling light, plant, tv, window, door, curtains, air conditioner, fireplace, radiator, ceiling fan, built-in
      "boundingBox": { "x": number, "y": number, "width": number, "height": number },  // normalised 0-1
      "approximateDepth": string,   // "foreground" | "midground" | "background"
      "orientation": string,        // e.g. "facing camera", "facing left"
      "dominantColor": string,
      "material": string,
      "size": string,               // "small" | "medium" | "large"
      "replaceable": boolean,       // true for movable furniture, false for TV/AC/curtains/built-ins
      "confidence": number          // 0-1, how sure you are this object exists as described
    }
  ],
  "emptyWalls": string[],           // wall areas with space for art/mirrors/shelving
  "emptyFloorAreas": string[],      // open floor zones where furniture could be placed
  "lighting": string,
  "palette": string[]               // dominant colours
}
Rules: DO NOT GUESS. Only include objects you can actually see; if unsure, use a low confidence. Report a confidence for every furniture and fixed object.
IMPORTANT — a television and the unit it stands on are TWO SEPARATE objects. Report the screen itself as category "tv" (replaceable: false) and the cabinet/console beneath it as category "tv unit" (replaceable: true). Never merge them into one entry.
List each distinct physical object separately; if the room contains two sofas, report two furniture entries with different ids.`;

export async function analyzeSceneGraph(
  roomImage: File,
  options: { apiKey?: string; roomTypeHint?: string } = {}
): Promise<SceneGraph> {
  const apiKey = options.apiKey?.trim();
  const fallback = defaultSceneGraph(options.roomTypeHint);
  if (!apiKey) return fallback;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCENE_TIMEOUT_MS);

  try {
    const imagePart = await fileToInlineData(roomImage);
    const response = await fetch(SCENE_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: SCENE_PROMPT }, imagePart] },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) return fallback;

    const data = (await response.json().catch(() => null)) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    } | null;
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();
    if (!text) return fallback;

    const parsed = extractJsonObject(text);
    if (!parsed) return fallback;

    return {
      roomType: asString(parsed.roomType, fallback.roomType),
      camera: asString(parsed.camera, fallback.camera),
      walls: asString(parsed.walls, fallback.walls),
      floor: asString(parsed.floor, fallback.floor),
      ceiling: asString(parsed.ceiling, fallback.ceiling),
      windows: asString(parsed.windows, fallback.windows),
      doors: asString(parsed.doors, fallback.doors),
      fixedObjects: parseFixedObjects(parsed.fixedObjects),
      furniture: parseFurniture(parsed.furniture),
      emptyWalls: asStringArray(parsed.emptyWalls),
      emptyFloorAreas: asStringArray(parsed.emptyFloorAreas).length
        ? asStringArray(parsed.emptyFloorAreas)
        : fallback.emptyFloorAreas,
      lighting: asString(parsed.lighting, fallback.lighting),
      palette: asStringArray(parsed.palette),
      analysed: true,
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}
