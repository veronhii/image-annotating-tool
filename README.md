# Image Annotation Workspace

Local, web-based image annotation tool that runs directly in your browser.

## Features

- Load a folder (including subfolders) of images from your local machine.
- Dashboard view with:
- Total images, categories, annotated count, completion percentage.
- Image previews.
- Category list with simple descriptions (derived from folder names).
- Start button to enter the annotation workspace.
- Annotation workspace with:
- Up to 4 images open at once for side-by-side comparison.
- Click any selected image to make it active for editing.
- Larger in-window image display for easier inspection.
- Zoom in/out/reset controls (plus mouse wheel zoom on image).
- `Float` button to open an image in a separate pop-out window.
- Right sidebar characteristics for active image:
- Image name (editable).
- Description (free text paragraph/short answer).
- Custom tag input.
- Reusable tag pool shared across images.
- Library page (read-only list of all images).
- Viewer page (read-only image + metadata display).
- Save current annotation automatically writes metadata to `data.json`.
- Reloading the same folder auto-restores metadata from saved data.

## Run Locally

This project is plain HTML/CSS/JS, so there is no build step.

1. Open `index.html` in a modern browser (Chrome/Edge recommended for folder picker support).
2. Click `Load Image Folder` and choose the top-level folder that contains your image subfolders.
3. Review dashboard stats and preview.
4. Click `Start Annotating` to begin labeling.

## Data Persistence

- Clicking `Save Annotation` stores all annotation metadata.
- The app writes to `data.json` (browser may ask you once to confirm file location/permission).
- Metadata is also cached locally in browser storage as backup.
- When you load the same folder again, metadata is automatically applied by matching `relativePath`.

## Notes

- Category names are inferred from the immediate parent folder of each image.
- An image is counted as annotated when it has description or at least one tag.
- JSON includes image paths, categories, description, and tags.