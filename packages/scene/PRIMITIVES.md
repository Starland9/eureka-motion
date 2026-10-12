# Writing a scene primitive

A primitive draws one element of an explanation. It is a plain React function of its props,
with no Remotion hook, so it renders the same in the player, in the video renderer, in tests
and in the snapshot tool.

## Contract

```tsx
import type { PrimitiveProps } from "../../composition/context";

export function VectorPrimitive({ element, ctx }: PrimitiveProps<"vector">) { … }
```

- One file per primitive, already created as a placeholder under `src/primitives/`. Replace
  the body; keep the exported name, which `src/composition/registry.ts` imports.
- `element` is typed from the schema: `src/schema/document.ts` is the list of properties.
- `ctx` (`src/composition/context.ts`) carries everything else.

| `ctx` field                                          | Use                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `state.of(id)`                                       | `{ visible, opacity, progress, how, highlight, dim, move }` for an element id or `id.part`    |
| `state.simTime(id)`                                  | Simulated seconds (or steps) set by a `play` action                                           |
| `scope`, `refScope`                                  | Model values now, and at the default parameter values                                         |
| `valueInfo(id)`                                      | Label, unit, symbol and number format of a model value                                        |
| `projection`                                         | `toPx([x, y])`, `length(n)`, `scale`: world coordinates to slot pixels (null without `world`) |
| `size`                                               | Width and height of the slot in pixels                                                        |
| `lookup`                                             | Elements of the scene by id, to resolve anchors                                               |
| `u`                                                  | Pixels per scene unit                                                                         |
| `theme`, `language`, `frame`, `fps`, `reducedMotion` | As named                                                                                      |

## Kinds

- **svg** primitives return SVG nodes (`<g>`…) in the slot's pixel space, origin top-left,
  size `ctx.size`. They are mounted only while visible.
- **html** primitives (`text`, `list`, `formula`, `readout`, `timeline`, `steps`, `table`)
  return a block in a flex column. They are always mounted so the layout does not jump:
  apply `opacity` from the state instead of returning null.

## Rules

- Style only from tokens, with inline styles or SVG attributes: `colourOf`, `strokeWidth`,
  `textSize`, `fontOf`, `px` from `src/primitives/shared`. No `className`, no CSS file, no
  hex value, no import from `next/*`, no `@/` alias.
- No gradient, shadow, blur, glow or rounded corner. Hierarchy comes from stroke and space.
- Colour is a code: `quantity`, `action`, `result`, `valid`, otherwise ink. `result` is a
  flat fill behind ink, never a stroke or a text colour.
- Sizes are in scene units times `ctx.u`, never fixed pixels. Text is at least
  `textSize(ctx, "min")`.
- Bind numbers with `resolve(value, ctx.scope)`; resolve anchors with `resolveAnchor`,
  vector ends with `vectorEnd`, curves with `samplePlot` (all in `src/schema/geometry.ts`).
- Format numbers with `formatNumberParts`, and typeset the exponent as a real superscript.
- Motion comes from the state: multiply by `state.opacity`; when `state.how === "draw"`
  trace strokes with `drawStyle(state, length)`; labels use `<FigureLabel>` (they appear
  after the stroke); typed text uses `typedText`. No timer, no CSS transition or animation.
- A simulation computes its positions from the law it shows and scales physical values by
  comparing `ctx.scope` with `ctx.refScope`. It exposes the parts listed in `ELEMENT_PARTS`
  and reads each part's state with `ctx.state.of(\`${element.id}.part\`)`.
- Comments: short and factual only. No narration, no doc blocks.

## Tests

`tests/helpers/scene.tsx` provides `sceneOf(elements, options)`, `testContext({ scene, … })`
and `renderElement(element, ctx)`. Start the file with `// @vitest-environment jsdom`.

```tsx
const element = { id: "v", slot: "figure", type: "vector", from: [0, 0], to: [2, 0] } as const;
const scene = sceneOf([element], { world: { x: [-5, 5], y: [-3, 3] } });
const { container } = renderElement(element, testContext({ scene }));
```

Test what the primitive promises: geometry follows the bound values, both themes use token
colours, the entrance follows the state (`frame: 0` hides, `frame: "end"` shows).

## Looking at the result

```bash
pnpm snapshot <document.json> [sceneId|all] [--frame=end|N|0.5] [--theme=paper|board] [--values=r=7e8]
```

Writes PNG files to `.snapshots/` and prints their paths. Open them and check: nothing
overlaps, nothing leaves the frame, text is readable, both themes work.
