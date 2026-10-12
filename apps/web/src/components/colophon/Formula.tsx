"use client";

import katex from "katex";
import { useMemo } from "react";
import { getTheme, KATEX_OPTIONS, roleMacros } from "scene";
import { useTheme } from "@/lib/theme-client";

export function Formula({ tex }: { tex: string }) {
  const theme = useTheme();
  const html = useMemo(() => {
    const { role } = getTheme(theme);
    return katex.renderToString(tex, {
      ...KATEX_OPTIONS,
      throwOnError: false,
      displayMode: true,
      macros: roleMacros({ ...role, action: role.actionText }),
    });
  }, [tex, theme]);
  return <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />;
}
