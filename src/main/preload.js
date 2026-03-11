const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  renameFile: (payload) => ipcRenderer.invoke("rename-file", payload),
  pickImageFolder: () => ipcRenderer.invoke("pick-image-folder"),
});
