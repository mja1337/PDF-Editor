# CLAUDE.md

Guidance for AI agents working in this repository.

## What this is

`pdfe` is a local-first PDF workspace: a React 19 + TypeScript + Vite single-page app
deployed to GitHub Pages. There is no backend. PDF bytes never leave the browser.
Read `README.md` for user-facing capabilities and `OVERHAUL_PLAN.md` for planned work.

## Commands

```bash
npm run check        # lint + unit tests + build. Run this before saying you are done.
npm run dev          # Vite dev server on :5173
npm run test         # vitest, ~4s
npm run test:e2e     # Playwright, ~17s, builds and previews first
npm run test:e2e:pages   # same, under the /PDF-Editor/ base path used by Pages
```

`npm run test:e2e` goes through `scripts/e2e.mjs`. Some sandboxes point
`PLAYWRIGHT_BROWSERS_PATH` at an empty cache, which makes Playwright fail with
"Executable doesn't exist" even though the browsers are installed. The wrapper drops
such an override. **If the e2e suite will not start, fix that rather than working
without it** — it is the only end-to-end coverage of the interaction layer.

## Layer map

| Concern | Location |
|---|---|
| Document model, page identity, overlay normalization | `src/domain/document.ts` |
| Overlay factories and geometry helpers | `src/domain/overlays.ts`, `src/pdf/shapeGeometry.ts` |
| Persistence (IndexedDB), preferences | `src/domain/appStorage.ts`, `src/domain/preferences.ts` |
| PDF rendering, export, OCR, search | `src/pdf/*` |
| Canvas and its overlay layers | `src/components/PdfCanvas.tsx` |
| Annotation interaction (draw, move, resize, erase) | `src/components/AnnotationLayer.tsx` |
| Redaction marking | `src/components/RedactionLayer.tsx` |
| App-level state extracted from `App.tsx` | `src/app/*` |

## Conventions and traps

**Redaction has its own layer.** `PdfCanvas` renders `RedactionLayer` *instead of*
`AnnotationLayer` when the redaction tool is active. `AnnotationLayer` deliberately
knows nothing about redact mode — `'redaction'` is not in its `DRAW_TOOLS`. It still
renders and manipulates existing redaction *overlays* in select mode. Reintroducing
redaction handling into `AnnotationLayer` gives you two layers drawing marks and the
accent chrome leaking through the black boxes; `tests/redactionLayer.test.tsx` guards
against this.

**Behaviour lives in TypeScript, not CSS.** Whether an overlay is interactive is
decided in the component. Do not add `.tool-*` override blocks to suppress something
a component should not have rendered, and treat a new `!important` as a sign the fix
is in the wrong place.

**Analysed text has one layout rule, in one place.** `src/pdf/extractedTextFit.ts`
decides how an edited line is sized: grow right into free space, then wrap downward
into free space, then shrink the type, and report `overflow` rather than clip.
`extractedFitBounds` is what keeps a line from growing over its neighbours, so an
address block stays intact. The screen (`AnnotationLayer`), the vector export
(`export.ts`) and the scan export (`scanEdit.ts`) all wrap through
`layoutExtractedLines` so the preview matches the file. Do not add a fourth wrap.

**Analysed lines can hold more than one ink.** A line's `color` is the dominant
ink; `colorSegments` carries per-character colour when a line genuinely has two
(a red asterisk on a black label). `src/pdf/inkSegments.ts` owns expanding,
recombining and remapping them across an edit, and all three renderers draw
segment by segment. Sampling happens once, in `sampleRunInk`, using character
positions rescaled to the run's real width so the matched font's metrics cannot
drift onto the wrong glyphs. If a renderer paints a whole line in `overlay.color`,
coloured marks are lost.

**The box always fits its text.** An effect in `AnnotationLayer` refits any edited
analysed line whose text changed, whatever changed it — the on-page editor, the
sidebar list, paste, undo. Add new edit paths without worrying about sizing; do not
add a second refit.

**`normalizeOverlay` clamps.** `src/domain/document.ts` forces `strokeWidth` to at
least 0.5 and applies minimum sizes to every overlay. Passing `strokeWidth: 0` does
not do what it looks like.

**The accent colour is `#168e80`.** It is used for selection frames, resize handles
and the dashed outline on analysed (extracted) text boxes. A bug report about
unexpected "green" or "teal" boxes is almost always analysed-text chrome, not the
highlight tool.

**Export is the source of truth for geometry.** `src/pdf/export.ts` applies the
coordinate transforms for every quarter-turn rotation; `tests/coordinates.test.ts`
and the rotation e2e cover it. Change overlay geometry and check both.

## Testing

Unit tests (`tests/*.test.ts`) cover pure functions in `src/pdf` and `src/domain`.
Component tests use `@testing-library/react` with a `// @vitest-environment jsdom`
docblock, because the global vitest environment is `node`. jsdom provides neither
`PointerEvent` nor layout, so pointer-driven components need the shims shown in
`tests/redactionLayer.test.tsx`.

`src/App.tsx` and `src/components/AnnotationLayer.tsx` are the largest files and have
the least direct coverage. Bugs in them have historically been fixed several times
over — see `git log` for signature placement. Before patching either, reproduce the
failure with a test or the e2e suite. If you find yourself adding a second mechanism
for something that already has one, stop and remove the first.

## Style

- No semicolons, single quotes, 2-space indent, trailing commas in multiline literals.
- Comments explain *why*, and are rare. Match the density of the file you are editing.
- `npm run lint` must be clean, including `react-hooks/exhaustive-deps` warnings.
