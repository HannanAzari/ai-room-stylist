import { useMemo, useRef } from "react";

/**
 * Stop a paid operation being launched twice.
 *
 * ---------------------------------------------------------------------------
 * WHY A REF, AND WHY A HOOK
 * ---------------------------------------------------------------------------
 * `setLoading(true)` does not take effect until React re-renders, so two taps
 * landing in the same frame BOTH sail past a `loading` check and buy two
 * renders. Disabling the button has exactly the same hole — the disabled prop
 * is applied on the next render too. Only a ref updates synchronously, so the
 * second tap can see what the first one set.
 *
 * It lives in a hook rather than inline because the ref must not be read from
 * anything reachable during render — `react-hooks/refs` rightly rejects that,
 * and a ref read while rendering would not re-render anything anyway. Keeping
 * the access inside these two closures makes the boundary explicit.
 *
 * `begin()` returns false when a flight is already in progress; the caller
 * should return immediately. `end()` belongs in a `finally`, or a thrown
 * request leaves the flag set and nothing can be generated again without a
 * reload.
 */
export type SingleFlight = {
  /** Claim the slot. False means one is already in flight — do nothing. */
  begin: () => boolean;
  /** Release the slot. Always call this from a `finally`. */
  end: () => void;
};

export function useSingleFlight(): SingleFlight {
  const inFlight = useRef(false);

  return useMemo(
    () => ({
      begin: () => {
        if (inFlight.current) return false;
        inFlight.current = true;
        return true;
      },
      end: () => {
        inFlight.current = false;
      },
    }),
    []
  );
}
