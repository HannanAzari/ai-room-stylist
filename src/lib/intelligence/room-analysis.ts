/**
 * Room understanding (Phase 3).
 *
 * Runs a lightweight vision pre-pass over the uploaded room photo and returns
 * structured JSON describing the room (type, camera, architecture, lighting,
 * placement zones, palette, style). The prompt builder consumes this to
 * preserve the customer's actual room during generation.
 *
 * Fully fallback-safe: with no API key, a network failure, or unparseable
 * output it returns a sensible default so generation always proceeds.
 */
const ANALYSIS_MODEL = "gemini-2.5-flash";
const ANALYSIS_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${ANALYSIS_MODEL}:generateContent`;
const ANALYSIS_TIMEOUT_MS = 12_000;

export type RoomAnalysis = {
  roomType: string;
  cameraAngle: string;
  vanishingPoint: string;
  floor: string;
  walls: string;
  windows: string;
  doors: string;
  ceiling: string;
  lighting: string;
  existingFurniture: string[];
  emptyAreas: string[];
  placementZones: string[];
  colourPalette: string[];
  style: string;
  // Whether this came from the model (true) or the deterministic fallback.
  analysed: boolean;
};

export function defaultRoomAnalysis(roomTypeHint = "living room"): RoomAnalysis {
  return {
    roomType: roomTypeHint || "living room",
    cameraAngle: "eye-level, straight-on interior photograph",
    vanishingPoint: "central, consistent with the uploaded photo",
    floor: "as shown in the uploaded room",
    walls: "as shown in the uploaded room",
    windows: "preserve existing windows and natural light direction",
    doors: "preserve existing doors and openings",
    ceiling: "preserve existing ceiling height and lines",
    lighting: "match the existing natural and ambient lighting",
    existingFurniture: [],
    emptyAreas: ["the main open floor area"],
    placementZones: ["the primary seating or focal zone"],
    colourPalette: [],
    style: "modern luxury",
    analysed: false,
  };
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
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

const ANALYSIS_PROMPT = `You are an interior photography analyst. Study this room photo and return ONLY a JSON object (no prose) with exactly these keys:
{
  "roomType": string,            // e.g. "living room", "bedroom", "dining room", "office"
  "cameraAngle": string,         // camera height and orientation
  "vanishingPoint": string,      // where perspective lines converge
  "floor": string,               // floor material and colour
  "walls": string,               // wall colour/material
  "windows": string,             // number and position of windows / light direction
  "doors": string,               // doors and openings
  "ceiling": string,             // ceiling height and features
  "lighting": string,            // natural + artificial lighting description
  "existingFurniture": string[], // furniture currently visible
  "emptyAreas": string[],        // empty floor/wall areas
  "placementZones": string[],    // where new furniture could naturally be placed
  "colourPalette": string[],     // dominant colours
  "style": string                // overall interior style
}
Be concise and factual about THIS photo.`;

export async function analyzeRoom(
  roomImage: File,
  options: { apiKey?: string; roomTypeHint?: string } = {}
): Promise<RoomAnalysis> {
  const apiKey = options.apiKey?.trim();
  const fallback = defaultRoomAnalysis(options.roomTypeHint);

  if (!apiKey) return fallback;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);

  try {
    const imagePart = await fileToInlineData(roomImage);
    const response = await fetch(ANALYSIS_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: ANALYSIS_PROMPT }, imagePart] },
        ],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
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
      cameraAngle: asString(parsed.cameraAngle, fallback.cameraAngle),
      vanishingPoint: asString(parsed.vanishingPoint, fallback.vanishingPoint),
      floor: asString(parsed.floor, fallback.floor),
      walls: asString(parsed.walls, fallback.walls),
      windows: asString(parsed.windows, fallback.windows),
      doors: asString(parsed.doors, fallback.doors),
      ceiling: asString(parsed.ceiling, fallback.ceiling),
      lighting: asString(parsed.lighting, fallback.lighting),
      existingFurniture: asStringArray(parsed.existingFurniture),
      emptyAreas: asStringArray(parsed.emptyAreas).length
        ? asStringArray(parsed.emptyAreas)
        : fallback.emptyAreas,
      placementZones: asStringArray(parsed.placementZones).length
        ? asStringArray(parsed.placementZones)
        : fallback.placementZones,
      colourPalette: asStringArray(parsed.colourPalette),
      style: asString(parsed.style, fallback.style),
      analysed: true,
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}
