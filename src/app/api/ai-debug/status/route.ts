import { NextResponse } from "next/server";
import { getRoomEditProvider } from "@/features/room-stylist/services/image-providers/room-edit-provider";
import { DEFAULT_GEMINI_IMAGE_MODEL } from "@/features/room-stylist/services/image-providers/gemini";
import { generationJobCapability } from "@/features/room-stylist/services/generation-jobs/job-store";

/**
 * Effective AI configuration for this deployment.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REPORTS MORE THAN A BOOLEAN NOW
 * ---------------------------------------------------------------------------
 * Defaults in code are not what runs — environment variables are, and an env
 * var set weeks ago for a one-off comparison silently outranks a considered
 * default. Switching the primary renderer to Gemini is worthless if a stale
 * ROOM_EDIT_PROVIDER=gpt-image is still set on the project, and the only way to
 * find that out used to be paying for a generation and inspecting the result.
 *
 * So this reports what the server WILL actually use, resolved through the same
 * code paths generation uses. It is the cheapest possible pre-flight check.
 *
 * SECRETS ARE NEVER RETURNED. API keys are reported as a boolean only. The
 * renderer id, model name and timeout are configuration, not credentials.
 */
export async function GET() {
  const enabled = process.env.ENABLE_AI_DEBUG?.toLowerCase() === "true";

  // The pre-existing contract: a bare boolean, which the admin view reads.
  if (!enabled) return NextResponse.json({ enabled: false });

  const renderer = getRoomEditProvider();
  const sceneTimeoutMs =
    Number.parseInt(process.env.SCENE_ANALYSIS_TIMEOUT_MS?.trim() || "", 10) ||
    120_000;
  const attempts =
    Number.parseInt(process.env.GENERATION_ATTEMPTS_PER_STAGE?.trim() || "", 10);

  return NextResponse.json({
    enabled: true,
    renderer: {
      /** What will actually render — resolved, not assumed. */
      id: renderer.id,
      label: renderer.label,
      configured: renderer.available,
      /** True when an env var is overriding the code default. */
      overriddenByEnv: Boolean(process.env.ROOM_EDIT_PROVIDER?.trim()),
    },
    geminiImageModel: {
      effective:
        process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_GEMINI_IMAGE_MODEL,
      overriddenByEnv: Boolean(process.env.GEMINI_IMAGE_MODEL?.trim()),
    },
    sceneAnalysis: {
      timeoutMs: sceneTimeoutMs,
      overriddenByEnv: Boolean(process.env.SCENE_ANALYSIS_TIMEOUT_MS?.trim()),
      /** The measured latency tail was ~95s; below this it fails silently. */
      meetsRecommendedMinimum: sceneTimeoutMs >= 120_000,
    },
    generationAttemptsPerStage: Number.isFinite(attempts) && attempts >= 1
      ? Math.min(attempts, 3)
      : 1,
    asyncJobs: generationJobCapability(),
    // Presence only — never the values.
    credentials: {
      geminiApiKey: Boolean(process.env.GEMINI_API_KEY?.trim()),
      openAiApiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
    },
  });
}
