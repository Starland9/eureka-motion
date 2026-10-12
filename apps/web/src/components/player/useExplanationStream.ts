"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ExplanationStream } from "@/components/explanation/types";
import { createExplanationClient } from "@/components/explanation/stream";

export function useExplanationStream(): ExplanationStream {
  const [client] = useState(() => createExplanationClient());
  const { state, startedHere } = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  );

  useEffect(() => client.abort, [client]);

  return useMemo(
    () => ({
      state,
      startedHere,
      start: client.start,
      open: client.open,
      reset: client.reset,
    }),
    [client, state, startedHere],
  );
}
