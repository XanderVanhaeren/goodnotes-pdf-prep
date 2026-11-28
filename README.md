# Goodnotes PDF Prep

A browser-based tool that prepares PDFs for [Goodnotes](https://www.goodnotes.com/): it adds a navigable bookmark outline (table of contents) and adjusts page margins, entirely client-side. Your files never leave your machine.

## Features

- **Bookmark outline** – detects numbered section titles (e.g. `1.1`, `2.3`, `4.4.2`, `Hoofdstuk 6`) and builds a hierarchical PDF outline.
- **Reuse existing outlines** – extracts the PDF's current bookmarks, or replaces them with the new ones.
- **Outline editor** – enable/disable bookmarks and edit section number, title, page and level before export.
- **Margins** – set top, left and right margins for writing space.
- **Dark mode**.

## Tech stack

React 19, Vite, [pdf-lib](https://pdf-lib.js.org/) (writing), [pdf.js](https://mozilla.github.io/pdf.js/) (reading), lucide-react. Linted with oxlint.

## Getting started

Requires Node.js 22+.

```bash
npm install
npm run dev      # start dev server
npm run build    # production build into dist/
npm run preview  # preview the build
npm run lint     # lint
```

## Windows launcher

Helper scripts (`goodnotesPDF.bat`, `Start Goodnotes PDF Prep.vbs`, `Start-Goodnotes-App.ps1`) start the dev server on `http://127.0.0.1:5173` and open it in a dedicated Edge window. They contain hard-coded paths, so edit the project folder to match your machine.

## Deployment

Pushes to `main` are deployed to GitHub Pages via `.github/workflows`.
