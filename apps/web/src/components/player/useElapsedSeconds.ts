"use client";

import { useEffect, useState } from "react";
import { elapsedSeconds, TICK_MS } from "./deep-version";

export function useElapsedSeconds(since: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return elapsedSeconds(since, now);
}
