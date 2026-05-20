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
      className="rounded-xl border border-neutral-700 bg-neutral-950 p-4"
    >
      <div className="flex items-center gap-3">
        <div className="h-3 w-3 rounded-full bg-white" />
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
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
                className={`h-2 w-2 rounded-full ${
                  isComplete || isActive ? "bg-white" : "bg-neutral-700"
                } ${isActive ? "animate-pulse" : ""}`}
              />
              <span
                className={`text-xs ${
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
