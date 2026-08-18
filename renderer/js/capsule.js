const api = window.zuohao;
let pinned = false;

const els = {
  sit: document.getElementById("cap-sit"),
  cva: document.getElementById("cap-cva"),
  lamp: document.getElementById("cap-lamp"),
  alertText: document.getElementById("cap-alert-text"),
  pin: document.getElementById("pin-button"),
  openMain: document.getElementById("open-main"),
  capsule: document.getElementById("status-capsule"),
};

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
}

function applyPinned(value) {
  pinned = Boolean(value);
  els.pin.classList.toggle("active", pinned);
  els.capsule.classList.toggle("pinned", pinned);
  els.pin.title = pinned ? "取消钉住" : "钉住";
}

function formatSit(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function render(payload = {}) {
  const cva = payload.cva;
  const status = payload.status || "idle";
  els.cva.textContent = Number.isFinite(cva) ? `${Math.round(cva)}°` : "—°";
  els.sit.textContent = formatSit(payload.sitMs);
  els.lamp.className = `heart-icon ${status === "good" || status === "warn" || status === "alert" ? status : ""}`;
  els.alertText.textContent = payload.alertText || (payload.monitoring ? "坐姿良好" : "待机");
  els.alertText.dataset.status = status;
}

els.openMain.addEventListener("click", (event) => {
  event.stopPropagation();
  api.showMain();
});

els.pin.addEventListener("click", async (event) => {
  event.stopPropagation();
  applyPinned(await api.setFloatingPinned(!pinned));
});

api.onFloatingPinned(applyPinned);
api.onPosture(render);
api.onSettingsUpdated((settings) => {
  applyTheme(settings.theme);
  if (typeof settings.capsulePinned === "boolean") applyPinned(settings.capsulePinned);
});
api.getSettings().then((s) => {
  applyTheme(s.theme);
  applyPinned(!!s.capsulePinned);
});
render();
