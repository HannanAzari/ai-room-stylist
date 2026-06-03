type GenerationProgressProps = {
  title: string;
  message: string;
  steps: string[];
  activeStep: number;
};

export function GenerationProgress({
  title,
  message,
  steps,
  activeStep,
}: GenerationProgressProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="relative overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 p-4 shadow-2xl animate-[luxuryPulse_2.8s_ease-in-out_infinite]"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/40" />
      <div className="flex items-center gap-3">
        <div className="h-3 w-3 rounded-full bg-white animate-[glowDot_1.6s_ease-in-out_infinite]" />
        <div>
          <p className="text-sm font-semibold tracking-wide text-white">{title}</p>
          <p className="mt-1 text-sm text-neutral-300">{message}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {steps.map((step, index) => {
          const isActive = index === activeStep;
          const isComplete = index < activeStep;

          return (
            <div key={step} className="flex items-center gap-3">
              <span
                className={`h-2 w-2 rounded-full transition-all duration-300 ${
                  isComplete || isActive ? "bg-white" : "bg-neutral-700"
                } ${isActive ? "scale-125 animate-pulse" : ""}`}
              />
              <span
                className={`text-xs transition-colors duration-300 ${
                  isComplete || isActive ? "text-neutral-200" : "text-neutral-500"
                }`}
              >
                {step}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
