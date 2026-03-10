const STORAGE_KEY = "annotationWorkspaceData";
const THEME_KEY = "annotationWorkspaceTheme";
const DEFAULT_THEME = "light";
const AVAILABLE_THEMES = new Set(["light", "dark", "sage-cream", "rose-moss", "clay-coffee", "slate-mist"]);

const state = {
  images: [],
  categories: new Map(),
  selectedForComparison: [],
  activeImageId: null,
  viewerImageId: null,
  currentView: "dashboard",
  autoSaveTimer: null,
  knownTags: new Set(),
  dataFileHandle: null,
  imageZoomById: new Map(),
  imagePanById: new Map(),
  dragState: null,
};

const els = {
  folderInput: document.getElementById("folderInput"),
  currentFolderLabel: document.getElementById("currentFolderLabel"),
  dashboardView: document.getElementById("dashboardView"),
  annotatorView: document.getElementById("annotatorView"),
  libraryView: document.getElementById("libraryView"),
  viewerView: document.getElementById("viewerView"),
  openAnnotatorBtn: document.getElementById("openAnnotatorBtn"),
  openLibraryBtn: document.getElementById("openLibraryBtn"),
  themeSelect: document.getElementById("themeSelect"),
  backFromAnnotatorBtn: document.getElementById("backFromAnnotatorBtn"),
  resetPickerBtn: document.getElementById("resetPickerBtn"),
  statTotalImages: document.getElementById("statTotalImages"),
  statCategories: document.getElementById("statCategories"),
  statAnnotated: document.getElementById("statAnnotated"),
  statCompletion: document.getElementById("statCompletion"),
  dashboardPreviewGrid: document.getElementById("dashboardPreviewGrid"),
  categoryList: document.getElementById("categoryList"),
  imagePickerList: document.getElementById("imagePickerList"),
  comparisonGrid: document.getElementById("comparisonGrid"),
  activeImageLabel: document.getElementById("activeImageLabel"),
  fieldImageName: document.getElementById("fieldImageName"),
  fieldDescription: document.getElementById("fieldDescription"),
  tagInput: document.getElementById("tagInput"),
  addTagBtn: document.getElementById("addTagBtn"),
  tagPool: document.getElementById("tagPool"),
  libraryList: document.getElementById("libraryList"),
  viewerContent: document.getElementById("viewerContent"),
  previewCardTemplate: document.getElementById("previewCardTemplate"),
  compareCardTemplate: document.getElementById("compareCardTemplate"),
  libraryItemTemplate: document.getElementById("libraryItemTemplate"),
};

void initialize();

async function initialize() {
  initializeTheme();

  els.folderInput.addEventListener("change", onFolderLoad);
  els.openAnnotatorBtn.addEventListener("click", () => showView("annotator"));
  els.openLibraryBtn.addEventListener("click", () => showView("library"));
  els.themeSelect.addEventListener("change", onThemeChange);
  els.backFromAnnotatorBtn.addEventListener("click", onBackButtonClick);
  els.resetPickerBtn.addEventListener("click", resetImagePickerSelection);
  els.fieldDescription.addEventListener("input", onDescriptionInputAutosave);
  els.fieldDescription.addEventListener("blur", () => {
    if (state.activeImageId) {
      void saveCurrentAnnotation();
    }
  });
  els.addTagBtn.addEventListener("click", addTagFromInput);
  els.tagInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTagFromInput();
    }
  });

  state.dataFileHandle = await readDataFileHandle();
  renderTagPool();
  showView("dashboard");
  refreshAll();
}

function initializeTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  const nextTheme = AVAILABLE_THEMES.has(savedTheme) ? savedTheme : DEFAULT_THEME;
  applyTheme(nextTheme);
}

function onThemeChange(event) {
  const nextTheme = event.target.value;
  if (!AVAILABLE_THEMES.has(nextTheme)) {
    return;
  }
  applyTheme(nextTheme);
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  els.themeSelect.value = theme;
}

async function onFolderLoad(event) {
  const files = Array.from(event.target.files || []);
  const sourceItems = files
    .filter((file) => file.type.startsWith("image/"))
    .map((file) => ({ file, relativePath: file.webkitRelativePath || file.name }));

  const folderName = sourceItems.length > 0
    ? String(sourceItems[0].relativePath).split("/")[0]
    : "none";
  els.currentFolderLabel.textContent = `Current folder: ${folderName}`;

  hydrateImagesFromSource(sourceItems);
  await restoreMetadataForLoadedImages();
  refreshAll();
}

function hydrateImagesFromSource(sourceItems) {
  clearObjectUrls();

  state.images = sourceItems.map((item, index) => {
    const pathParts = item.relativePath.split("/");
    const category = pathParts.length > 1 ? pathParts[pathParts.length - 2] : "uncategorized";
    const objectUrl = URL.createObjectURL(item.file);
    const id = String(index + 1);
    state.imageZoomById.set(id, 1);
    state.imagePanById.set(id, { x: 0, y: 0 });

    return {
      id,
      file: item.file,
      objectUrl,
      relativePath: item.relativePath,
      category,
      annotation: {
        imageName: item.file.name,
        description: "",
        tags: [],
      },
    };
  });

  state.categories = buildCategories(state.images);
  state.selectedForComparison = [];
  state.activeImageId = null;
  state.viewerImageId = null;
  state.knownTags = new Set();

  if (state.images.length > 0) {
    addToComparison(state.images[0].id);
    state.viewerImageId = state.images[0].id;
  }
}

async function restoreMetadataForLoadedImages() {
  const localData = readLocalMetadata();
  const fileData = await readDataFileMetadata();
  const payload = chooseNewestPayload(localData, fileData);

  if (!payload || !Array.isArray(payload.items)) {
    renderTagPool();
    return;
  }

  const map = new Map(payload.items.map((item) => [item.relativePath, item]));

  state.images.forEach((image) => {
    const saved = map.get(image.relativePath);
    if (!saved || !saved.annotation) {
      return;
    }

    image.annotation.imageName = image.file.name;
    image.annotation.description = saved.annotation.description || "";
    image.annotation.tags = normalizeTags(saved.annotation.tags || []);
    image.annotation.tags.forEach((tag) => state.knownTags.add(tag));
  });

  renderTagPool(getImageById(state.activeImageId)?.annotation.tags || []);
}

function chooseNewestPayload(first, second) {
  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  const firstTime = Date.parse(first.createdAt || "") || 0;
  const secondTime = Date.parse(second.createdAt || "") || 0;
  return firstTime >= secondTime ? first : second;
}

function readLocalMetadata() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function readDataFileMetadata() {
  const handle = state.dataFileHandle;
  if (!handle) {
    return null;
  }

  try {
    if (!(await ensureFilePermission(handle, "read", true))) {
      return null;
    }

    const file = await handle.getFile();
    const text = await file.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function normalizeTag(tag) {
  return String(tag).trim().toLowerCase();
}

function normalizeTags(tags) {
  const unique = new Set();
  const normalized = [];

  tags.forEach((tag) => {
    const value = normalizeTag(tag);
    if (!value || unique.has(value)) {
      return;
    }
    unique.add(value);
    normalized.push(value);
  });

  return normalized;
}

function clearObjectUrls() {
  state.images.forEach((image) => {
    if (image.objectUrl) {
      URL.revokeObjectURL(image.objectUrl);
    }
  });
}

function buildCategories(images) {
  const categories = new Map();

  images.forEach((image) => {
    if (!categories.has(image.category)) {
      categories.set(image.category, {
        count: 0,
        sample: image,
      });
    }

    categories.get(image.category).count += 1;
  });

  return categories;
}

function showView(target) {
  state.currentView = target;

  const map = {
    dashboard: els.dashboardView,
    annotator: els.annotatorView,
    library: els.libraryView,
    viewer: els.viewerView,
  };

  Object.entries(map).forEach(([key, element]) => {
    element.classList.toggle("hidden", key !== target);
  });

  if (target === "viewer") {
    renderViewer();
  }
}

function onBackButtonClick() {
  if (state.currentView === "viewer") {
    showView("library");
    return;
  }

  showView("dashboard");
}

function refreshAll() {
  renderStats();
  renderDashboardPreview();
  renderCategories();
  renderImagePicker();
  renderComparisonGrid();
  renderActiveAnnotation();
  renderLibraryList();
  renderViewer();
  updateActionButtons();
}

function renderStats() {
  const totalImages = state.images.length;
  const totalCategories = state.categories.size;
  const annotatedCount = state.images.filter(isAnnotated).length;
  const completion = totalImages === 0 ? 0 : Math.round((annotatedCount / totalImages) * 100);

  els.statTotalImages.textContent = String(totalImages);
  els.statCategories.textContent = String(totalCategories);
  els.statAnnotated.textContent = String(annotatedCount);
  els.statCompletion.textContent = `${completion}%`;
}

function isAnnotated(image) {
  const annotation = image.annotation;
  return Boolean(annotation.description.trim() || annotation.tags.length > 0);
}

function renderDashboardPreview() {
  els.dashboardPreviewGrid.innerHTML = "";

  if (state.images.length === 0) {
    els.dashboardPreviewGrid.className = "dashboard-preview-grid empty-state";
    els.dashboardPreviewGrid.textContent = "Load a folder to see image previews.";
    return;
  }

  els.dashboardPreviewGrid.className = "dashboard-preview-grid";
  state.images.slice(0, 8).forEach((image) => {
    const fragment = els.previewCardTemplate.content.cloneNode(true);
    fragment.querySelector("img").src = image.objectUrl;
    fragment.querySelector("img").alt = image.file.name;
    fragment.querySelector(".preview-name").textContent = image.file.name;
    fragment.querySelector(".preview-category").textContent = image.category;
    els.dashboardPreviewGrid.appendChild(fragment);
  });
}

function renderCategories() {
  els.categoryList.innerHTML = "";

  if (state.categories.size === 0) {
    els.categoryList.className = "category-list empty-state";
    els.categoryList.textContent = "Categories and descriptions appear after loading images.";
    return;
  }

  els.categoryList.className = "category-list";
  state.categories.forEach((info, categoryName) => {
    const row = document.createElement("article");
    row.className = "category-row";

    const title = document.createElement("strong");
    title.textContent = `${categoryName} (${info.count})`;

    const desc = document.createElement("p");
    desc.textContent = `Contains ${info.count} images. Example: ${info.sample.file.name}`;

    row.append(title, desc);
    els.categoryList.appendChild(row);
  });
}

function renderImagePicker() {
  els.imagePickerList.innerHTML = "";

  if (state.images.length === 0) {
    els.imagePickerList.className = "image-picker-list empty-state";
    els.imagePickerList.textContent = "No images loaded.";
    return;
  }

  els.imagePickerList.className = "image-picker-list";
  state.images.forEach((image) => {
    const included = state.selectedForComparison.includes(image.id);
    const row = document.createElement("div");
    row.className = "picker-row";
    row.classList.add(isAnnotated(image) ? "annotated" : "unannotated");

    const thumbnail = document.createElement("img");
    thumbnail.src = image.objectUrl;
    thumbnail.alt = image.file.name;
    thumbnail.className = "picker-thumbnail";

    const info = document.createElement("div");
    info.className = "picker-info";

    const fileName = document.createElement("p");
    fileName.className = "picker-filename";
    fileName.textContent = image.file.name;

    const filePath = document.createElement("p");
    filePath.className = "picker-path";
    filePath.textContent = image.relativePath;

    const status = document.createElement("span");
    const annotated = isAnnotated(image);
    status.className = annotated ? "picker-status status-annotated" : "picker-status status-unannotated";
    status.textContent = annotated ? "Annotated" : "Unannotated";

    info.append(fileName, filePath, status);

    row.addEventListener("click", () => {
      if (included) {
        removeFromComparison(image.id);
        refreshAll();
      } else if (state.selectedForComparison.length < 4) {
        addToComparison(image.id);
        refreshAll();
      }
    });

    if (included) {
      row.classList.add("selected");
    }

    row.append(thumbnail, info);
    els.imagePickerList.appendChild(row);
  });
}

function resetImagePickerSelection() {
  state.selectedForComparison = [];
  state.activeImageId = null;
  refreshAll();
}

function onDescriptionInputAutosave() {
  const image = getImageById(state.activeImageId);
  if (!image) {
    return;
  }

  image.annotation.description = els.fieldDescription.value;
  queueAutoSaveCurrentAnnotation();
}

function queueAutoSaveCurrentAnnotation() {
  if (state.autoSaveTimer) {
    clearTimeout(state.autoSaveTimer);
  }

  state.autoSaveTimer = setTimeout(() => {
    state.autoSaveTimer = null;
    void saveCurrentAnnotation();
  }, 350);
}

function addToComparison(imageId) {
  if (state.selectedForComparison.includes(imageId)) {
    state.activeImageId = imageId;
    return;
  }

  if (state.selectedForComparison.length >= 4) {
    return;
  }

  state.selectedForComparison.push(imageId);
  state.activeImageId = imageId;
}

function removeFromComparison(imageId) {
  state.selectedForComparison = state.selectedForComparison.filter((id) => id !== imageId);

  if (state.activeImageId === imageId) {
    state.activeImageId = state.selectedForComparison[0] || null;
  }
}

function renderComparisonGrid() {
  els.comparisonGrid.innerHTML = "";

  if (state.selectedForComparison.length === 0) {
    els.comparisonGrid.className = "comparison-grid empty-state";
    els.comparisonGrid.textContent = "Pick images from the list below to compare and annotate.";
    return;
  }

  els.comparisonGrid.className = "comparison-grid";
  els.comparisonGrid.dataset.count = String(state.selectedForComparison.length);

  state.selectedForComparison.forEach((id) => {
    const image = getImageById(id);
    if (!image) {
      return;
    }

    const fragment = els.compareCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".compare-card");
    const img = fragment.querySelector("img");
    const viewport = fragment.querySelector(".compare-image-viewport");
    const name = fragment.querySelector(".compare-name");
    const category = fragment.querySelector(".compare-category");
    const closeButton = fragment.querySelector(".close-compare");
    const resetViewBtn = fragment.querySelector(".reset-view");
    const zoomInBtn = fragment.querySelector(".zoom-in");
    const zoomOutBtn = fragment.querySelector(".zoom-out");
    const zoomResetDisplayBtn = fragment.querySelector(".zoom-reset-display");

    const zoom = getZoom(image.id);
    const pan = getPan(image.id);
    img.src = image.objectUrl;
    img.alt = image.file.name;
    img.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    name.textContent = image.file.name;
    category.textContent = `${image.category} | zoom ${zoom.toFixed(1)}x | drag to move`;
    zoomResetDisplayBtn.textContent = `${zoom.toFixed(1)}x`;

    if (state.activeImageId === image.id) {
      card.classList.add("active");
    }

    card.addEventListener("click", () => {
      state.activeImageId = image.id;
      renderComparisonGrid();
      renderActiveAnnotation();
      updateActionButtons();
    });

    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.deltaY < 0 ? 0.1 : -0.1;
      zoomImage(image.id, delta);
    }, { passive: false });

    viewport.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      startImageDrag(event, image.id, viewport, img);
    });

    viewport.addEventListener("pointermove", (event) => {
      updateImageDrag(event, image.id);
    });

    const endDrag = (event) => {
      finishImageDrag(event, image.id, viewport);
    };

    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);
    viewport.addEventListener("pointerleave", endDrag);

    zoomInBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      zoomImage(image.id, 0.2);
    });

    zoomOutBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      zoomImage(image.id, -0.2);
    });

    zoomResetDisplayBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setZoom(image.id, 1);
    });

    resetViewBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setZoom(image.id, 1);
      setPan(image.id, 0, 0);
      renderComparisonGrid();
    });

    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeFromComparison(image.id);
      refreshAll();
    });

    els.comparisonGrid.appendChild(fragment);
  });
}

function getZoom(imageId) {
  return state.imageZoomById.get(imageId) || 1;
}

function setZoom(imageId, value) {
  const clamped = Math.max(0.4, Math.min(4, value));
  state.imageZoomById.set(imageId, clamped);
  renderComparisonGrid();
}

function zoomImage(imageId, delta) {
  setZoom(imageId, getZoom(imageId) + delta);
}

function getPan(imageId) {
  return state.imagePanById.get(imageId) || { x: 0, y: 0 };
}

function setPan(imageId, x, y) {
  state.imagePanById.set(imageId, { x, y });
}

function startImageDrag(event, imageId, viewport, imgElement) {
  const pan = getPan(imageId);
  state.dragState = {
    pointerId: event.pointerId,
    imageId,
    startX: event.clientX,
    startY: event.clientY,
    panStartX: pan.x,
    panStartY: pan.y,
    imgElement,
  };

  viewport.classList.add("dragging");
  if (viewport.setPointerCapture) {
    viewport.setPointerCapture(event.pointerId);
  }
}

function updateImageDrag(event, imageId) {
  const drag = state.dragState;
  if (!drag || drag.imageId !== imageId || drag.pointerId !== event.pointerId) {
    return;
  }

  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  const nextX = drag.panStartX + dx;
  const nextY = drag.panStartY + dy;
  setPan(imageId, nextX, nextY);
  const zoom = getZoom(imageId);
  drag.imgElement.style.transform = `translate(${nextX}px, ${nextY}px) scale(${zoom})`;
}

function finishImageDrag(event, imageId, viewport) {
  const drag = state.dragState;
  if (!drag || drag.imageId !== imageId || drag.pointerId !== event.pointerId) {
    return;
  }

  state.dragState = null;
  viewport.classList.remove("dragging");
  if (viewport.releasePointerCapture && viewport.hasPointerCapture(event.pointerId)) {
    viewport.releasePointerCapture(event.pointerId);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderActiveAnnotation() {
  const image = getImageById(state.activeImageId);
  const disabled = !image;

  els.fieldImageName.disabled = true;
  els.fieldDescription.disabled = disabled;
  els.tagInput.disabled = disabled;
  els.addTagBtn.disabled = disabled;

  if (!image) {
    els.activeImageLabel.textContent = "No image selected";
    els.fieldImageName.value = "";
    els.fieldDescription.value = "";
    renderTagPool();
    return;
  }

  els.activeImageLabel.textContent = image.relativePath;
  els.fieldImageName.value = image.file.name;
  els.fieldDescription.value = image.annotation.description;
  renderTagPool(image.annotation.tags);
}

function renderTagPool(activeTags = []) {
  els.tagPool.innerHTML = "";

  const tags = Array.from(state.knownTags).sort((a, b) => a.localeCompare(b));
  if (tags.length === 0) {
    els.tagPool.className = "tag-pool empty-state";
    els.tagPool.textContent = "No tags created yet.";
    return;
  }

  els.tagPool.className = "tag-pool";
  tags.forEach((tag) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-chip";
    chip.textContent = tag;

    if (activeTags.includes(tag)) {
      chip.classList.add("selected");
    }

    chip.disabled = !state.activeImageId;
    chip.addEventListener("click", () => {
      toggleTag(tag);
    });

    els.tagPool.appendChild(chip);
  });
}

function addTagFromInput() {
  const image = getImageById(state.activeImageId);
  if (!image) {
    return;
  }

  const tag = normalizeTag(els.tagInput.value);
  if (!tag) {
    return;
  }

  state.knownTags.add(tag);
  if (!image.annotation.tags.includes(tag)) {
    image.annotation.tags.push(tag);
  }

  image.annotation.tags = normalizeTags(image.annotation.tags);
  els.tagInput.value = "";
  renderTagPool(image.annotation.tags);
  updateActionButtons();
  void saveCurrentAnnotation();
}

function toggleTag(tag) {
  const image = getImageById(state.activeImageId);
  if (!image) {
    return;
  }

  const normalized = normalizeTag(tag);
  const tags = normalizeTags(image.annotation.tags);
  const index = tags.indexOf(normalized);

  if (index >= 0) {
    tags.splice(index, 1);
  } else {
    tags.push(normalized);
  }

  image.annotation.tags = normalizeTags(tags);
  renderTagPool(image.annotation.tags);
  updateActionButtons();
  void saveCurrentAnnotation();
}

async function saveCurrentAnnotation() {
  const image = getImageById(state.activeImageId);
  if (!image) {
    return;
  }

  image.annotation.imageName = image.file.name;
  image.annotation.description = els.fieldDescription.value;
  image.annotation.tags = normalizeTags(image.annotation.tags);
  image.annotation.tags.forEach((tag) => state.knownTags.add(tag));

  renderStats();
  renderImagePicker();
  renderComparisonGrid();
  renderTagPool(image.annotation.tags);
  renderLibraryList();
  renderViewer();
  updateActionButtons();
  await persistAnnotationData();
}

function updateActionButtons() {
  const hasImages = state.images.length > 0;

  els.openAnnotatorBtn.disabled = !hasImages;
}

function getImageById(id) {
  return state.images.find((image) => image.id === id) || null;
}

function renderLibraryList() {
  els.libraryList.innerHTML = "";

  if (state.images.length === 0) {
    els.libraryList.className = "library-list empty-state";
    els.libraryList.textContent = "No images loaded.";
    return;
  }

  els.libraryList.className = "library-list";
  state.images.forEach((image) => {
    const fragment = els.libraryItemTemplate.content.cloneNode(true);
    const root = fragment.querySelector(".library-item");
    const img = fragment.querySelector("img");
    const name = fragment.querySelector(".library-name");
    const path = fragment.querySelector(".library-path");
    const tags = fragment.querySelector(".library-tags");

    img.src = image.objectUrl;
    img.alt = image.file.name;
    name.textContent = image.annotation.imageName || image.file.name;
    path.textContent = image.relativePath;
    tags.textContent = image.annotation.tags.length > 0
      ? `Tags: ${normalizeTags(image.annotation.tags).join(", ")}`
      : "Tags: -";

    root.addEventListener("click", () => {
      state.viewerImageId = image.id;
      showView("viewer");
    });

    els.libraryList.appendChild(fragment);
  });
}

function renderViewer() {
  if (state.images.length === 0) {
    els.viewerContent.className = "viewer-layout empty-state";
    els.viewerContent.textContent = "No images loaded.";
    return;
  }

  if (!getImageById(state.viewerImageId)) {
    state.viewerImageId = state.images[0].id;
  }

  const image = getImageById(state.viewerImageId);
  if (!image) {
    return;
  }

  const tags = normalizeTags(image.annotation.tags);
  const safeDescription = escapeHtml(image.annotation.description || "-");

  els.viewerContent.className = "viewer-layout";
  els.viewerContent.innerHTML = `
    <article class="viewer-image-panel">
      <div class="viewer-image-controls">
        <button type="button" class="viewer-zoom-out" aria-label="Zoom out">-</button>
        <button type="button" class="viewer-zoom-in" aria-label="Zoom in">+</button>
        <button type="button" class="viewer-zoom-level" aria-label="Current zoom level">1x</button>
        <button type="button" class="viewer-reset-view" aria-label="Reset view">Reset</button>
      </div>
      <div class="viewer-image-viewport" aria-label="Viewer image viewport">
        <img class="viewer-image" src="${image.objectUrl}" alt="${escapeHtml(image.file.name)}">
      </div>
    </article>
    <article class="viewer-meta-panel">
      <h3>Metadata</h3>
      <dl class="meta-grid">
        <div>
          <dt>Relative Path</dt>
          <dd>${escapeHtml(image.relativePath)}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>${escapeHtml(image.category)}</dd>
        </div>
        <div>
          <dt>Image Name</dt>
          <dd>${escapeHtml(image.annotation.imageName || image.file.name)}</dd>
        </div>
        <div>
          <dt>Tags</dt>
          <dd>${tags.length > 0 ? escapeHtml(tags.join(", ")) : "-"}</dd>
        </div>
        <div>
          <dt>Description</dt>
          <dd>${safeDescription.replaceAll("\n", "<br>")}</dd>
        </div>
      </dl>
    </article>
  `;

  setupViewerInteractions(image.id);
}

function setupViewerInteractions(imageId) {
  const viewport = els.viewerContent.querySelector(".viewer-image-viewport");
  const img = els.viewerContent.querySelector(".viewer-image");
  const zoomInBtn = els.viewerContent.querySelector(".viewer-zoom-in");
  const zoomOutBtn = els.viewerContent.querySelector(".viewer-zoom-out");
  const zoomLevelBtn = els.viewerContent.querySelector(".viewer-zoom-level");
  const resetBtn = els.viewerContent.querySelector(".viewer-reset-view");

  if (!viewport || !img || !zoomInBtn || !zoomOutBtn || !zoomLevelBtn || !resetBtn) {
    return;
  }

  const updateViewerTransform = () => {
    const zoom = getZoom(imageId);
    const pan = getPan(imageId);
    img.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    zoomLevelBtn.textContent = `${zoom.toFixed(1)}x`;
  };

  const zoomViewerBy = (delta) => {
    const nextZoom = Math.max(0.4, Math.min(4, getZoom(imageId) + delta));
    state.imageZoomById.set(imageId, nextZoom);
    updateViewerTransform();
  };

  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    zoomViewerBy(event.deltaY < 0 ? 0.1 : -0.1);
  }, { passive: false });

  viewport.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    startImageDrag(event, imageId, viewport, img);
  });

  viewport.addEventListener("pointermove", (event) => {
    updateImageDrag(event, imageId);
  });

  const endDrag = (event) => {
    finishImageDrag(event, imageId, viewport);
  };

  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);
  viewport.addEventListener("pointerleave", endDrag);

  zoomInBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    zoomViewerBy(0.2);
  });

  zoomOutBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    zoomViewerBy(-0.2);
  });

  zoomLevelBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    state.imageZoomById.set(imageId, 1);
    updateViewerTransform();
  });

  resetBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    state.imageZoomById.set(imageId, 1);
    setPan(imageId, 0, 0);
    updateViewerTransform();
  });

  updateViewerTransform();
}

function buildAnnotationPayload() {
  return {
    createdAt: new Date().toISOString(),
    totalImages: state.images.length,
    items: state.images.map((image) => ({
      originalName: image.file.name,
      relativePath: image.relativePath,
      category: image.category,
      annotation: {
        imageName: image.annotation.imageName,
        description: image.annotation.description,
        tags: normalizeTags(image.annotation.tags),
      },
    })),
  };
}

async function persistAnnotationData() {
  const payload = buildAnnotationPayload();

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore localStorage quota/privacy mode failures.
  }

  const wrote = await writeDataJsonFile(payload);
  if (!wrote) {
    downloadPayloadAsDataJson(payload);
  }
}

async function writeDataJsonFile(payload) {
  if (!("showSaveFilePicker" in window)) {
    return false;
  }

  try {
    if (!state.dataFileHandle) {
      state.dataFileHandle = await window.showSaveFilePicker({
        suggestedName: "data.json",
        types: [{
          description: "JSON files",
          accept: { "application/json": [".json"] },
        }],
      });
      await saveDataFileHandle(state.dataFileHandle);
    }

    const granted = await ensureFilePermission(state.dataFileHandle, "readwrite");
    if (!granted) {
      return false;
    }

    const writable = await state.dataFileHandle.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

function downloadPayloadAsDataJson(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "data.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

async function ensureFilePermission(handle, mode, suppressPrompt = false) {
  const options = { mode };
  if ((await handle.queryPermission(options)) === "granted") {
    return true;
  }

  if (suppressPrompt) {
    return false;
  }

  return (await handle.requestPermission(options)) === "granted";
}

async function saveDataFileHandle(handle) {
  const db = await openAppDb();
  const tx = db.transaction("settings", "readwrite");
  await runIdbRequest(tx.objectStore("settings").put(handle, "dataJsonHandle"));
}

async function readDataFileHandle() {
  try {
    const db = await openAppDb();
    const tx = db.transaction("settings", "readonly");
    return await runIdbRequest(tx.objectStore("settings").get("dataJsonHandle"));
  } catch {
    return null;
  }
}

function openAppDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("annotation-workspace-db", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runIdbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}


