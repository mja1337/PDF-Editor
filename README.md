# pdfe

A private, local-first PDF workspace designed for GitHub Pages. Documents are opened, rendered, edited, and exported entirely in the browser. The production application has no backend and makes no required third-party requests.

## Current capabilities

- Open or merge multiple PDFs locally with signature, corruption, password, and size error handling.
- Convert DOCX, DOC, PPTX and PPT files to PDF locally from the opening screen, with filename, image-quality and page/slide selection options. Download the result or open it in the editor.
- Convert local JPEG and PNG images into correctly fitted PDF pages.
- Virtualized page thumbnails and a focused HiDPI page preview.
- Reorder, rotate, delete, and duplicate pages with stable page identities.
- Extract the selected page to its own PDF or render it as a PNG.
- Apply and remove a document-wide text watermark with live preview.
- Zoom the focused page from 50% to 200%.
- Select individual pages, toggle selections, select ranges, or select all pages for bulk edits.
- Navigate by page number, keyboard, fit width, or fit page.
- Search native PDF text plus analysed/OCR lines and text-box annotations across the document.
- Analyse a document on demand to turn found text lines into editable boxes, with progress and cancellation. Scanned pages can use an optional on-device Tesseract OCR engine served from this GitHub Pages site after you agree.
- Export analysed tables to an Excel workbook with each distinct table on its own worksheet. Tables with matching column headers are consolidated throughout the document, and headerless continuations can be joined across consecutive pages.
- Browse embedded PDF bookmarks when the source file includes them (hidden for scans and most exports).
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

The current export engine does not rewrite original PDF content streams. Analysed text can be edited by covering the original line visually; the source glyphs remain until a later secure-redaction mode. Password-protected PDFs can be opened with the user password for this session; exported files are not re-encrypted unless you add that in a later release.

## License

No license has been selected for this repository yet. Add one before accepting external contributions or redistributing the project under defined terms.

## Office conversion

Drop one Word or PowerPoint file on the opening screen, or use **Choose files**. Select **Convert to PDF** with the defaults, or expand **Advanced options** first. Conversion preserves the source page/slide dimensions. The resulting PDF is checked before download or opening in the editor. Inputs are limited to 100 MB; conversion can be cancelled and retried.

The pinned `@matbee/libreoffice-converter` 2.7.2 engine (LibreOffice, MPL-2.0) runs in a dedicated browser worker. Engine assets are copied from npm during the build and served from this site's `office/` directory; there is no conversion service or document upload. The two large assets are gzip-compressed at build time (about 75 MB total) and decompressed and cached on demand by the service worker. They are excluded from the editor's initial precache. Upstream source and build instructions: https://github.com/matbeedotcom/libreoffice-document-converter.

LibreOffice requires cross-origin isolation. Development serves the required headers directly. On GitHub Pages, `office-runtime.js` extends the existing PWA service worker with isolation headers and engine asset caching. The first conversion may reload the app once; its file and settings are temporarily saved in IndexedDB and removed when restored. Conversion then resumes automatically. The rest of the editor remains available offline through its existing precache.

Use a current desktop browser with sufficient memory. The initial download/startup takes longer than subsequent conversions; complex files may still be slow. Unavailable fonts can be substituted, and complex Microsoft Office layouts may differ. Password-protected or damaged inputs may fail. Image-quality settings affect embedded image compression, not source layout. Page/slide ranges are applied to the converted PDF, so the engine still reads the whole input.
