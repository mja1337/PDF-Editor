# PDF Editor

A private, local-first PDF workspace designed for GitHub Pages. Documents are opened, rendered, edited, and exported entirely in the browser. The production application has no backend and makes no required third-party requests.

## Current capabilities

- Open or merge multiple PDFs locally with signature, corruption, password, and size error handling.
- Convert local JPEG and PNG images into correctly fitted PDF pages.
- Virtualized page thumbnails and a focused HiDPI page preview.
- Reorder, rotate, delete, and duplicate pages with stable page identities.
- Extract the selected page to its own PDF or render it as a PNG.
- Apply and remove a document-wide text watermark with live preview.
- Zoom the focused page from 50% to 200%.
- Select individual pages, toggle selections, select ranges, or select all pages for bulk edits.
- Navigate by page number, keyboard, fit width, or fit page.
- Search extracted text across the complete local document and jump between matches.
- Analyse a document on demand to turn found text lines into editable boxes, with progress and cancellation. Scanned pages can use an optional on-device Tesseract OCR engine served from this GitHub Pages site after you agree.
- Browse embedded PDF outlines/bookmarks when present.
- Add text boxes, highlights, underlines, strikeouts, rectangles, ellipses, and lines.
- Select, move, resize, keyboard-nudge, recolour, restyle, copy, paste, duplicate, or delete annotations with undo/redo.
- Use keyboard-accessible right-click menus with page, canvas-placement, and annotation-specific actions.
- Export annotations through tested coordinate transforms at every quarter-turn page rotation.
- Undo and redo every document edit.
- Export the authoritative multi-source page order, rotations, duplicates, and watermark to a new PDF.
- Reopen and verify page count and rotations before offering an exported file.
- Responsive desktop and mobile controls.
- Installable PWA shell with offline caching and update prompts.
- Strict local-only content security policy.

Freehand ink, signatures, stamps, forms, secure redaction, compression presets, and recovery storage are planned in [OVERHAUL_PLAN.md](./OVERHAUL_PLAN.md).

## Development

Requires a current Node.js LTS release.

```bash
npm ci
npm run dev
```

Quality checks:

```bash
npm run lint
npm run test
npm run build
npm run test:e2e
npm run test:e2e:pages
```

## GitHub Pages

The workflow in `.github/workflows/pages.yml` tests and builds the application, then deploys `dist/` with `BASE_PATH=/PDF-Editor/`. Configure **Settings → Pages → Source** to **GitHub Actions** once for the repository.

For a custom domain hosted at its root, build with `BASE_PATH=/` instead.

## Privacy and independence

- Runtime dependencies, the PDF.js worker, the optional Tesseract OCR engine, the service worker, icons, and styles are self-hosted in the build.
- PDF bytes are not uploaded or sent to another origin. OCR, when enabled, reads page images only in this browser after downloading the engine from this GitHub Pages origin.
- The service worker precaches the application so it can reopen offline after the first successful visit.
- The application contains no credentials, analytics, ads, or remote fonts.
- Browser storage and memory limits still apply; the original file remains the user's source of truth.

## Known scope boundary

The current export engine does not rewrite original PDF content streams. Analysed text can be edited by covering the original line visually; the source glyphs remain until a later secure-redaction mode. Password decryption is not supported.

## License

No license has been selected for this repository yet. Add one before accepting external contributions or redistributing the project under defined terms.
