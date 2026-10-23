"use client";

import { useTranslations } from "next-intl";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type VersionKind = "initial" | "another_analogy" | "simpler" | "zoom" | "followup";

export interface VersionEntry {
  id: string;
  kind: VersionKind;
  scene?: string;
}

export interface VersionsProps {
  versions: readonly VersionEntry[];
  currentId: string | null;
  onOpen(versionId: string): void;
  className?: string;
}

export function Versions({ versions, currentId, onOpen, className }: VersionsProps) {
  const t = useTranslations("Reformulate.versions");
  const labelId = useId();

  if (versions.length < 2) return null;

  const mark = (chunks: ReactNode) => <span className="text-data">{chunks}</span>;

  const describe = (version: VersionEntry): string | null => {
    if (version.kind === "initial") return null;
    if (version.kind === "zoom" && version.scene !== undefined) {
      return t("zoomOf", { scene: version.scene });
    }
    return t(`kinds.${version.kind}`);
  };

  return (
    <div className={className}>
      <p id={labelId} className="text-caption mb-1 text-ink-faint">
        {t("label")}
      </p>
      <ol aria-labelledby={labelId} className="border-t border-ink">
        {versions.map((version, index) => {
          const number = index + 1;
          const kind = describe(version);
          const current = version.id === currentId;
          return (
            <li key={version.id} className="border-b border-rule">
              <button
                type="button"
                aria-current={current ? "true" : undefined}
                onClick={() => onOpen(version.id)}
                className={cn(
                  "touch-target flex w-full cursor-pointer items-baseline gap-3 border-l-2 px-3 py-2 text-left hover:bg-surface-sunk",
                  current ? "border-ink" : "border-transparent",
                )}
              >
                <span className="text-body min-w-0 flex-1 break-words">
                  {kind === null
                    ? t.rich("entryInitial", { number, v: mark })
                    : t.rich("entry", { number, kind, v: mark })}
                </span>{" "}
                {current ? (
                  <span className="text-caption text-ink-soft">{t("current")}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
