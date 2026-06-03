export function DesignConfidenceCard({
  selectedProductCount,
  hasRoomMeasurements,
}: {
  selectedProductCount: number;
  hasRoomMeasurements: boolean;
}) {
  const productMatch = selectedProductCount > 0 ? "High" : "Medium";

  return (
    <section className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-950/80 p-5 shadow-xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-neutral-500">
            AI-estimated preview
          </p>
          <h3 className="mt-2 font-serif text-2xl font-semibold">
            Design Confidence
          </h3>
        </div>
        <span className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300">
          Demo score
        </span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-4">
          <p className="text-xs text-neutral-500">Product match</p>
          <p className="mt-2 text-lg font-semibold text-white">
            {productMatch}
          </p>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-4">
          <p className="text-xs text-neutral-500">Scale realism</p>
          <p className="mt-2 text-lg font-semibold text-white">Good</p>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-4">
          <p className="text-xs text-neutral-500">Room fit</p>
          <p className="mt-2 text-lg font-semibold text-white">Good</p>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-4">
          <p className="text-xs text-neutral-500">Selected products used</p>
          <p className="mt-2 text-lg font-semibold text-white">
            {selectedProductCount}
          </p>
        </div>
      </div>

      <p className="mt-4 text-sm text-neutral-400">
        {hasRoomMeasurements
          ? "Scale assisted by room dimensions."
          : "Add room dimensions for better scale accuracy."}
      </p>
    </section>
  );
}
