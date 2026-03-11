const STORAGE_KEY = "annotationWorkspaceData";
const THEME_KEY = "annotationWorkspaceTheme";
const DEFAULT_THEME = "light";
const AVAILABLE_THEMES = new Set(["light", "dark", "sage-cream", "rose-moss", "clay-coffee", "slate-mist"]);
const MORPHOLOGY_QUESTIONS = [
  {
    key: "shape",
    label: "Shape",
    options: ["irregular", "regular"],
  },
  {
    key: "opacity",
    label: "Opacity",
    options: ["opaque", "translucent", "transparent"],
  },
  {
    key: "color",
    label: "Color",
    options: ["clear", "white", "cream", "yellow", "orange", "red", "pink", "green", "blue", "brown", "black"],
  },
  {
    key: "elevation",
    label: "Elevation",
    options: ["flat", "raised", "convex", "umbonate", "crateriform"],
  },
  {
    key: "margin",
    label: "Margin",
    options: ["entire", "undulate", "lobate", "filamentous", "curled"],
  },
  {
    key: "surface",
    label: "Surface Texture",
    options: ["smooth", "rough", "wrinkled", "mucoid", "dry"],
  },
];

const state = {
  images: [],
  loadedFolderAbsolutePath: "",
  folderDialogOpen: false,
  categories: new Map(),
  selectedForComparison: [],
  activeImageId: null,
  viewerImageId: null,
  currentView: "dashboard",
  autoSaveTimer: null,
  dataFileHandle: null,
  imageZoomById: new Map(),
  imagePanById: new Map(),
  dragState: null,
  customMorphologyOptions: {},
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
  dashboardInsights: document.getElementById("dashboardInsights"),
  categoryList: document.getElementById("categoryList"),
  imagePickerList: document.getElementById("imagePickerList"),
  comparisonGrid: document.getElementById("comparisonGrid"),
  activeImageLabel: document.getElementById("activeImageLabel"),
  fieldImageName: document.getElementById("fieldImageName"),
  fieldDescription: document.getElementById("fieldDescription"),
  morphologySections: document.getElementById("morphologySections"),
  libraryList: document.getElementById("libraryList"),
  viewerContent: document.getElementById("viewerContent"),
  compareCardTemplate: document.getElementById("compareCardTemplate"),
  libraryItemTemplate: document.getElementById("libraryItemTemplate"),
};

void initialize();

async function initialize() {
  initializeTheme();

  els.folderInput.addEventListener("click", onFolderInputClick);
  els.folderInput.addEventListener("change", onFolderLoad);
  els.openAnnotatorBtn.addEventListener("click", () => showView("annotator"));
  els.openLibraryBtn.addEventListener("click", () => showView("library"));
  els.themeSelect.addEventListener("change", onThemeChange);
  els.backFromAnnotatorBtn.addEventListener("click", onBackButtonClick);
  els.resetPickerBtn.addEventListener("click", resetImagePickerSelection);
  els.fieldImageName.addEventListener("input", onRelativePathInput);
  els.fieldImageName.addEventListener("blur", () => {
    if (state.activeImageId) {
      void onRelativePathBlurRename();
    }
  });
  els.fieldDescription.addEventListener("input", onDescriptionInputAutosave);
  els.fieldDescription.addEventListener("blur", () => {
    if (state.activeImageId) {
      void saveCurrentAnnotation();
    }
  });
  state.dataFileHandle = await readDataFileHandle();
  renderMorphologySections();
  showView("dashboard");
  refreshAll();
}

async function onFolderInputClick(event) {
  if (!window.desktopBridge?.pickImageFolder) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (state.folderDialogOpen) {
    return;
  }

  state.folderDialogOpen = true;
  try {
    await loadFolderFromDesktopPicker();
  } finally {
    state.folderDialogOpen = false;
  }
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
  // In desktop mode, folder loading is handled by native picker in onFolderInputClick.
  if (window.desktopBridge?.pickImageFolder) {
    event.target.value = "";
    return;
  }

  const files = Array.from(event.target.files || []);
  const sourceItems = files
    .filter((file) => file.type.startsWith("image/"))
    .map((file) => ({
      file,
      relativePath: file.webkitRelativePath || file.name,
      absolutePath: file.path || "",
    }));

  // If picker is canceled, keep current loaded folder/data untouched.
  if (sourceItems.length === 0) {
    return;
  }

  await applyLoadedSourceItems(sourceItems);
}

async function loadFolderFromDesktopPicker() {
  const result = await window.desktopBridge.pickImageFolder();
  if (!result || result.canceled) {
    return;
  }

  if (!result.ok || !Array.isArray(result.items)) {
    window.alert(result?.error || "Failed to load folder.");
    return;
  }

  const sourceItems = result.items.map((item) => ({
    file: fileFromDataUrl(item.name, item.dataUrl, item.mimeType),
    relativePath: item.relativePath,
    absolutePath: item.absolutePath || "",
  }));

  await applyLoadedSourceItems(sourceItems);
}

function fileFromDataUrl(fileName, dataUrl, mimeType) {
  const base64 = String(dataUrl || "").split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], String(fileName || "image.bin"), {
    type: String(mimeType || "application/octet-stream"),
  });
}

async function applyLoadedSourceItems(sourceItems) {
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

  state.loadedFolderAbsolutePath = deriveLoadedFolderAbsolutePath(sourceItems);

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
      absolutePath: item.absolutePath || buildAbsolutePathFromRoot(state.loadedFolderAbsolutePath, item.relativePath),
      objectUrl,
      relativePath: item.relativePath,
      category,
      annotation: {
        imageName: item.file.name,
        description: "",
        morphology: createEmptyMorphologyAnswers(),
      },
    };
  });

  state.categories = buildCategories(state.images);
  state.selectedForComparison = [];
  state.activeImageId = null;
  state.viewerImageId = null;

  if (state.images.length > 0) {
    addToComparison(state.images[0].id);
    state.viewerImageId = state.images[0].id;
  }
}

function normalizeOsPath(pathValue) {
  return String(pathValue || "").replaceAll("/", "\\");
}

function deriveLoadedFolderAbsolutePath(sourceItems) {
  const sample = sourceItems.find((item) => item.absolutePath && item.relativePath);
  if (!sample) {
    return "";
  }

  const absolutePath = normalizeOsPath(sample.absolutePath);
  const relativePath = normalizeOsPath(sample.relativePath);
  if (!relativePath || !absolutePath.endsWith(relativePath)) {
    return "";
  }

  const root = absolutePath.slice(0, absolutePath.length - relativePath.length).replace(/[\\/]+$/, "");
  return root;
}

function buildAbsolutePathFromRoot(rootPath, relativePath) {
  if (!rootPath) {
    return "";
  }

  const rel = normalizeOsPath(relativePath).replace(/^[\\/]+/, "");
  if (!rel) {
    return "";
  }

  return `${rootPath}\\${rel}`;
}

async function restoreMetadataForLoadedImages() {
  const localData = readLocalMetadata();
  const fileData = await readDataFileMetadata();
  const payload = chooseNewestPayload(localData, fileData);

  if (!payload || !Array.isArray(payload.items)) {
    renderMorphologySections();
    return;
  }

  if (payload.customMorphologyOptions && typeof payload.customMorphologyOptions === "object") {
    state.customMorphologyOptions = {};
    MORPHOLOGY_QUESTIONS.forEach((q) => {
      const extras = payload.customMorphologyOptions[q.key];
      if (Array.isArray(extras)) {
        state.customMorphologyOptions[q.key] = extras
          .map(normalizeTag)
          .filter((v) => v && !q.options.includes(v));
      }
    });
  }

  const byRelativePath = new Map(payload.items.map((item) => [item.relativePath, item]));
  const byName = new Map();
  payload.items.forEach((item) => {
    const candidate = normalizeTag(item.annotation?.imageName || item.originalName);
    if (candidate && !byName.has(candidate)) {
      byName.set(candidate, item);
    }
  });

  state.images.forEach((image) => {
    const currentName = normalizeTag(getFileNameFromRelativePath(image.relativePath));
    const saved = byRelativePath.get(image.relativePath) || byName.get(currentName);
    if (!saved || !saved.annotation) {
      return;
    }

    image.annotation.imageName = image.file.name;
    if (saved.annotation.imageName) {
      image.annotation.imageName = saved.annotation.imageName;
    }
    image.annotation.description = saved.annotation.description || "";
    image.annotation.morphology = mergeMorphologyAnswers(
      createEmptyMorphologyAnswers(),
      saved.annotation.morphology || tagsArrayToMorphology(saved.annotation.tags || [])
    );
  });

  renderMorphologySections(getImageById(state.activeImageId)?.annotation.morphology || null);
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
  return String(tag || "").trim().toLowerCase();
}

function normalizeRelativePath(pathValue) {
  return String(pathValue || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\//, "");
}

function getFileNameFromRelativePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

function getParentRelativePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function getAllOptions(questionKey) {
  const base = MORPHOLOGY_QUESTIONS.find((q) => q.key === questionKey)?.options || [];
  const custom = state.customMorphologyOptions[questionKey] || [];
  return [...base, ...custom];
}

function createEmptyMorphologyAnswers() {
  const answers = {};
  MORPHOLOGY_QUESTIONS.forEach((question) => {
    answers[question.key] = "";
  });
  return answers;
}

function mergeMorphologyAnswers(base, incoming) {
  const merged = { ...base };
  if (!incoming || typeof incoming !== "object") {
    return merged;
  }

  MORPHOLOGY_QUESTIONS.forEach((question) => {
    const selected = normalizeTag(incoming[question.key]);
    merged[question.key] = getAllOptions(question.key).includes(selected) ? selected : "";
  });

  return merged;
}

function tagsArrayToMorphology(tags) {
  const fromTags = createEmptyMorphologyAnswers();
  const normalized = tags
    .map((tag) => normalizeTag(tag))
    .filter(Boolean);

  MORPHOLOGY_QUESTIONS.forEach((question) => {
    const matched = normalized.find((tag) => question.options.includes(tag));
    fromTags[question.key] = matched || "";
  });

  return fromTags;
}

function morphologyToLegacyTags(morphology) {
  return MORPHOLOGY_QUESTIONS
    .map((question) => normalizeTag(morphology?.[question.key]))
    .filter(Boolean);
}

function getMorphologySummary(image) {
  if (!image || !image.annotation || !image.annotation.morphology) {
    return "Morphology: -";
  }

  const parts = MORPHOLOGY_QUESTIONS
    .map((question) => {
      const value = normalizeTag(image.annotation.morphology[question.key]);
      if (!value) {
        return null;
      }
      return `${question.label}: ${value}`;
    })
    .filter(Boolean);

  return parts.length > 0 ? `Morphology: ${parts.join(" | ")}` : "Morphology: -";
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
  renderDashboardInsights();
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
  const annotatedCount = state.images.filter((image) => getImageAnnotationPercentage(image) > 0).length;
  const completion = totalImages === 0
    ? 0
    : Math.round(
      state.images.reduce((sum, image) => sum + getImageAnnotationPercentage(image), 0) / totalImages
    );

  els.statTotalImages.textContent = String(totalImages);
  els.statCategories.textContent = String(totalCategories);
  els.statAnnotated.textContent = String(annotatedCount);
  els.statCompletion.textContent = `${completion}%`;
}

function isAnnotated(image) {
  return getImageAnnotationPercentage(image) > 0;
}

function getImageAnnotationPercentage(image) {
  const totalCriteria = MORPHOLOGY_QUESTIONS.length + 1; // all morphology sections + remarks
  if (totalCriteria <= 0) {
    return 0;
  }

  const morphologyCount = MORPHOLOGY_QUESTIONS.filter(
    (question) => normalizeTag(image.annotation?.morphology?.[question.key]).length > 0
  ).length;
  const hasRemarks = String(image.annotation?.description || "").trim().length > 0 ? 1 : 0;
  const completedCriteria = morphologyCount + hasRemarks;
  return Math.round((completedCriteria / totalCriteria) * 100);
}

function renderDashboardInsights() {
  els.dashboardInsights.innerHTML = "";

  if (state.images.length === 0) {
    els.dashboardInsights.className = "dashboard-insights empty-state";
    els.dashboardInsights.textContent = "Load a folder to see annotation insights.";
    return;
  }

  const totalImages = state.images.length;
  const withRemarks = state.images.filter((image) => image.annotation.description.trim().length > 0).length;
  const withMorphology = state.images.filter((image) => morphologyToLegacyTags(image.annotation.morphology).length > 0).length;

  const categoryStats = new Map();
  state.images.forEach((image) => {
    if (!categoryStats.has(image.category)) {
      categoryStats.set(image.category, { total: 0, annotated: 0 });
    }
    const row = categoryStats.get(image.category);
    row.total += 1;
    if (isAnnotated(image)) {
      row.annotated += 1;
    }
  });

  const bestCategory = Array.from(categoryStats.entries())
    .sort((a, b) => (b[1].annotated / Math.max(1, b[1].total)) - (a[1].annotated / Math.max(1, a[1].total)))[0];

  const summary = document.createElement("div");
  summary.className = "dashboard-insight-summary";
  summary.innerHTML = `
    <article class="dashboard-insight-card">
      <h4>With Remarks</h4>
      <p>${withRemarks}/${totalImages}</p>
    </article>
    <article class="dashboard-insight-card">
      <h4>With Morphology</h4>
      <p>${withMorphology}/${totalImages}</p>
    </article>
    <article class="dashboard-insight-card">
      <h4>Top Category</h4>
      <p>${bestCategory ? bestCategory[0] : "-"}</p>
    </article>
  `;

  const chart = document.createElement("div");
  chart.className = "dashboard-insight-chart";

  Array.from(categoryStats.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([category, info]) => {
      const ratio = info.total === 0 ? 0 : Math.round((info.annotated / info.total) * 100);
      const row = document.createElement("div");
      row.className = "insight-row";
      row.innerHTML = `
        <span class="insight-label">${escapeHtml(category)}</span>
        <div class="insight-track"><div class="insight-fill" style="width:${ratio}%"></div></div>
        <span class="insight-value">${ratio}%</span>
      `;
      chart.appendChild(row);
    });

  els.dashboardInsights.className = "dashboard-insights";
  els.dashboardInsights.append(summary, chart);
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
    const progress = getImageAnnotationPercentage(image);
    const annotated = progress > 0;
    status.className = annotated ? "picker-status status-annotated" : "picker-status status-unannotated";
    status.textContent = `${progress}% annotated`;

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

function onRelativePathInput() {
  const image = getImageById(state.activeImageId);
  if (!image) {
    return;
  }
}

async function onRelativePathBlurRename() {
  const image = getImageById(state.activeImageId);
  if (!image) {
    return;
  }

  const previousRelativePath = image.relativePath;
  const requestedRelativePath = normalizeRelativePath(els.fieldImageName.value);
  if (!requestedRelativePath || requestedRelativePath === previousRelativePath) {
    els.fieldImageName.value = image.relativePath;
    return;
  }

  const nextFileName = getFileNameFromRelativePath(requestedRelativePath);
  if (!nextFileName) {
    els.fieldImageName.value = image.relativePath;
    return;
  }

  if (!window.desktopBridge?.renameFile) {
    window.alert("Desktop rename bridge not detected. Please close the app and run `npm start` again.");
    els.fieldImageName.value = previousRelativePath;
    return;
  }

  const absolutePath = image.absolutePath || buildAbsolutePathFromRoot(state.loadedFolderAbsolutePath, image.relativePath);
  if (!absolutePath) {
    window.alert("Absolute file path is unavailable, so local rename cannot run. Reload the folder in the desktop app and try again.");
    els.fieldImageName.value = previousRelativePath;
    return;
  }

  try {
    const result = await window.desktopBridge.renameFile({
      absolutePath,
      newFileName: nextFileName,
      rootPath: state.loadedFolderAbsolutePath,
      newRelativePath: requestedRelativePath,
    });

    if (!result?.ok) {
      window.alert(result?.error || "Failed to rename local file.");
      els.fieldImageName.value = previousRelativePath;
      return;
    }

    image.absolutePath = result.newAbsolutePath || absolutePath;
  } catch {
    window.alert("Failed to rename local file.");
    els.fieldImageName.value = previousRelativePath;
    return;
  }

  image.relativePath = requestedRelativePath;
  image.annotation.imageName = nextFileName;
  image.category = getParentRelativePath(requestedRelativePath).split("/").pop() || "uncategorized";
  state.categories = buildCategories(state.images);
  refreshAll();
  await saveCurrentAnnotation();
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
    name.textContent = image.relativePath;
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
      if (!event.altKey) return;
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

  els.fieldImageName.disabled = disabled;
  els.fieldDescription.disabled = disabled;

  if (!image) {
    els.activeImageLabel.textContent = "No image selected";
    els.fieldImageName.value = "";
    els.fieldDescription.value = "";
    renderMorphologySections();
    return;
  }

  els.activeImageLabel.textContent = image.relativePath;
  els.fieldImageName.value = image.relativePath;
  els.fieldDescription.value = image.annotation.description;
  renderMorphologySections(image.annotation.morphology);
}

function renderMorphologySections(activeAnswers = null) {
  els.morphologySections.innerHTML = "";

  if (!state.activeImageId || !activeAnswers) {
    els.morphologySections.className = "morphology-sections empty-state";
    els.morphologySections.textContent = "No image selected.";
    return;
  }

  els.morphologySections.className = "morphology-sections";
  MORPHOLOGY_QUESTIONS.forEach((question) => {
    const section = document.createElement("div");
    section.className = "morphology-group";

    const title = document.createElement("p");
    title.className = "morphology-group-title";
    title.textContent = question.label;

    const optionsRow = document.createElement("div");
    optionsRow.className = "morphology-option-row";

    const selected = normalizeTag(activeAnswers[question.key]);
    getAllOptions(question.key).forEach((option) => {
      const optionItem = document.createElement("div");
      optionItem.className = "morphology-option-item";

      const optionButton = document.createElement("button");
      optionButton.type = "button";
      optionButton.className = "morphology-option";
      optionButton.textContent = option;

      if (selected === option) {
        optionButton.classList.add("selected");
      }

      optionButton.addEventListener("click", () => {
        selectMorphologyOption(question.key, option);
      });

      optionItem.appendChild(optionButton);

      if (isCustomMorphologyOption(question.key, option)) {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "morphology-delete-option";
        deleteButton.setAttribute("aria-label", `Delete ${option}`);
        deleteButton.textContent = "x";
        deleteButton.addEventListener("click", () => {
          deleteCustomMorphologyOption(question.key, option);
        });
        optionItem.appendChild(deleteButton);
      }

      optionsRow.appendChild(optionItem);
    });

    const addRow = document.createElement("div");
    addRow.className = "morphology-add-row";

    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.className = "morphology-add-input";
    addInput.placeholder = "New option…";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "morphology-add-btn";
    addBtn.textContent = "+";

    const doAdd = () => {
      const value = normalizeTag(addInput.value);
      if (!value) return;
      if (getAllOptions(question.key).includes(value)) {
        addInput.value = "";
        return;
      }
      if (!state.customMorphologyOptions[question.key]) {
        state.customMorphologyOptions[question.key] = [];
      }
      state.customMorphologyOptions[question.key].push(value);
      addInput.value = "";
      renderMorphologySections(getImageById(state.activeImageId)?.annotation.morphology || null);
      void persistAnnotationData();
    };

    addBtn.addEventListener("click", doAdd);
    addInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        doAdd();
      }
    });

    addRow.append(addInput, addBtn);
    section.append(title, optionsRow, addRow);
    els.morphologySections.appendChild(section);
  });
}

function isCustomMorphologyOption(sectionKey, option) {
  const normalized = normalizeTag(option);
  return (state.customMorphologyOptions[sectionKey] || []).includes(normalized);
}

function deleteCustomMorphologyOption(sectionKey, option) {
  const normalized = normalizeTag(option);
  const current = state.customMorphologyOptions[sectionKey] || [];
  state.customMorphologyOptions[sectionKey] = current.filter((value) => value !== normalized);

  if (state.customMorphologyOptions[sectionKey].length === 0) {
    delete state.customMorphologyOptions[sectionKey];
  }

  // Clear this option from all loaded images if they were using it.
  state.images.forEach((image) => {
    if (normalizeTag(image.annotation.morphology[sectionKey]) === normalized) {
      image.annotation.morphology[sectionKey] = "";
    }
  });

  refreshAll();
  void persistAnnotationData();
}

function selectMorphologyOption(sectionKey, option) {
  const image = getImageById(state.activeImageId);
  if (!image) {
    return;
  }

  const question = MORPHOLOGY_QUESTIONS.find((item) => item.key === sectionKey);
  const normalizedOption = normalizeTag(option);
  if (!question || !getAllOptions(sectionKey).includes(normalizedOption)) {
    return;
  }

  const current = normalizeTag(image.annotation.morphology[sectionKey]);
  image.annotation.morphology[sectionKey] = current === normalizedOption ? "" : normalizedOption;

  renderMorphologySections(image.annotation.morphology);
  updateActionButtons();
  void saveCurrentAnnotation();
}

async function saveCurrentAnnotation() {
  const image = getImageById(state.activeImageId);
  if (!image) {
    return;
  }

  image.annotation.imageName = getFileNameFromRelativePath(image.relativePath) || image.file.name;
  image.annotation.description = els.fieldDescription.value;
  image.annotation.morphology = mergeMorphologyAnswers(
    createEmptyMorphologyAnswers(),
    image.annotation.morphology
  );

  renderStats();
  renderImagePicker();
  renderComparisonGrid();
  renderMorphologySections(image.annotation.morphology);
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
    const morphology = fragment.querySelector(".library-tags");

    img.src = image.objectUrl;
    img.alt = image.file.name;
    name.textContent = image.relativePath;
    path.textContent = image.relativePath;
    morphology.textContent = getMorphologySummary(image);

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

  const morphologyTags = morphologyToLegacyTags(image.annotation.morphology);
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
          <dt>File Name</dt>
          <dd>${escapeHtml(getFileNameFromRelativePath(image.relativePath) || image.file.name)}</dd>
        </div>
        <div>
          <dt>Morphology</dt>
          <dd>${morphologyTags.length > 0 ? escapeHtml(getMorphologySummary(image).replace("Morphology: ", "")) : "-"}</dd>
        </div>
        <div>
            <dt>Remarks</dt>
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
    if (!event.altKey) return;
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
    customMorphologyOptions: state.customMorphologyOptions,
    items: state.images.map((image) => ({
      originalName: image.file.name,
      relativePath: image.relativePath,
      category: image.category,
      annotation: {
        imageName: image.annotation.imageName,
        description: image.annotation.description,
        morphology: mergeMorphologyAnswers(createEmptyMorphologyAnswers(), image.annotation.morphology),
        tags: morphologyToLegacyTags(image.annotation.morphology),
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


