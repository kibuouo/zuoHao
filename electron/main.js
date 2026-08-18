const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  Notification,
  session,
  screen,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { mergeAlgorithm } = require("./algorithm");
const { createLocalApi, RING_LIMIT } = require("./localApi");

app.setAppUserModelId("com.zuohao.posture");
app.commandLine.appendSwitch("enable-features", "SharedArrayBuffer");
app.commandLine.appendSwitch("enable-blink-features", "SharedArrayBuffer");
app.commandLine.appendSwitch("enable-unsafe-webgpu");

const DEFAULT_SETTINGS = {
  sitIntervalMinutes: 45,
  breakMinutes: 3,
  sensitivity: "standard",
  viewMode: "side",
  holdSeconds: 2.5,
  alertCooldownSeconds: 50,
  sound: true,
  startOnLaunch: true,
  launchAtLogin: false,
  minimizeOnClose: true,
  theme: "dark",
  capsulePinned: false,
  checks: {
    forwardHead: true,
    slouch: true,
    headTilt: true,
    unevenShoulders: true,
    lean: true,
  },
  cameraId: null,
};

const FLOATING = { width: 360, height: 48 };
const iconPath = path.join(__dirname, "..", "assets", "icon.png");

let mainWindow = null;
let floatingWindow = null;
let breakWindow = null;
let tray = null;
let isQuitting = false;
let floatingPinned = false;
let liveSnapshot = null;
const liveRing = [];
let localApi = null;
let lastRingAt = 0;
let lastSnapWrite = 0;
let lastFrameMeta = null;
let pendingFrame = null;

function userFile(name) {
  return path.join(app.getPath("userData"), name);
}

function framePaths() {
  return {
    user: userFile("debug-frame.jpg"),
    project: path.join(__dirname, "..", ".debug", "frame.jpg"),
  };
}

function writeDebugFrame(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const comma = dataUrl.indexOf(",");
  const raw = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const buf = Buffer.from(raw, "base64");
  if (buf.length < 200) return null;
  const paths = framePaths();
  for (const dest of Object.values(paths)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
  return { ...paths, bytes: buf.length, updatedAt: Date.now() };
}

function requestDebugFrame(timeoutMs = 1600) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingFrame === resolve) pendingFrame = null;
      resolve(lastFrameMeta);
    }, timeoutMs);
    pendingFrame = (meta) => {
      clearTimeout(timer);
      pendingFrame = null;
      resolve(meta);
    };
    send(mainWindow, "debug:capture");
  });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function loadSettings() {
  const stored = readJson(userFile("settings.json"), {});
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    checks: { ...DEFAULT_SETTINGS.checks, ...(stored.checks || {}) },
    algorithm: mergeAlgorithm(stored.algorithm),
  };
}

function saveSettings(next) {
  const current = readJson(userFile("settings.json"), {});
  const merged = {
    ...DEFAULT_SETTINGS,
    ...current,
    ...next,
    checks: { ...DEFAULT_SETTINGS.checks, ...(current.checks || {}), ...(next.checks || {}) },
    algorithm: mergeAlgorithm({ ...current.algorithm, ...(next.algorithm || {}) }),
  };
  writeJson(userFile("settings.json"), merged);
  try {
    app.setLoginItemSettings({ openAtLogin: !!merged.launchAtLogin });
  } catch {
    /* login item is best-effort */
  }
  return merged;
}

function loadHistory() {
  return readJson(userFile("history.json"), { days: {} });
}

function saveHistory(history) {
  writeJson(userFile("history.json"), history || { days: {} });
}

function trayImage(status = "idle") {
  const file = path.join(__dirname, "..", "assets", `tray-${status}.png`);
  const fallback = path.join(__dirname, "..", "assets", "tray-idle.png");
  const img = nativeImage.createFromPath(fs.existsSync(file) ? file : fallback);
  return img.isEmpty() ? nativeImage.createEmpty() : img;
}

function applyCoopCoep() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    if (details.resourceType === "mainFrame") {
      headers["Cross-Origin-Opener-Policy"] = ["same-origin"];
      headers["Cross-Origin-Embedder-Policy"] = ["require-corp"];
    }
    callback({ responseHeaders: headers });
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(["media", "notifications", "clipboard-sanitized-write"].includes(permission));
  });
}

function prefs() {
  return {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    spellcheck: false,
  };
}

function send(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function showMain(section) {
  if (!mainWindow) createMainWindow();
  if (section) send(mainWindow, "main:navigate", section);
  mainWindow.show();
  mainWindow.focus();
  if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.hide();
}

function enableCapsule() {
  if (!floatingWindow || floatingWindow.isDestroyed()) createFloatingWindow();
  floatingWindow.show();
  floatingWindow.focus();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
}

function createMainWindow() {
  const dark = loadSettings().theme !== "light";
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    show: false,
    backgroundColor: dark ? "#1f1f1f" : "#ffffff",
    title: "好坐",
    icon: iconPath,
    autoHideMenuBar: true,
    frame: false,
    webPreferences: prefs(),
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.on("maximize", () => send(mainWindow, "window:maximized", true));
  mainWindow.on("unmaximize", () => send(mainWindow, "window:maximized", false));
  mainWindow.on("close", (event) => {
    if (!isQuitting && loadSettings().minimizeOnClose) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function defaultFloatingBounds() {
  const { x, y, width } = screen.getPrimaryDisplay().workArea;
  return {
    x: x + width - FLOATING.width - 32,
    y: y + 80,
    width: FLOATING.width,
    height: FLOATING.height,
  };
}

function createFloatingWindow() {
  const bounds = defaultFloatingBounds();
  floatingWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#00000000",
    title: "好坐",
    icon: iconPath,
    webPreferences: prefs(),
  });
  floatingWindow.setAlwaysOnTop(true, "status", 1);
  floatingWindow.loadFile(path.join(__dirname, "..", "renderer", "capsule.html"));
  floatingWindow.webContents.on("did-finish-load", () => {
    applyFloatingPin(loadSettings().capsulePinned);
    send(floatingWindow, "floating:pinned", floatingPinned);
  });
  floatingWindow.on("closed", () => {
    floatingWindow = null;
  });
}

function applyFloatingPin(value) {
  floatingPinned = Boolean(value);
  if (!floatingWindow || floatingWindow.isDestroyed()) return floatingPinned;
  floatingWindow.setIgnoreMouseEvents(false);
  if (typeof floatingWindow.setMovable === "function") {
    floatingWindow.setMovable(!floatingPinned);
  }
  floatingWindow.setAlwaysOnTop(true, "status", 1);
  return floatingPinned;
}

function createBreakWindow(payload) {
  if (breakWindow && !breakWindow.isDestroyed()) {
    send(breakWindow, "break:update", payload);
    breakWindow.show();
    return;
  }

  const { workArea } = screen.getPrimaryDisplay();
  breakWindow = new BrowserWindow({
    width: 380,
    height: 248,
    x: workArea.x + workArea.width - 404,
    y: workArea.y + 24,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#1f1f1f",
    webPreferences: prefs(),
  });
  breakWindow.setAlwaysOnTop(true, "screen-saver");
  breakWindow.loadFile(path.join(__dirname, "..", "renderer", "break.html"));
  breakWindow.webContents.on("did-finish-load", () => send(breakWindow, "break:update", payload));
  breakWindow.on("closed", () => {
    breakWindow = null;
  });
}

function createTray() {
  tray = new Tray(trayImage("idle"));
  tray.setToolTip("好坐 · 坐姿监测");
  const menu = Menu.buildFromTemplate([
    { label: "启用胶囊", click: () => enableCapsule() },
    { label: "打开主窗口", click: () => showMain() },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => {
    if (mainWindow && mainWindow.isVisible()) enableCapsule();
    else showMain();
  });
}

function notify(title, body) {
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title, body, silent: false, icon: trayImage("alert") });
  n.on("click", () => showMain("Monitor"));
  n.show();
  return true;
}

function registerIpc() {
  ipcMain.handle("settings:get", () => loadSettings());
  ipcMain.handle("settings:save", (_e, next) => {
    const merged = saveSettings(next);
    send(mainWindow, "settings:updated", merged);
    send(floatingWindow, "settings:updated", merged);
    return merged;
  });
  ipcMain.handle("history:get", () => loadHistory());
  ipcMain.handle("history:save", (_e, history) => {
    saveHistory(history);
    return true;
  });
  ipcMain.handle("app:notify", (_e, { title, body }) => notify(title, body));
  ipcMain.handle("app:hide", () => {
    mainWindow?.hide();
    return true;
  });
  ipcMain.handle("app:quit", () => {
    isQuitting = true;
    app.quit();
  });
  ipcMain.handle("tray:status", (_e, status) => {
    if (tray) {
      tray.setImage(trayImage(status));
      const labels = {
        idle: "好坐 · 未监测",
        good: "好坐 · 坐姿良好",
        warn: "好坐 · 坐姿需留意",
        alert: "好坐 · 坐姿预警",
        break: "好坐 · 起身休息",
      };
      tray.setToolTip(labels[status] || "好坐");
    }
    return true;
  });
  ipcMain.handle("break:show", (_e, payload) => {
    createBreakWindow(payload);
    return true;
  });
  ipcMain.handle("break:hide", () => {
    if (breakWindow && !breakWindow.isDestroyed()) breakWindow.close();
    return true;
  });
  ipcMain.on("break:dismiss", () => {
    if (breakWindow && !breakWindow.isDestroyed()) breakWindow.close();
    send(mainWindow, "break:dismissed");
  });
  ipcMain.on("break:snooze", () => {
    if (breakWindow && !breakWindow.isDestroyed()) breakWindow.close();
    send(mainWindow, "break:snoozed");
  });

  ipcMain.on("window:show-main", (_e, section) => showMain(section));
  ipcMain.on("window:enable-capsule", () => enableCapsule());
  ipcMain.on("window:minimize", (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.handle("window:toggle-maximize", (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  ipcMain.on("window:close", (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win === mainWindow) mainWindow.hide();
    else win?.hide();
  });
  ipcMain.handle("floating:set-pinned", (_e, value) => {
    applyFloatingPin(value);
    saveSettings({ capsulePinned: floatingPinned });
    send(floatingWindow, "floating:pinned", floatingPinned);
    return floatingPinned;
  });
  ipcMain.on("posture:update", (_e, payload) => {
    send(floatingWindow, "posture:update", payload);
    liveSnapshot = { ...payload, updatedAt: Date.now(), running: true };
    const now = Date.now();
    if (payload && payload.monitoring && now - lastRingAt > 900) {
      lastRingAt = now;
      liveRing.push({
        t: now,
        cva: payload.metrics?.cva ?? payload.cva ?? null,
        score: payload.score ?? null,
        status: payload.status || "idle",
        present: !!payload.present,
        view: payload.metrics?.view || null,
        trunkAngle: payload.metrics?.trunkAngle ?? null,
        issues: (payload.issues || []).map((i) => i.id),
        headTilt: payload.metrics?.headTilt ?? null,
        shoulderSlope: payload.metrics?.shoulderSlope ?? null,
        lean: payload.metrics?.lean ?? null,
        tiltReady: payload.metrics?.tiltReady ?? null,
        slopeReady: payload.metrics?.slopeReady ?? null,
        leanReady: payload.metrics?.leanReady ?? null,
      });
      if (liveRing.length > RING_LIMIT) liveRing.splice(0, liveRing.length - RING_LIMIT);
    }
    if (now - lastSnapWrite > 1000) {
      lastSnapWrite = now;
      writeJson(userFile("live-snapshot.json"), liveSnapshot);
    }
  });
  ipcMain.handle("baseline:save", (_e, baseline) => {
    writeJson(userFile("baseline.json"), baseline || { exists: false });
    return true;
  });
  ipcMain.on("debug:frame", (_e, payload) => {
    const saved = writeDebugFrame(payload?.jpeg);
    lastFrameMeta = {
      ...saved,
      present: !!payload?.present,
      issues: payload?.issues || [],
      metrics: payload?.metrics || null,
    };
    if (typeof pendingFrame === "function") pendingFrame(lastFrameMeta);
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMain());

  app.whenReady().then(async () => {
    applyCoopCoep();
    registerIpc();
    localApi = createLocalApi({
      userFile,
      readJson,
      writeJson,
      loadSettings,
      saveSettings,
      loadHistory,
      getLive: () => liveSnapshot,
      setLive: (next) => {
        liveSnapshot = next;
      },
      getRing: () => liveRing,
      pushRing: () => {},
      getFramePath: () => framePaths().project,
      requestFrame: () => requestDebugFrame(),
      notifyRenderer: (settings) => {
        send(mainWindow, "settings:updated", settings);
        send(floatingWindow, "settings:updated", settings);
      },
    });
    try {
      await localApi.start();
    } catch (err) {
      console.error("local API failed", err);
    }
    createMainWindow();
    createFloatingWindow();
    createTray();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && isQuitting) app.quit();
  });

  app.on("activate", () => {
    if (!mainWindow) createMainWindow();
    else mainWindow.show();
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });
}
