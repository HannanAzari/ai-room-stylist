import { NextResponse } from "next/server";
import { getJobStore } from "@/features/room-stylist/services/generation-jobs/job-store";

/**
 * Poll one generation job.
 *
 * Read-only and deliberately thin: the job record already carries everything
 * the processing screen needs, so this neither computes nor decides anything.
 * A missing job is reported as such rather than as an error — with a
 * non-durable store, or after the TTL, "gone" is an expected outcome the client
 * has to handle gracefully.
 */
export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId")?.trim();

  if (!jobId) {
    return NextResponse.json({ error: "A jobId is required." }, { status: 400 });
  }

  const store = getJobStore();

  try {
    const job = await store.get(jobId);

    if (!job) {
      return NextResponse.json(
        {
          status: "unknown",
          jobId,
          durable: store.isDurable,
          // Actionable rather than mysterious: with the in-memory store this is
          // the expected outcome of hitting a different instance.
          reason: store.isDurable
            ? "This generation has expired or was never started."
            : "The job store is not durable, so this job could not be found from this instance.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      jobId: job.jobId,
      status: job.status,
      stage: job.stage ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      durable: store.isDurable,
      // The full generation body, only once there is one.
      result: job.status === "succeeded" ? job.result : undefined,
      error: job.status === "failed" ? job.error : undefined,
    });
  } catch (error) {
    console.error("[studio-gemini-status] lookup failed", { jobId, error });
    return NextResponse.json(
      { error: "Could not read the generation status." },
      { status: 500 }
    );
  }
}
