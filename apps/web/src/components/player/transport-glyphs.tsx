import type { ReactNode } from "react";

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className="size-6"
    >
      {children}
    </svg>
  );
}

export function PlayGlyph() {
  return (
    <Glyph>
      <path d="M8 5 19 12 8 19Z" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function PauseGlyph() {
  return (
    <Glyph>
      <path d="M7 5h3.5v14H7ZM13.5 5H17v14h-3.5Z" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function ReplayGlyph() {
  return (
    <Glyph>
      <path d="M5.5 7.5A8 8 0 1 1 4.2 13" />
      <path d="M4.5 3.5v4.5H9" />
    </Glyph>
  );
}

export function PreviousGlyph() {
  return (
    <Glyph>
      <path d="M5 5h2v14H5ZM19 5 9 12l10 7Z" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function NextGlyph() {
  return (
    <Glyph>
      <path d="M17 5h2v14h-2ZM5 5l10 7L5 19Z" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function SoundGlyph({ muted }: { muted: boolean }) {
  return (
    <Glyph>
      <path d="M3.5 9.5H8L13 5.5v13L8 14.5H3.5Z" fill="currentColor" stroke="none" />
      {muted ? (
        <path d="m16 9.5 5 5M21 9.5l-5 5" />
      ) : (
        <>
          <path d="M16 9a4.5 4.5 0 0 1 0 6" />
          <path d="M18.5 6.5a8 8 0 0 1 0 11" />
        </>
      )}
    </Glyph>
  );
}

export function FullscreenGlyph() {
  return (
    <Glyph>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </Glyph>
  );
}
