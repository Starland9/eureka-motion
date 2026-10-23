"use client";

import { useEffect, useState } from "react";
import type { Language } from "scene";
import type { VersionEntry } from "@/components/controls/Versions";
import { fetchVersions } from "./versions-list";

const NONE: readonly VersionEntry[] = [];

export function useVersions(id: string, language: Language): readonly VersionEntry[] {
  const [versions, setVersions] = useState<readonly VersionEntry[]>(NONE);

  useEffect(() => {
    const controller = new AbortController();
    fetchVersions(id, language, controller.signal).then(setVersions, () => undefined);
    return () => controller.abort();
  }, [id, language]);

  return versions;
}
