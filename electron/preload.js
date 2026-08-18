const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zuohao", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (next) => ipcRenderer.invoke("settings:save", next),
  onSettingsUpdated: (fn) => {
    ipcRenderer.removeAllListeners("settings:updated");
    ipcRenderer.on("settings:updated", (_e, settings) => fn(settings));
  },
  getHistory: () => ipcRenderer.invoke("history:get"),
  saveHistory: (history) => ipcRenderer.invoke("history:save", history),
  notify: (title, body) => ipcRenderer.invoke("app:notify", { title, body }),
  hideToTray: () => ipcRenderer.invoke("app:hide"),
  quit: () => ipcRenderer.invoke("app:quit"),
  setTrayStatus: (status) => ipcRenderer.invoke("tray:status", status),
  showBreak: (payload) => ipcRenderer.invoke("break:show", payload),
  hideBreak: () => ipcRenderer.invoke("break:hide"),
  onBreakDismissed: (fn) => {
    ipcRenderer.removeAllListeners("break:dismissed");
    ipcRenderer.on("break:dismissed", () => fn());
  },
  onBreakSnoozed: (fn) => {
    ipcRenderer.removeAllListeners("break:snoozed");
    ipcRenderer.on("break:snoozed", () => fn());
  },
  onBreakUpdate: (fn) => {
    ipcRenderer.removeAllListeners("break:update");
    ipcRenderer.on("break:update", (_e, payload) => fn(payload));
  },
  dismissBreak: () => ipcRenderer.send("break:dismiss"),
  snoozeBreak: () => ipcRenderer.send("break:snooze"),
  showMain: (section) => ipcRenderer.send("window:show-main", section),
  enableCapsule: () => ipcRenderer.send("window:enable-capsule"),
  onNavigate: (fn) => {
    ipcRenderer.removeAllListeners("main:navigate");
    ipcRenderer.on("main:navigate", (_e, section) => fn(section));
  },
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  onMaximizedChange: (fn) => {
    ipcRenderer.removeAllListeners("window:maximized");
    ipcRenderer.on("window:maximized", (_e, value) => fn(value));
  },
  setFloatingPinned: (value) => ipcRenderer.invoke("floating:set-pinned", value),
  onFloatingPinned: (fn) => {
    ipcRenderer.removeAllListeners("floating:pinned");
    ipcRenderer.on("floating:pinned", (_e, value) => fn(value));
  },
  sendPosture: (payload) => ipcRenderer.send("posture:update", payload),
  saveBaseline: (baseline) => ipcRenderer.invoke("baseline:save", baseline),
  sendDebugFrame: (payload) => ipcRenderer.send("debug:frame", payload),
  onCaptureFrame: (fn) => {
    ipcRenderer.removeAllListeners("debug:capture");
    ipcRenderer.on("debug:capture", () => fn());
  },
  onPosture: (fn) => {
    ipcRenderer.removeAllListeners("posture:update");
    ipcRenderer.on("posture:update", (_e, payload) => fn(payload));
  },
});
