const path = require("path");
const fs = require("fs/promises");
const { app, BrowserWindow, ipcMain, dialog } = require("electron");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tif", ".tiff"]);

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".webp": "image/webp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
  };
  return map[ext] || "application/octet-stream";
}

async function collectImageFiles(rootDir) {
  const output = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) {
        continue;
      }

      const relativePath = path.relative(rootDir, absolutePath).replaceAll("\\", "/");
      const mimeType = getMimeType(absolutePath);
      const fileBuffer = await fs.readFile(absolutePath);
      const dataUrl = `data:${mimeType};base64,${fileBuffer.toString("base64")}`;
      output.push({
        name: entry.name,
        absolutePath,
        relativePath,
        mimeType,
        dataUrl,
      });
    }
  }

  await walk(rootDir);
  return output;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: "Image Annotation Workspace",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("pick-image-folder", async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Select image folder",
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true, items: [] };
      }

      const rootDir = result.filePaths[0];
      const items = await collectImageFiles(rootDir);
      return { ok: true, rootDir, items };
    } catch (error) {
      return { ok: false, canceled: false, error: error?.message || "Failed to pick image folder.", items: [] };
    }
  });

  ipcMain.handle("rename-file", async (_event, payload) => {
    try {
      const absolutePath = String(payload?.absolutePath || "").trim();
      const newFileName = String(payload?.newFileName || "").trim();
      const rootPath = String(payload?.rootPath || "").trim();
      const newRelativePath = String(payload?.newRelativePath || "").trim();

      if (!absolutePath) {
        return { ok: false, error: "Invalid rename payload." };
      }

      if (rootPath && newRelativePath) {
        const normalizedRoot = path.resolve(rootPath);
        const normalizedRelative = newRelativePath.replaceAll("/", path.sep).replaceAll("\\", path.sep);
        const targetAbsolutePath = path.resolve(path.join(normalizedRoot, normalizedRelative));

        const rootWithSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;
        if (!(targetAbsolutePath === normalizedRoot || targetAbsolutePath.startsWith(rootWithSep))) {
          return { ok: false, error: "Target path is outside loaded folder." };
        }

        if (targetAbsolutePath === absolutePath) {
          return { ok: true, newAbsolutePath: targetAbsolutePath };
        }

        await fs.mkdir(path.dirname(targetAbsolutePath), { recursive: true });
        await fs.rename(absolutePath, targetAbsolutePath);
        return { ok: true, newAbsolutePath: targetAbsolutePath };
      }

      if (!newFileName) {
        return { ok: false, error: "Invalid rename payload." };
      }

      const currentDir = path.dirname(absolutePath);
      const newAbsolutePath = path.join(currentDir, newFileName);
      if (newAbsolutePath === absolutePath) {
        return { ok: true, newAbsolutePath };
      }

      await fs.rename(absolutePath, newAbsolutePath);
      return { ok: true, newAbsolutePath };
    } catch (error) {
      return { ok: false, error: error?.message || "Rename failed." };
    }
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
