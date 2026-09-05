# PDF Editor overhaul plan

## Implementation checkpoint — 5 September 2026

The first rebuild slice is implemented. It replaces the CDN-dependent prototype with a bundled React and strict TypeScript application while keeping GitHub Pages as the permanent runtime boundary.

Delivered in this slice:

- A responsive local-first workspace with file picker and drag-and-drop import, lazy thumbnails, a focused HiDPI page canvas, and accessible page controls.
- An immutable page model with stable identities, authoritative ordering, delete, reorder, rotate, undo, and redo.
- Local PDF.js loading through its bundled worker, guarded file validation, clear failure states, and explicit cleanup of document resources.
- Local pdf-lib export that applies the visible page order, deletions, and rotation deltas, then downloads without uploading document bytes.
- A bundled installable PWA with an update prompt and offline application shell.
- Unit coverage for document commands and export semantics, plus Playwright coverage for the complete edit/export loop, external-request detection, offline reload, and the exact `/PDF-Editor/` Pages subpath.
- A least-privilege GitHub Actions pipeline that tests pull requests and deploys `dist/` from `main`.

This is a reliable vertical slice, not the end of the roadmap. Range and multi-selection, annotations, signatures, forms, secure redaction, recovery storage, search/text layers, and large-document performance budgets remain later milestones below.

### Capability expansion

The second implementation slice adds a genuine multi-source document model and restores the safe parts of the legacy toolset:

- Multiple PDFs can be opened together or appended to the current workspace and reordered as one document.
- JPEG and PNG files can be converted into fitted PDF pages and mixed with imported PDFs.
- Pages can be duplicated, extracted to a one-page PDF, or rendered to PNG.
- The focused preview supports 50–200% zoom.
- A document-wide text watermark has live preview, undo/redo, and vector-text export.
- Every normal export is reopened locally and checked for page-count and rotation consistency before download.

The old redaction and compression implementations remain intentionally excluded: both rasterized content or visually covered text without a sufficiently explicit safety model. They will return only as named destructive export modes with warnings and dedicated tests.

### Sprint 2 completion

- Shift range selection, Cmd/Ctrl toggle selection, select-all, and bulk move/rotate/delete/duplicate/extract commands share one undo history.
- Page-number, previous/next, keyboard, fit-width, fit-page, and custom zoom navigation are available from the workspace.
- Embedded outlines are resolved to stable page identities across source documents.
- Full-document search extracts and caches text locally, reports progress, and navigates directly to matching pages.
- A 100-page browser fixture verifies that thumbnails remain virtualized rather than rendering every page eagerly.

### Sprint 3 completion

- A normalized overlay model now covers text, highlight, underline, strikeout, rectangle, ellipse, and line annotations.
- The focused page supports pointer placement, selection, grid-snapped dragging and resizing, keyboard nudging, colour/opacity/weight controls, copy/paste, duplication, deletion, and per-overlay undo/redo.
- Thumbnail and focused-page previews consume the same overlay model.
- PDF export maps display-normalized overlays back into PDF coordinates and handles 0°, 90°, 180°, and 270° page rotations.
- Unit tests assert exact coordinate bounds for every quarter turn; browser coverage creates, edits, moves, resizes, exports, and reopens annotations.
- Context-aware right-click menus expose only relevant page, canvas-placement, or annotation actions, including overlay layer ordering, with keyboard navigation and viewport clamping.

## Executive summary

The current repository is a useful proof of concept, but it should not be extended in place. It is a 669-line global script with no package manifest, pinned dependencies, automated tests, error boundary, or durable document model. Several visible tools do not affect exported output, and a few operations can silently damage fidelity.

The recommended direction is a self-contained, local-first browser application built with strict TypeScript, React, and Vite and deployed as static assets on GitHub Pages. PDF.js should remain the rendering and text-extraction engine, while pdf-lib should be isolated behind an export adapter for the structural edits it supports well. Expensive parsing, rendering, image conversion, and export work should live off the main thread. The original PDF bytes should remain immutable; edits should be represented as reversible commands over stable page identifiers and applied only during export.

The deployed application must have no backend, runtime secrets, required API, CDN, hosted font, telemetry endpoint, or license server. Opening, editing, recovering, and exporting a PDF must happen entirely on the user's device. After one successful visit, the application shell and all processing engines should also work offline.

## Fixed hosting and independence constraints

GitHub Pages is the permanent production host. The rebuild must respect these non-negotiable constraints:

- The production artifact is plain HTML, CSS, JavaScript, worker scripts, optional WASM, icons, and fonts under `dist/`.
- Every runtime dependency is bundled or copied into the build. Production code must make zero requests to npm CDNs, Google Fonts, analytics, APIs, or other third-party origins.
- User PDFs never leave the browser. File bytes may only be read through browser file APIs and stored locally with explicit user consent.
- No secrets or privileged credentials may exist in client code. GitHub's deployment token is used only inside GitHub Actions.
- The app must work at the repository URL `https://mja1337.github.io/PDF-Editor/`; Vite's production `base` must therefore be `/PDF-Editor/` unless a configured custom domain changes it to `/`.
- Use a single application route or hash-based navigation. Do not depend on server rewrite rules that GitHub Pages cannot provide for arbitrary client-side routes.
- A service worker precaches the complete application shell and core PDF engines. Offline operation is tested, not merely advertised.
- Updates use versioned, content-hashed assets and an atomic cache migration. An update must never mix old application code with new workers or WASM.
- IndexedDB stores optional recovery data and preferences. The UI must explain that browser storage can be cleared or evicted and is not a backup.
- Do not require cross-origin-isolated features such as `SharedArrayBuffer`. GitHub Pages does not provide application-controlled response-header configuration; workers and optional WASM must retain a broadly compatible single-threaded path.
- Keep the deployed site comfortably below GitHub Pages' 1 GB published-site limit and monitor bundle size to protect its soft 100 GB/month bandwidth limit.

GitHub Pages supports custom GitHub Actions publishing workflows, which allows tests and the Vite build to run before only `dist/` is deployed. The official Vite guide also requires the repository-specific base path for project Pages sites.

## Current-state review

### Repository and delivery

- The entire product consists of `index.html`, `styles.css`, and `app.js`.
- There is no README, license, package manifest, lockfile, build, CI workflow, linting, type checking, test suite, changelog, release process, or deployment configuration.
- Runtime libraries are loaded from multiple CDNs. PDF.js is hard-coded to 2.10.377 while pdf-lib is unversioned (`unpkg.com/pdf-lib/dist/pdf-lib.js`). There is no subresource integrity or content-security policy.
- Bootstrap's JavaScript, jQuery, and Popper are loaded even though the app does not use Bootstrap JavaScript components. The Popper major also does not match the Bootstrap 4 generation.
- Buttons remain enabled before a document is loaded; some handlers silently do nothing and others can throw.

### Confirmed correctness defects

| Severity | Area | Evidence and impact |
| --- | --- | --- |
| Critical | Page reordering | `pageOrder` is assigned but `renderPDF()` creates a fresh sequential order, and export also iterates sequentially. Reorder never changes preview or output (`app.js:58`, `app.js:79-83`, `app.js:211-216`, `app.js:463-470`). |
| Critical | Redaction identity | A redaction is saved against loop position `i`, not the stable source `pageIndex`. It will target the wrong page after a real reorder or filtered view (`app.js:124-163`). |
| Critical | Redaction state | `redactBoxes` and redaction UI state are not reset when a new file is loaded. Marks from one document can be applied to another (`app.js:40-66`). |
| Critical | Misleading secure output | Normal Save paints black rectangles but leaves the underlying text/content in the PDF. It is not secure redaction (`app.js:218-242`). The separate redacted export removes text only by rasterizing every page (`app.js:269-316`), destroying search, links, forms, accessibility, and vector quality throughout the document. |
| High | Rotation correctness | Preview passes an explicit rotation value of zero, potentially overriding an existing page rotation. Export replaces the source rotation instead of applying a delta. Redaction coordinate conversion also ignores rotation (`app.js:87-89`, `app.js:223-247`). |
| High | PNG import | The picker accepts all image types, but every image is passed to `embedJpg`. PNG and other accepted formats fail (`app.js:363-378`). |
| High | Image sizing | Imported images are drawn at native pixel dimensions onto a fixed 600 x 800 point page with no contain/cover calculation. Large images crop and small images do not fill the page (`app.js:375-378`). |
| High | Compression fidelity | Compress rasterizes all pages to JPEG, destroying text, links, forms, signatures, transparency, and accessibility. `maxWidth` is never used. `useObjectStreams: false` can increase output size despite comments claiming it reduces size (`app.js:554-618`). |
| High | Memory and responsiveness | Every page is rendered eagerly and sequentially at scale 1.5 on the main UI flow. A simple A4 page uses about 4.5 MB for its canvas alone; the three-page fixture retained about 13.5 MB. A 100-page document can consume hundreds of MB before PDF.js caches and temporary export canvases are counted (`app.js:72-179`). |
| High | Stale async work | Render calls are not awaited by their callers and cannot be cancelled. Fast rotate/delete/watermark actions can overlap, race while clearing the container, and leave the loading state incorrect (`app.js:63`, `app.js:190-193`, `app.js:452-460`, `app.js:477-482`). |
| Medium | Export inconsistency | Split and PDF-to-image operate on original pages and ignore current deletes, order, rotations, watermark, and annotations. Redacted export ignores rotation and watermark. Different buttons therefore export different interpretations of the same visible document. |
| Medium | Prompt cancellation | Rotate and rearrange dereference a cancelled prompt (`null.toLowerCase()` / `null.split()`), causing an exception (`app.js:426-428`, `app.js:464-466`). |
| Medium | Pointer handling | Redaction is mouse-only, does not support touch or keyboard, records CSS pixels without a durable page transform, and listens for mouseup only on the canvas. Releasing outside can strand the gesture/listeners (`app.js:124-176`). |
| Medium | Error recovery | Most async handlers have no `try/catch/finally`. Invalid/encrypted PDFs, corrupt images, allocation failures, and worker/CDN failures can leave the loading overlay visible or produce only a console error. |
| Medium | Resource cleanup | Object URLs are never revoked, PDF.js loading/render tasks and documents are never destroyed, and large canvases are retained until the full rerender replaces the container (`app.js:323-335`). |
| Medium | Accessibility and mobile | File input has no label, page canvases have no accessible names or text alternative, state changes use blocking alerts, controls lack selection/disabled state, and fixed-resolution canvases overflow small screens. |

### Important product limitation

The current pdf-lib engine can add content and edit form fields, but its official limitations state that it cannot extract, remove, or edit ordinary page text. It also does not support encrypted PDFs. A feature called "edit existing text" or structural secure redaction therefore requires a different engine or an optional service; it must not be promised as a thin UI addition.

References:

- [PDF.js current documentation and distribution](https://mozilla.github.io/pdf.js/getting_started/)
- [PDF.js rendering example, including HiDPI handling](https://mozilla.github.io/pdf.js/examples/)
- [pdf-lib features and limitations](https://github.com/Hopding/pdf-lib#limitations)
- [Vite guide](https://vite.dev/guide/)
- [Vitest browser mode](https://vitest.dev/guide/browser/)
- [Playwright local web-server testing](https://playwright.dev/docs/test-webserver)
- [Vite deployment to GitHub Pages](https://vite.dev/guide/static-deploy.html#github-pages)
- [GitHub Pages publishing with GitHub Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Service-worker offline operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)

## Product principles

1. Local-first and private by default: opening or editing a document must not upload it.
2. Lossless by default: structural operations preserve searchable text, vectors, links, forms, metadata, page boxes, and original dimensions unless the user explicitly chooses a destructive transform.
3. One document truth: every preview and every exporter consumes the same ordered document model.
4. Reversible editing: all actions support undo/redo and never mutate the source bytes.
5. Honest operations: distinguish visual cover-up, secure raster redaction, lossy compression, and lossless optimization in the UI.
6. Progressive work: render only what is visible, cancel stale jobs, and keep the UI responsive for large files.
7. Verifiable output: validate exported page count/order/rotation and add golden visual and semantic regression tests.

## Recommended architecture

### Technology baseline

- Vite + React + strict TypeScript.
- CSS modules or a small token-based CSS layer; remove Bootstrap, jQuery, and Popper.
- `pdfjs-dist` installed and pinned for parsing, rendering, text layers, outlines, and thumbnails.
- `pdf-lib` installed and pinned behind a narrow writer adapter for page copying, forms, annotations, metadata, and generated content.
- Web Workers for document parsing coordination, image conversion, compression, and export. PDF.js should use its real worker, never a CDN fallback/fake worker.
- Vitest for domain/unit tests and browser component tests; Playwright for end-to-end workflows and downloads.
- IndexedDB for optional crash/session recovery, storing source bytes and the operation log locally.
- A generated service worker and web app manifest, with all core assets self-hosted and precached.
- GitHub Actions for clean install, quality checks, production build, offline smoke test, and Pages deployment.

Do not introduce a backend or make the GitHub Pages application depend on an external service. Features that fundamentally require server-side compute, shared state, or secrets belong in a separate product and must never be required for the hosted editor to function.

### Capability boundary under static hosting

Good fits for the independent GitHub Pages application:

- PDF viewing, thumbnails, outlines, local text search, page extraction, splitting, merging, reordering, duplication, rotation, and deletion.
- JPEG/PNG/WebP import through browser decoders, annotations, signatures, stamps, watermarks, page numbers, metadata editing, and form filling where the PDF engine supports them.
- Secure raster redaction of selected pages, local document sanitization, and explicit lossy raster export.
- Local OCR or scan cleanup only if a bundled worker/WASM engine fits the download, memory, licensing, and browser-compatibility budgets.
- Offline use, installable PWA behaviour, and opt-in local session recovery.

Not promised by this architecture:

- True editing of arbitrary existing PDF text with pdf-lib.
- Server-assisted OCR, cloud storage, accounts, shared links, real-time collaboration, or cross-device sync.
- Password removal/decryption that the bundled PDF engine cannot perform.
- Jobs that continue after the browser closes or workloads beyond browser memory/storage limits.

### Core model

```ts
type PageId = string;

interface PageRef {
  id: PageId;
  sourceDocumentId: string;
  sourcePageIndex: number;
  rotationDelta: 0 | 90 | 180 | 270;
  cropBox?: Rect;
  overlays: Overlay[];
}

interface EditorDocument {
  sources: Map<string, SourceDocument>;
  pages: PageRef[];          // The authoritative visible/export order
  selection: Set<PageId>;
  history: Command[];
  historyIndex: number;
}
```

Every command (`DeletePages`, `MovePages`, `RotatePages`, `AddWatermark`, `AddRedaction`) operates on stable page IDs. Renderers and exporters accept this model rather than maintaining parallel global variables.

### Module boundaries

```text
src/
  app/                 application shell, routing, error boundaries
  domain/              document model, commands, undo/redo, validation
  features/
    import/
    pages/
    annotate/
    redact/
    export/
    forms/
  pdf/
    pdfjs-renderer.ts   preview/text/outline adapter
    pdf-lib-writer.ts  structural export adapter
    coordinate-space.ts
    capability-scan.ts
  workers/             render/export/image worker entry points
  storage/             IndexedDB recovery and preferences
  ui/                  accessible reusable components and design tokens
tests/
  fixtures/            tiny deterministic PDFs covering edge cases
  unit/
  browser/
  e2e/
```

### Rendering strategy

- Thumbnail rail plus one-page/facing-page workspace instead of rendering the whole document at full size.
- IntersectionObserver-based virtualization with a small render window around the viewport.
- Render-task cancellation on zoom, rotation, file replacement, and rapid scrolling.
- Separate CSS dimensions from device-pixel canvas dimensions for crisp HiDPI output.
- Cap resident canvases and release backing stores (`canvas.width = 0`) when evicted.
- Cache thumbnails by `(source, page, rotation, scale bucket)` with an explicit memory budget.
- Use one coordinate-transform utility for viewport, PDF points, rotation, crop boxes, and overlay hit-testing.

### Export strategy

- Build an immutable export snapshot so UI changes cannot race an in-progress save.
- Copy pages in `document.pages` order, preserving source boxes and existing rotation before applying deltas.
- Apply overlays in PDF coordinates using a single tested transform.
- Preserve searchable/vector content for ordinary saves.
- For secure redaction, rasterize only affected pages at a user-selected DPI, rebuild those pages, strip risky document data by policy, and warn that affected pages lose search/forms/links. Offer optional OCR as a separate later step.
- Provide named presets rather than a vague Compress button:
  - Lossless optimize: object streams, duplicate-resource cleanup where supported, no rasterization.
  - Balanced image compression: downsample only oversized embedded images when the engine can do so safely.
  - Flatten/rasterize: explicit destructive export with DPI and JPEG quality controls.
- Verify the generated file before download: reopen it, check page count/order/dimensions/rotation, and surface a recoverable error if validation fails.

## Delivery roadmap

### Milestone 0 - Baseline and decisions

- Add README, license decision, package/lockfile, formatting, linting, strict type checking, CI, and contribution guidance.
- Preserve the current prototype on a `legacy` tag or branch.
- Add representative fixtures: portrait/landscape, rotated/cropped, forms, links/outlines, images/transparency, large page count, corrupt file, and encrypted file.
- Record architecture decisions for browser-only processing, supported browsers, maximum file/page sizes, privacy, local persistence, offline updates, and redaction semantics.
- Add the GitHub Actions Pages pipeline using `npm ci`, tests, production build, Pages configuration, artifact upload, and deployment.
- Configure and test Vite's `/PDF-Editor/` base path. Keep custom-domain `/` deployment as an explicit build option rather than hard-coding absolute root URLs.
- Add bundle-size reporting and fail CI when core startup assets exceed an agreed budget.

Exit: reproducible install/build/test/deploy commands, a documented support matrix, and a production artifact that works from the GitHub Pages repository subpath with no third-party network requests.

### Milestone 1 - Reliable editor foundation

- New application shell with drag/drop and file picker, clear empty/loading/error states, keyboard navigation, and responsive layout.
- Immutable document/page model with selection, multi-select, command history, undo/redo, and dirty state.
- Virtualized thumbnails and workspace with zoom, fit-width, fit-page, page navigation, outline view, and text layer.
- Import validation based on file signatures, not MIME alone; friendly handling for corrupt/encrypted/oversized PDFs.
- Add the web app manifest and service worker. Precache the shell, PDF.js worker, fonts, icons, and any required WASM; provide an update-ready notification rather than silently replacing a running editor.
- Add an end-to-end offline test that loads the deployed build once, disables network access, reloads, opens a local fixture, edits it, and exports it.

Exit: a 100-page fixture can be browsed without eager full-document rendering, rapid navigation does not race or leak canvases, and the core editor works offline after the first successful load.

### Milestone 2 - Structural editing and dependable export

- Drag-and-drop reorder, delete, rotate, duplicate, extract, split by ranges, and merge multiple files.
- Save/export pipeline driven by the authoritative page model.
- Multi-file image import supporting JPEG and PNG initially, EXIF orientation, page-size presets, margins, contain/cover, and per-image ordering.
- Download naming, overwrite-safe names, progress, cancellation, and output validation.

Exit: every operation is covered by unit and end-to-end tests that reopen the exported PDF and verify page identity, order, dimensions, and rotation.

### Milestone 3 - Annotation and document tools

- Text boxes, freehand ink, highlight, shapes, links, stamps, signatures, and page numbers.
- Watermark controls for text/image, opacity, angle, tiling, page range, and live preview.
- Metadata viewer/editor, outline viewer, attachment inventory, and form filling/flattening.
- Copy/paste, keyboard shortcuts, alignment/snapping, and per-overlay undo/redo.

Exit: annotations use the same tested coordinate space at every zoom/rotation and remain correctly placed after export.

### Milestone 4 - Redaction, optimization, and hardening

- Separate "cover" annotations from "secure redaction" so users cannot confuse them.
- Redaction review list, searchable-text matching, repeat-on-pages, secure export, and post-export token checks where text remains extractable.
- Explicit lossless, balanced, and raster compression presets with before/after estimates.
- Metadata/attachment sanitization options, password/encryption capability messaging, cancellation, worker crash recovery, and memory-pressure handling.
- Harden the established PWA update/cache lifecycle, add cache diagnostics, and enforce a strict content-security policy that permits only self-hosted production assets.

Exit: security-focused tests prove that redacted tokens are absent from extractable content for the chosen secure mode; destructive fidelity changes are disclosed before export.

### Milestone 5 - Feature expansion

Prioritize from real usage data:

- OCR and deskew for scanned pages.
- Crop, resize, deskew, background cleanup, and scan enhancement.
- Bates numbering, headers/footers, templates, and batch processing.
- Side-by-side compare and page-difference view.
- Local session recovery and recent-document entries that store only user-approved local data.
- Internationalization, high-contrast mode, reduced motion, and complete touch support.
- Optional downloadable static release archive for organizations that want to host the same build independently of GitHub Pages.

## Sprint plan

Planning assumption: two-week sprints with one primary implementation stream. The sequence is dependency-driven; estimates should be recalibrated after the first two future sprints rather than treated as fixed release dates. The foundation and structural-editing slices already delivered are shown for context.

| Sprint | Status | Goal | Committed scope | Acceptance gate |
| --- | --- | --- | --- | --- |
| 0 — Foundation | Complete | Replace the legacy prototype safely | React/TypeScript/Vite foundation, bundled PDF engines, immutable history, virtualized preview, PWA shell, Pages CI | Local-only production build passes unit, browser, offline, and `/PDF-Editor/` tests |
| 1 — Structural editing | Complete | Make page assembly dependable | Multi-PDF merge, JPEG/PNG import, reorder, rotate, delete, duplicate, extract PDF, page-to-PNG, zoom, watermark, output verification | Multi-source exports reopen with the expected count, order, sizes, and rotations |
| 2 — Navigation and selection | Complete | Make large documents efficient to operate | Multi-select with Shift/Cmd/Ctrl, select ranges/all, bulk page commands, page-number navigation, fit width/page, keyboard map, outline panel, local text search | A 100-page fixture is searchable and bulk editable without eager full-page rendering or lost focus |
| 3 — Annotation kernel | Complete | Establish one trustworthy overlay system | Coordinate-space module, text boxes, highlight, underline/strikeout, rectangles/ellipses/lines, resize/move handles, style controls, copy/paste, snapping, per-overlay history | Every annotation round-trips at 0/90/180/270° and at multiple zoom levels in preview and export |
| 4 — Ink, signatures, and page branding | Planned | Complete common markup and signing workflows | Pointer/pen drawing, eraser, typed/drawn/uploaded signatures, reusable local stamps, image watermarks, watermark range/tiling controls, page numbers, headers/footers | Mouse, touch, pen, and keyboard paths work; signatures remain local and are clearly distinguished from cryptographic signing |
| 5 — Forms and document structure | Planned | Support business-document workflows | AcroForm discovery and filling, flatten-copy export, metadata editor, outline/bookmark viewer, link tool, attachment inventory, document properties | Supported fields preserve values through normal export; flattening is explicit and tested separately |
| 6 — Secure redaction | Planned | Replace the unsafe legacy redaction model | Cover annotation vs secure-redaction distinction, selection drawing, search-and-mark results, review list, page-range application, affected-page raster export, clear fidelity warnings | Security tests confirm target tokens are absent from extractable output and affected pages disclose lost links/forms/search |
| 7 — Optimization and sanitization | Planned | Restore compression without hidden damage | Lossless optimize, balanced image downsampling, explicit raster preset, size estimate/comparison, metadata and attachment sanitization, cancellable progress | Each preset states what changes; tests compare semantics, visual tolerance, page geometry, and resulting size |
| 8 — OCR and scan tools | Planned | Make scanned documents useful offline | Lazy-loaded local OCR engine spike, language-pack strategy, OCR text layer, deskew, crop, rotate, background cleanup, page-level processing controls | OCR is optional and does not inflate core startup; supported scans become searchable offline within measured memory limits |
| 9 — Recovery and 1.0 hardening | Planned | Make the editor resilient enough for sustained use | Opt-in IndexedDB session recovery, autosave operation log, storage dashboard, interrupted-update recovery, performance budgets, accessibility audit, touch completion, downloadable static release | Recovery survives reload without uploading data; zero critical accessibility issues; Pages and downloadable builds pass the full regression suite |

### Release increments

- Preview release after Sprint 2: dependable page workspace for larger documents. **Ready.**
- Alpha after Sprint 4: structural editing, annotation, drawing, signatures, and branding.
- Beta after Sprint 6: forms, document inspection, and secure redaction.
- Release candidate after Sprint 8: compression, sanitization, OCR, and scan cleanup.
- Version 1.0 after Sprint 9: recovery, accessibility, performance, and deployment hardening complete.

### Definition of done for every sprint

- New document actions are reversible and use stable page or overlay identities.
- Preview and export consume the same authoritative model and coordinate transforms.
- Lossless operations preserve searchable text, vectors, links, forms, metadata, boxes, and page dimensions unless the feature explicitly promises otherwise.
- Destructive operations name the expected fidelity loss before processing begins.
- Unit tests cover state and geometry; browser tests exercise the user workflow and reopen exported PDFs for semantic checks.
- Production tests run at `/PDF-Editor/`, offline after initial caching, and fail on third-party network requests.
- Long-running work reports progress, supports cancellation where technically possible, releases temporary canvases and object URLs, and leaves the source file untouched on failure.
- The README, capability boundary, and accessibility labels are updated with the implementation.

### Deferred research track

True modification of arbitrary existing PDF text is not committed to a delivery sprint. Sprint 5 includes a bounded engine evaluation covering licensing, bundle size, browser compatibility, fidelity, and GitHub Pages constraints. Until that evaluation succeeds, the product will support adding text overlays and editing form fields without claiming Acrobat-style structural text editing.

## Test and quality strategy

### Unit and property tests

- Command invariants: page IDs remain unique, undo/redo round-trips, and reorder/delete/duplicate compositions are deterministic.
- Coordinate transforms round-trip between PDF points and viewport pixels for every rotation and crop-box combination.
- Page-range parser handles cancellation, duplicates, reversed ranges, bounds, and mixed syntax.
- Export plans never reference missing sources or deleted page IDs.

### Browser and end-to-end tests

- Open, render, reorder, rotate, delete, merge, annotate, export, and reopen.
- Verify keyboard and touch/pointer paths, focus order, accessible names, and status announcements.
- Golden screenshots at representative zooms, DPRs, page sizes, and rotations.
- Download validation through Playwright with the app's local test server managed by test configuration.
- Run the production build from both `/` and `/PDF-Editor/` paths to catch broken asset, worker, manifest, and service-worker URLs.
- Block all non-local network requests during tests and fail if the app attempts to contact a third-party origin.
- Test first-load caching, full offline reload, cache-version upgrades, and recovery from an interrupted update.

### PDF semantic checks

- Page count, dimensions, boxes, rotations, metadata, outlines, links, fields, attachments, and extracted text before/after lossless edits.
- Visual render comparison with explicit tolerances for supported fixtures.
- File-size comparison is a metric, not the sole definition of compression success.
- Corrupt, truncated, encrypted, unusually large, and image-heavy fixtures must fail gracefully.

### Performance budgets

- Render only the visible page plus a small prefetch window; keep no more than a configured number of full-size canvases resident.
- Keep interaction work in short tasks and make every long operation cancellable.
- Track time to first page, scroll/render latency, peak resident canvas bytes, export time, and output size in repeatable benchmarks.
- Add CI regression thresholds after measuring the first rewritten baseline rather than inventing absolute targets now.
- Track compressed and uncompressed JavaScript, worker, WASM, font, and precache sizes. Large optional engines such as OCR must be lazy local chunks and must not inflate the core offline install unnecessarily.

## Recommended first implementation slice

Build Milestones 0 and 1, then implement reorder/rotate/delete plus one correct export path from Milestone 2. This vertical slice proves the document model, worker boundary, coordinate handling, virtualization, undo/redo, and output validation before annotations or advanced features expand the surface area.

The first demo should be able to open the existing three-page portrait/landscape fixture, reorder it by drag and keyboard, rotate and delete pages, undo every action, export, reopen the result, and pass semantic assertions for page identity/order/size/rotation.

## Remaining product decisions

The hosting decision is fixed: the primary product is a self-contained GitHub Pages web/PWA application, all document processing is local, and no online service is required.

The remaining decisions are:

1. Does "edit PDF text" mean adding/replacing overlays, editing form fields, or true modification of existing page text? The third option is outside the current engine's capability.
2. What is the minimum supported browser/device and practical maximum document size?
3. Which feature wave matters most after structural editing: annotation/signing, redaction, local OCR/scanning, forms, or batch processing?
4. Should local recovery be off by default, opt-in per document, or enabled globally with a clear storage warning?
5. Is an independently downloadable copy of the static build required in addition to the hosted GitHub Pages version?
