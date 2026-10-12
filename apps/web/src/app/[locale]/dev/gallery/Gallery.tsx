"use client";

import type { ExplanationDocument, Language, ThemeName } from "scene";
import { DevPlayback } from "@/components/dev/DevPlayback";
import { Planche } from "@/components/player/Planche";
import { usePlayback, usePlaybackPosition } from "@/components/player/PlaybackProvider";
import { Button } from "@/components/ui/button";
import { setTheme, useTheme } from "@/lib/theme-client";

export type GalleryEntry =
  | { ok: true; name: string; language: Language; document: ExplanationDocument }
  | { ok: false; name: string; issues: string[] };

const THEMES: readonly { name: ThemeName; label: string }[] = [
  { name: "paper", label: "Papier" },
  { name: "board", label: "Tableau" },
];

function slugOf(name: string): string {
  return name.replace(/\.json$/, "");
}

function ThemeSwitch() {
  const theme = useTheme();
  return (
    <div role="group" aria-label="Thème" className="flex gap-2">
      {THEMES.map(({ name, label }) => (
        <Button
          key={name}
          type="button"
          size="sm"
          variant={theme === name ? "default" : "secondary"}
          aria-pressed={theme === name}
          data-testid={`theme-${name}`}
          onClick={() => setTheme(name)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

function Readout({ slug }: { slug: string }) {
  const playback = usePlayback();
  const { frame, location } = usePlaybackPosition();
  const count = playback.timeline.scenes.length;
  return (
    <output
      aria-live="off"
      data-testid={`readout-${slug}`}
      data-frame={frame}
      data-scene={location?.scene.index ?? ""}
      data-scene-frame={location?.frameInScene ?? ""}
      className="text-data text-ink-soft"
    >
      {location
        ? `scène ${location.scene.index + 1}/${count} (${location.scene.id}) · image ${location.frameInScene}/${location.scene.duration - 1} · total ${frame}/${playback.durationInFrames - 1}`
        : "aucune scène"}
    </output>
  );
}

function Controls({ slug }: { slug: string }) {
  const playback = usePlayback();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={!playback.ready}
        data-testid={`play-${slug}`}
        data-playing={playback.playing}
        onClick={(event) => playback.toggle(event)}
      >
        {playback.playing ? "Pause" : "Lecture"}
      </Button>
      {playback.timeline.scenes.map((scene) => {
        const last = scene.start + scene.duration - 1;
        return (
          <Button
            key={scene.id}
            type="button"
            size="sm"
            variant="secondary"
            disabled={!playback.ready}
            data-testid={`scene-${slug}-${scene.index}`}
            data-scene-id={scene.id}
            data-frame={last}
            onClick={() => playback.seekToFrame(last)}
          >
            {`Fin ${scene.id}`}
          </Button>
        );
      })}
      <Readout slug={slug} />
    </div>
  );
}

function Document({ entry }: { entry: GalleryEntry }) {
  const slug = slugOf(entry.name);
  return (
    <section
      id={`doc-${slug}`}
      data-testid={`doc-${slug}`}
      data-status={entry.ok ? "ok" : "error"}
      className="scroll-mt-24 border-t border-ink py-6"
    >
      <h2 className="text-title">{entry.name}</h2>
      {entry.ok ? (
        <>
          <p className="text-data text-ink-soft">
            {entry.document.scenes.length} scènes · {entry.language}
          </p>
          <DevPlayback document={entry.document} language={entry.language}>
            <div data-testid={`plate-${slug}`} className="flow-root">
              <Planche />
            </div>
            <Controls slug={slug} />
          </DevPlayback>
        </>
      ) : (
        <ul data-testid={`issues-${slug}`} className="text-data mt-3 list-disc pl-5">
          {entry.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Gallery({ entries }: { entries: GalleryEntry[] }) {
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-ink bg-surface">
        <nav
          aria-label="Galerie"
          className="page-width flex flex-wrap items-center gap-x-5 gap-y-1 py-2"
        >
          <ThemeSwitch />
          {entries.map((entry) => {
            const slug = slugOf(entry.name);
            return (
              <a
                key={entry.name}
                href={`#doc-${slug}`}
                data-testid={`link-${slug}`}
                className="text-control touch-target inline-flex items-center underline underline-offset-3"
              >
                {slug}
              </a>
            );
          })}
        </nav>
      </header>
      <main id="content" className="page-width pb-12">
        {entries.map((entry) => (
          <Document key={entry.name} entry={entry} />
        ))}
      </main>
    </>
  );
}
