# Image Annotation Workspace (Desktop)

Desktop image annotation app for bacteria morphology, powered by Electron.

## Features

- Load a local folder (including subfolders) of images.
- Dashboard with total images, categories, annotated count, and completion.
- Multi-image annotator (up to 4 images side-by-side).
- Per-image zoom/pan controls.
- Bacteria morphology sections with one selected option per section.
- Add custom morphology options in any section (shared across all images).
- Library and viewer pages for read-only browsing.
- Annotation persistence to local storage and `data.json` export path.

## Desktop Setup

1. Install Node.js LTS (which includes `npm`): https://nodejs.org/
2. From project root, install dependencies:

```bash
npm install
```

3. Start desktop app:

```bash
npm start
```

## Build Windows Installer

```bash
npm run dist
```

Installer output is generated in `dist/`.

## Project Structure

- `src/main/main.js`: Electron main process / desktop window bootstrap.
- `src/main/preload.js`: Secure renderer bridge for desktop IPC.
- `src/renderer/index.html`, `src/renderer/styles.css`, `src/renderer/app.js`: App UI and logic.
- `assets/icons/`: App icon assets.
- `data/data.json`: Annotation data output.
- `samples/dummy/`: Sample image datasets.

## Notes

- If `npm` is not recognized, Node.js is not installed or not added to PATH.
- Morphology custom options are saved and shared across images in the same dataset session.
