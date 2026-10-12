# Brief for implementation agents

Rules that apply to every task handed out from `tasks.md`. The task description in the
prompt adds what is specific to it.

## Environment

- Repository: `/home/landry/Dev/eureka-motion`, a pnpm workspace. `apps/web` is the Next.js
  application (package `web`), `packages/scene` the scene engine (package `scene`).
- Node tools are not on the default PATH. Start every shell command with
  `export PATH=/home/landry/.nvm/versions/node/v22.20.0/bin:$PATH`.
- Several agents work in this repository at the same time.
  - Create or edit only the files your task lists. If you think a shared file (schema,
    tokens, registry, a `package.json`, a config file) must change, do not change it:
    explain why in your report.
  - Never run `pnpm install`, `pnpm add` or any `pnpm <script>`: they start an install
    check that collides with other agents. Run the tools directly, as below.
  - If a command fails with a "module not found" error you did not cause, wait 30 seconds
    and try once more: another agent may be installing a dependency.
- Do not create git commits. Do not use `sudo`.

## Running the tools

| Need | Command |
|---|---|
| Scene tests | `cd packages/scene && node_modules/.bin/vitest run <test file>` |
| Web tests | `cd apps/web && node_modules/.bin/vitest run <test file>` |
| Types | `cd packages/scene && node_modules/.bin/tsc --noEmit` (or `cd apps/web`) |
| Lint | `cd /home/landry/Dev/eureka-motion && node_modules/.bin/eslint <your files>` |
| Format | `cd /home/landry/Dev/eureka-motion && node_modules/.bin/prettier --write <your files>` |
| Snapshot of a scene | `cd apps/web && INIT_CWD=/home/landry/Dev/eureka-motion node_modules/.bin/tsx --tsconfig scripts/tsconfig.json scripts/snapshot.tsx <document.json> [sceneId\|all] [--frame=end\|N\|0.5] [--theme=paper\|board] [--values=id=1.5,…] --out=.snapshots/<your-task>` |

Type and lint output may contain errors from files other agents are still writing: judge
only the errors located in your own files, and list any other in your report.

The snapshot tool prints the PNG paths; open them with your image reader. Paths given to it
are relative to the repository root.

## Code style

- TypeScript in strict mode, double quotes, formatted by Prettier (width 100).
- Comments: rare, short and factual, such as one line stating a non-obvious constraint.
  No narration, no doc blocks, no file headers, no restating what the code does.
- No dead code, no placeholder left behind, no `any` unless a test needs it.
- Texts shown to users never live in code as literals in the web application: they go
  through the translation files. The scene engine shows only what the document contains.

## Design

`design-system/eureka-motion/MASTER.md` is binding. In short: paper and ink, or blackboard
and chalk; colour is a pedagogical code, never decoration; hierarchy from strokes, type and
space; no gradient, shadow, blur, glow, rounded corner, emoji or decorative icon; no
interface sans-serif.

## Report

End with a concise report:

- files created or modified;
- each success criterion of the task, with the command you ran and its result;
- for visual work, the snapshot files you checked and what you saw;
- anything you could not do, could not verify, or think should change in shared code.

## Client architecture (apps/web)

Read this before writing any interface component.

### Shared modules, already written — do not edit them

| Module | What it gives |
|---|---|
| `@/components/explanation/types` | `ExplanationState`, `StartRequest`, `StartOutcome`, `ExplanationStream`, `initialExplanationState`, `isComplete` |
| `@/components/explanation/ExplanationSession` | `useExplanationSession()`: the one explanation of the visit (`state`, `startedHere`, `start`, `open`, `reset`). Mounted in the locale layout, so it survives navigation between pages |
| `@/components/player/PlaybackProvider` | `PlaybackProvider`, `usePlayback()` (state and commands of the player), `usePlaybackPosition()` (current frame, scene and narration beat; re-renders on every frame, so call it only in small leaf components) |
| `@/components/player/Planche` | The framed player. Must be inside a `PlaybackProvider` |
| `@/lib/preferences` | `useFlagPreference(key, fallback)`, `useChoicePreference(key, allowed, fallback)`: values kept on the device |
| `@/lib/theme-client` | `useTheme()`, `setTheme("paper" \| "board")`, `useReducedMotion()` |
| `@/i18n/navigation` | `Link`, `useRouter`, `usePathname` aware of the locale |
| `@/components/ui/*` | `button`, `input`, `slider`, `dialog`, `collapsible`, `sonner`, already restyled for the design system |
| `@/components/dev/DevPlayback`, `@/lib/dev-reference` | Mount a hand-written document in a player on a development page |

Timings come from `scene`: `Timeline.scenes[i]` is `{ id, index, start, duration, beats }`
and a beat is `{ id, index, start, duration, narration, audioUrl }`, all in frames at
`playback.fps`. A `Location` is `{ scene, beat, frameInScene, frameInBeat }`.

### Translations

One file per namespace: `apps/web/messages/fr/<file>.json` and `messages/en/<file>.json`,
each holding one top-level key. Write only in the file your task names, in both languages,
with the same keys. `Common`, `Theme`, `Level` and `Language` in `common.json` are
read-only. Use `useTranslations("<Namespace>")` in client components and
`getTranslations` in server components. French typography: non-breaking space before
`: ; ! ?` and inside « ».

### Styling

Tailwind 4 with the tokens of `apps/web/src/app/tokens.css` and the utilities of
`apps/web/src/app/globals.css`: read both files first. Text styles are `text-display-xl`,
`text-display-l`, `text-title`, `text-lead`, `text-body-l`, `text-body`, `text-control`,
`text-caption`, `text-data`; colours are token classes such as `text-ink`,
`text-ink-faint`, `bg-surface`, `bg-surface-raised`, `border-ink`. Never write a raw hex
colour, a pixel font size or a font family in a component. Interactive targets use
`touch-target` (44 px). Every control has a visible focus state and an accessible name.

### Development pages

A component that cannot be tested without a browser gets a workbench page at
`apps/web/src/app/[locale]/dev/<name>/page.tsx`, answering 404 in production
(`isDevRouteEnabled()`); `dev/planche` is the model to copy. A development server is
already running on `http://localhost:3000` with the simulated provider: never start,
stop or restart it. Check your page with a Playwright script written to
`apps/web/scripts/check-<name>.mts` (model: `apps/web/scripts/check-planche.mts`, run
with `cd apps/web && node_modules/.bin/tsx scripts/check-<name>.mts`), screenshots in
`apps/web/.snapshots/<name>/`, at 1280 px and 360 px wide, in both themes, and look at
the screenshots yourself. Texts on development pages may be literals.
