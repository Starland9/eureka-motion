"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createLevelRequest, type LevelRequest, type LevelRequestView } from "./level-request";

export function useLevelRequest(): { view: LevelRequestView; request: LevelRequest["request"] } {
  const [controller] = useState(() => createLevelRequest());
  const view = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => controller.abort, [controller]);

  return { view, request: controller.request };
}
