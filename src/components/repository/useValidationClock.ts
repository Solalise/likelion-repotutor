"use client";

import { useCallback, useEffect, useState } from "react";

/** Initialize once, then sample time outside render for time-sensitive record validation. */
export function useValidationClock() {
  const [now, setNow] = useState(Date.now);
  const refresh = useCallback(() => setNow(Date.now()), []);
  useEffect(() => {
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [refresh]);
  return { now, refresh };
}
