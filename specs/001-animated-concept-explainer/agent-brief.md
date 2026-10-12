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
