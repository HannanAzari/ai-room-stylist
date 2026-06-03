import { useEffect, useState } from "react";

export function useProgressIndex(isActive: boolean, itemCount: number, intervalMs: number) {
  const [progressIndex, setProgressIndex] = useState(0);

  useEffect(() => {
    if (!isActive) return;

    const interval = window.setInterval(() => {
      setProgressIndex((current) =>
        Math.min(current + 1, Math.max(itemCount - 1, 0))
      );
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [intervalMs, isActive, itemCount]);

  function resetProgressIndex() {
    setProgressIndex(0);
  }

  return [progressIndex, resetProgressIndex] as const;
}
