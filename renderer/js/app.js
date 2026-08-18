import { CHECKS, POSE_CONNECTIONS } from "./analyze.js";
import { PoseEngine } from "./engine.js";

const CHECK_ORDER = ["forwardHead", "slouch", "headTilt", "unevenShoulders", "lean"];
const api = window.zuohao;
const engine = new PoseEngine();

const els = {
  video: document.getElementById("camera"),
  canvas: document.getElementById("overlay"),
  viewStatus: document.getElementById("view-status"),
  scoreNum: document.getElementById("score-num"),
  scorePill: document.getElementById("score-pill"),
  plumb: document.getElementById("plumb-readout"),
  note: document.getElementById("engine-note"),
  sitClock: document.getElementById("sit-clock"),
  sitBar: document.getElementById("sit-bar"),
  sitCaption: document.getElementById("sit-caption"),
  checks: document.getElementById("checks"),
  coach: document.getElementById("coach-text"),
  monitor: document.getElementById("btn-monitor"),
  calibrate: document.getElementById("btn-calibrate"),
  form: document.getElementById("settings-form"),
  cameraSelect: document.getElementById("camera-select"),
  onboard: document.getElementById("onboard"),
  onboardBtn: document.getElementById("btn-onboard"),
  toasts: document.getElementById("toasts"),
  events: document.getElementById("events"),
  daySummary: document.getElementById("day-summary"),
  spark: document.getElementById("spark"),
  dashScore: document.getElementById("dash-score"),
  dashScoreNote: document.getElementById("dash-score-note"),
  dashCva: document.getElementById("dash-cva"),
  dashCvaNote: document.getElementById("dash-cva-note"),
  dashSit: document.getElementById("dash-sit"),
  dashSitNote: document.getElementById("dash-sit-note"),
  dashGood: document.getElementById("dash-good"),
};

const ctx = els.canvas.getContext("2d");
const state = {
  settings: null,
  history: { days: {} },
  monitoring: false,
  lastFrame: null,
  sitMs: 0,
  awayMs: 0,
  lastTick: 0,
  hold: {},
  lastAlertAt: {},
  events: [],
  breakUntil: 0,
  snoozeUntil: 0,
  baseline: null,
  tray: "idle",
  section: "Home",
  maximized: false,
};

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayBucket() {
  const key = todayKey();
  if (!state.history.days[key]) {
    state.history.days[key] = {
      sitMinutes: 0,
      breakCount: 0,
      alerts: {},
      samples: [],
      goodFrames: 0,
      totalFrames: 0,
    };
  }
  return state.history.days[key];
}

function formatHms(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function clockTime(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
}

function showSection(section) {
  const next = section === "Settings" ? "Settings" : "Home";
  state.section = next;
  document.querySelectorAll(".page").forEach((page) => {
    page.hidden = page.id !== `page-${next}`;
  });
}

function renderChecks(analysis) {
  const issues = new Map((analysis?.issues || []).map((i) => [i.id, i]));
  els.checks.innerHTML = CHECK_ORDER.map((id) => {
    const meta = CHECKS[id];
    const hit = issues.get(id);
    const on = state.settings?.checks?.[id] !== false;
    const m = analysis?.metrics;
    const weak =
      (id === "headTilt" && m && !m.tiltReady) ||
      (id === "unevenShoulders" && m && !m.slopeReady) ||
      (id === "lean" && m && !m.leanReady);
    const tag = !on
      ? "关闭"
      : !state.monitoring
        ? "待机"
        : weak
          ? "信号弱"
          : hit
            ? hit.severity === "alert"
              ? "预警"
              : "留意"
            : "正常";
    const cls = !on || !state.monitoring || weak ? "idle" : hit ? hit.severity : "good";
    let value = "未监测";
    if (weak) value = m?.view === "front" ? "点位不够" : "侧拍点位不够";
    else if (hit) value = hit.detail;
    else if (id === "forwardHead" && m?.cva != null) value = `颅椎角 ${m.cva.toFixed(0)}°`;
    else if (id === "headTilt" && m && m.tiltReady) value = `侧倾 ${Math.abs(m.headTilt).toFixed(0)}°`;
    else if (id === "unevenShoulders" && m && m.slopeReady) value = `肩差 ${Math.abs(m.shoulderSlope).toFixed(0)}°`;
    else if (id === "lean" && m && m.leanReady) value = `侧倾 ${Math.abs(m.lean).toFixed(0)}°`;
    else if (on) value = "铅垂对齐";
    return `<article class="check-row"><span class="check-name">${meta.name}</span><span class="check-value">${value}</span><span class="tag ${cls}">${tag}</span></article>`;
  }).join("");
}

function pushEvent(text) {
  state.events.unshift({ t: Date.now(), text });
  state.events = state.events.slice(0, 12);
  els.events.innerHTML = state.events
    .map((e) => `<li><time>${clockTime(e.t)}</time><span>${e.text}</span></li>`)
    .join("");
}

function toast(title, body) {
  const node = document.createElement("div");
  node.className = "toast";
  node.innerHTML = `<b>${title}</b><span>${body}</span>`;
  els.toasts.prepend(node);
  setTimeout(() => node.remove(), 5200);
}

function beep(kind) {
  if (!state.settings?.sound) return;
  const ctxAudio = new (window.AudioContext || window.webkitAudioContext)();
  const o = ctxAudio.createOscillator();
  const g = ctxAudio.createGain();
  o.type = "sine";
  o.frequency.value = kind === "alert" ? 660 : kind === "break" ? 392 : 523;
  g.gain.value = 0.04;
  o.connect(g);
  g.connect(ctxAudio.destination);
  o.start();
  o.stop(ctxAudio.currentTime + 0.18);
  setTimeout(() => ctxAudio.close(), 400);
}

function setTray(status) {
  if (state.tray === status) return;
  state.tray = status;
  api.setTrayStatus(status);
}

function drawOverlay(landmarks, analysis, face) {
  const { canvas, video } = els;
  const w = video.videoWidth || canvas.clientWidth;
  const h = video.videoHeight || canvas.clientHeight;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  if (!landmarks) return;

  const pt = (p) => [p.x * w, p.y * h];
  const seen = (p, min = 0.2) => p && (typeof p.visibility !== "number" || p.visibility >= min);
  const line = (a, b, color, width = 3) => {
    if (!seen(a, 0.16) || !seen(b, 0.16)) return;
    ctx.beginPath();
    ctx.moveTo(...pt(a));
    ctx.lineTo(...pt(b));
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  const dot = (p, color, r = 4) => {
    if (!seen(p, 0.16)) return;
    ctx.beginPath();
    ctx.arc(...pt(p), r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  };

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [a, b] of POSE_CONNECTIONS) {
    const pa = landmarks[a];
    const pb = landmarks[b];
    if (!seen(pa, 0.18) || !seen(pb, 0.18)) continue;
    const fade = Math.min(pa.visibility ?? 1, pb.visibility ?? 1);
    line(pa, pb, `rgba(234,241,236,${0.22 + fade * 0.38})`, 1.8);
  }
  for (let i = 0; i < landmarks.length; i++) {
    const p = landmarks[i];
    if (!seen(p, 0.2)) continue;
    const key = i === 0 || i === 7 || i === 8 || i === 9 || i === 10 || i === 11 || i === 12 || i === 23 || i === 24;
    dot(p, key ? "rgba(243,247,243,0.95)" : "rgba(234,241,236,0.55)", key ? 3.4 : 2.2);
  }

  const m = analysis?.metrics;
  const origin = m?.c7 || m?.shoulder;
  if (origin) {
    const [cx, cy] = pt(origin);
    const accent = analysis?.status === "good" ? "#34d399" : analysis?.status === "alert" ? "#f0a39c" : "#fbbf24";
    const neck = [m.ear, m.c3, m.c5 || m.cervical, origin].filter(Boolean);
    ctx.beginPath();
    neck.forEach((p, i) => {
      const [x, y] = pt(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3.4;
    ctx.stroke();
    if (m.hip) line(m.shoulder || origin, m.hip, "rgba(234,241,236,0.28)", 1.6);

    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.strokeStyle = "rgba(16,163,127,0.55)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(Math.max(0, cx - 90), cy);
    ctx.lineTo(Math.min(w, cx + 90), cy);
    ctx.strokeStyle = "rgba(16,163,127,0.7)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    if (m.ear) {
      dot(m.ear, "#10a37f", 5);
      const [ex, ey] = pt(m.ear);
      const facingLeft = m.facing === "left";
      const start = facingLeft ? Math.PI : 0;
      let end = Math.atan2(ey - cy, ex - cx);
      if (facingLeft && end < 0) end += Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 54, start, end, !facingLeft);
      ctx.strokeStyle = "rgba(16,163,127,0.95)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.save();
      ctx.font = "600 18px -apple-system, sans-serif";
      ctx.fillStyle = "#f3f7f3";
      ctx.fillText(`${Math.round(m.cva || 0)}°`, cx + (facingLeft ? -86 : 18), cy - 14);
      ctx.restore();
    }
    if (m.c3) dot(m.c3, "#6ee7b7", 4);
    if (m.c5) dot(m.c5, "#34d399", 4.2);
    dot(origin, "#10a37f", 5.5);
    ctx.save();
    ctx.font = "600 13px -apple-system, sans-serif";
    ctx.fillStyle = "rgba(243,247,243,0.9)";
    ctx.fillText("C7", cx + 8, cy + 16);
    ctx.restore();
  }

  if (face) {
    const chain = [face.lEar, face.lEye, face.nose, face.rEye, face.rEar].filter(Boolean);
    for (let i = 0; i < chain.length - 1; i++) line(chain[i], chain[i + 1], "rgba(110,231,183,0.95)", 2.4);
    if (face.lMouth && face.rMouth) line(face.lMouth, face.rMouth, "rgba(110,231,183,0.9)", 2);
    if (face.nose && face.chin) line(face.nose, face.chin, "rgba(110,231,183,0.85)", 2);
    for (const p of [face.nose, face.lEye, face.rEye, face.lMouth, face.rMouth, face.chin, face.lEar, face.rEar]) {
      if (p) dot(p, "#6ee7b7", 4.2);
    }
  }
}

function grabDebugFrame() {
  const video = els.video;
  const overlay = els.canvas;
  if (!video?.videoWidth) return null;
  const c = document.createElement("canvas");
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  const g = c.getContext("2d");
  g.drawImage(video, 0, 0, c.width, c.height);
  if (overlay.width && overlay.height) g.drawImage(overlay, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

function pushDebugFrame() {
  const jpeg = grabDebugFrame();
  if (!jpeg) return;
  const m = state.lastFrame?.analysis?.metrics;
  api.sendDebugFrame({
    jpeg,
    present: !!state.lastFrame?.present,
    issues: state.lastFrame?.analysis?.issues || [],
    metrics: m
      ? {
          cva: m.cva,
          earForward: m.earForward,
          chinForward: m.chinForward,
          trunkAngle: m.trunkAngle,
          headTilt: m.headTilt,
          shoulderSlope: m.shoulderSlope,
          lean: m.lean,
          tiltReady: m.tiltReady,
          slopeReady: m.slopeReady,
          leanReady: m.leanReady,
          tiltSource: m.tiltSource,
          slopeSource: m.slopeSource,
          leanSource: m.leanSource,
          view: m.view,
          facing: m.facing,
          headCollapsed: m.headCollapsed,
          headFused: !!state.lastFrame?.face,
        }
      : null,
  });
}

api.onCaptureFrame(() => pushDebugFrame());

function drawSpark() {
  const canvas = els.spark;
  const c = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  c.clearRect(0, 0, w, h);
  const samples = dayBucket().samples;
  if (samples.length < 2) {
    c.fillStyle = "#3f3f46";
    c.fillRect(0, h - 2, w, 2);
    return;
  }
  c.beginPath();
  samples.forEach((s, i) => {
    const x = (i / (samples.length - 1)) * w;
    const y = h - 6 - (s.score / 100) * (h - 12);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  });
  c.strokeStyle = "#10a37f";
  c.lineWidth = 1.6;
  c.stroke();
}

function updateDaySummary() {
  const d = dayBucket();
  const ratio = d.totalFrames ? Math.round((d.goodFrames / d.totalFrames) * 100) : 0;
  const text = d.totalFrames
    ? `良好占比 ${ratio}% · 落座 ${Math.round(d.sitMinutes)} 分钟 · 起身 ${d.breakCount} 次`
    : "还没有记录";
  els.daySummary.textContent = text;
  els.dashGood.textContent = d.totalFrames ? `${ratio}%` : "—";
  drawSpark();
}

function coachCopy(analysis, present) {
  if (!state.monitoring) return "把摄像头放在身体一侧，能看到耳朵、脖子和近侧肩膀，再点「开启监测」。";
  if (state.breakUntil > Date.now()) return "现在离开座位走动一下。肩颈需要的是卸力，不是再盯屏幕。";
  if (!present) return "侧拍里暂时看不到头肩。把耳朵和近侧肩膀留在画面里。";
  if (!state.baseline) return "先坐正再校准。侧看时耳朵应大致叠在肩膀正上方。";
  const worst = analysis?.issues?.[0];
  if (!worst) {
    const cva = analysis?.metrics?.cva;
    return Number.isFinite(cva) ? `颅椎角 ${cva.toFixed(0)}°，耳—肩基本共线。保持这个高度。` : "铅垂线贴着耳—肩。";
  }
  return worst.fix;
}

let historySaveTimer = 0;
function persistHistory() {
  clearTimeout(historySaveTimer);
  historySaveTimer = setTimeout(() => api.saveHistory(state.history), 800);
}

function recordSample(score, good) {
  const d = dayBucket();
  d.totalFrames += 1;
  if (good) d.goodFrames += 1;
  const last = d.samples[d.samples.length - 1];
  if (!last || Date.now() - last.t > 120000) {
    d.samples.push({ t: Date.now(), score });
    if (d.samples.length > 240) d.samples.shift();
    persistHistory();
  }
  updateDaySummary();
}

function maybeAlert(issues) {
  const now = Date.now();
  const holdNeed = (state.settings.holdSeconds || 2.5) * 1000;
  const cooldown = (state.settings.alertCooldownSeconds || 50) * 1000;
  const live = new Set(issues.map((i) => i.id));
  for (const id of CHECK_ORDER) {
    if (!live.has(id)) {
      delete state.hold[id];
      continue;
    }
    state.hold[id] = state.hold[id] || now;
    if (now - state.hold[id] < holdNeed) continue;
    if (now - (state.lastAlertAt[id] || 0) < cooldown) continue;
    const issue = issues.find((i) => i.id === id);
    state.lastAlertAt[id] = now;
    const d = dayBucket();
    d.alerts[id] = (d.alerts[id] || 0) + 1;
    persistHistory();
    pushEvent(`${issue.name} · ${issue.detail}`);
    toast(issue.name, issue.fix);
    api.notify(`好坐 · ${issue.name}`, issue.fix);
    beep(issue.severity);
  }
}

async function openBreak(reason) {
  state.breakUntil = Date.now() + state.settings.breakMinutes * 60 * 1000;
  dayBucket().breakCount += 1;
  persistHistory();
  pushEvent(reason);
  setTray("break");
  beep("break");
  await api.notify("该起身了", `连续落座已到 ${state.settings.sitIntervalMinutes} 分钟，离开座位活动一下。`);
  await api.showBreak({
    title: "该起身了",
    body: "站起来走一圈，转转手腕和后颈。不要继续坐着回消息。",
    remainMs: state.settings.breakMinutes * 60 * 1000,
  });
}

function endBreak(snooze) {
  state.breakUntil = 0;
  state.sitMs = 0;
  if (snooze) state.snoozeUntil = Date.now() + 10 * 60 * 1000;
  api.hideBreak();
  els.sitCaption.textContent = snooze ? "已推迟 10 分钟再提醒。" : "休息结束，落座计时重新开始。";
}

function applyMirror(metrics) {
  const gate = document.querySelector(".film-gate");
  if (!gate) return;
  const mode = state.settings?.viewMode || "side";
  gate.classList.toggle("mirror", mode === "front" || (mode === "auto" && metrics?.view === "front"));
}

function broadcast(analysis, present) {
  const issue = analysis?.issues?.[0];
  const metrics = analysis?.metrics
    ? {
        cva: analysis.metrics.cva,
        forwardRatio: analysis.metrics.forwardRatio,
        chinPoke: analysis.metrics.chinPoke,
        earForward: analysis.metrics.earForward,
        chinForward: analysis.metrics.chinForward,
        worldEarForward: analysis.metrics.worldEarForward,
        trunkAngle: analysis.metrics.trunkAngle,
        view: analysis.metrics.view,
        facing: analysis.metrics.facing,
        sideScore: analysis.metrics.sideScore,
        headTilt: analysis.metrics.headTilt,
        shoulderSlope: analysis.metrics.shoulderSlope,
        lean: analysis.metrics.lean,
        tiltReady: analysis.metrics.tiltReady,
        slopeReady: analysis.metrics.slopeReady,
        leanReady: analysis.metrics.leanReady,
        tiltSource: analysis.metrics.tiltSource,
        slopeSource: analysis.metrics.slopeSource,
        leanSource: analysis.metrics.leanSource,
        neckFromVertical: analysis.metrics.neckFromVertical,
      }
    : null;
  api.sendPosture({
    score: analysis?.score,
    cva: metrics?.cva,
    status: !state.monitoring ? "idle" : present ? analysis?.status || "idle" : "idle",
    sitMs: state.sitMs,
    sitLimitMs: (state.settings?.sitIntervalMinutes || 45) * 60 * 1000,
    awayMs: state.awayMs,
    present,
    monitoring: state.monitoring,
    issues: analysis?.issues || [],
    metrics,
    alertText: issue ? issue.name : present && state.monitoring ? "坐姿良好" : state.monitoring ? "未看到头肩" : "暂无预警",
  });
}

function syncDashboard(analysis, present) {
  const score = analysis?.score;
  const cva = analysis?.metrics?.cva;
  els.dashScore.textContent = Number.isFinite(score) ? String(score) : "—";
  els.dashScoreNote.textContent = !state.monitoring ? "开启监测后开始计分" : present ? "实时" : "画面里没有人";
  els.dashCva.innerHTML = Number.isFinite(cva) ? `${Math.round(cva)}<em>°</em>` : "—<em>°</em>";
  els.dashCvaNote.textContent = analysis?.metrics
    ? `${analysis.metrics.view === "front" ? "正面" : "侧拍"} · ${analysis.metrics.facing === "left" ? "面朝左" : "面朝右"}`
    : "侧看耳—肩连线与水平线夹角";
  els.dashSit.textContent = formatHms(state.sitMs);
}

function onFrame(frame) {
  state.lastFrame = frame;
  const { present, landmarks, analysis, face } = frame;
  drawOverlay(landmarks, analysis, face);
  if (!state.monitoring) {
    broadcast(null, false);
    return;
  }
  if (present && analysis) {
    els.viewStatus.textContent = analysis.status === "good" ? "铅垂锁定 · 良好" : "偏离铅垂";
    els.scoreNum.textContent = String(analysis.score);
    els.scorePill.style.color = analysis.status === "alert" ? "#f0a39c" : analysis.status === "warn" ? "#e2c07a" : "#b7d8c6";
    if (analysis.metrics) {
      const viewLabel = analysis.metrics.view === "front" ? "正面" : analysis.metrics.view === "oblique" ? "斜侧" : "侧拍";
      const face = analysis.metrics.facing === "left" ? "面朝左" : "面朝右";
      els.plumb.textContent = `${viewLabel} · ${face} · 颅椎角 ${analysis.metrics.cva.toFixed(0)}°`;
    }
    applyMirror(analysis.metrics);
    renderChecks(analysis);
    els.coach.textContent = coachCopy(analysis, true);
    recordSample(analysis.score, analysis.status === "good");
    if (state.breakUntil < Date.now()) maybeAlert(analysis.issues);
    setTray(analysis.status);
    syncDashboard(analysis, true);
    broadcast(analysis, true);
  } else {
    els.viewStatus.textContent = "未检测到头肩";
    els.scoreNum.textContent = "—";
    els.plumb.textContent = "侧拍未锁定 · 请露出耳朵和近侧肩膀";
    applyMirror(null);
    renderChecks(null);
    els.coach.textContent = coachCopy(null, false);
    setTray("idle");
    syncDashboard(null, false);
    broadcast(null, false);
  }
}

function tick() {
  const now = performance.now();
  if (!state.lastTick) state.lastTick = now;
  const dt = now - state.lastTick;
  state.lastTick = now;
  if (state.monitoring) {
    const present = !!state.lastFrame?.present;
    if (present) {
      state.sitMs += dt;
      state.awayMs = 0;
      dayBucket().sitMinutes += dt / 60000;
    } else {
      state.awayMs += dt;
      if (state.awayMs > 120000) state.sitMs = 0;
    }
    const limit = state.settings.sitIntervalMinutes * 60 * 1000;
    const ratio = Math.min(1, state.sitMs / limit);
    els.sitBar.style.width = `${ratio * 100}%`;
    els.sitClock.textContent = formatHms(state.sitMs);
    els.dashSit.textContent = formatHms(state.sitMs);
    if (present && state.awayMs === 0) {
      const remain = Math.max(0, limit - state.sitMs);
      els.sitCaption.textContent = `距下次起身提醒还有 ${formatHms(remain)}`;
      els.dashSitNote.textContent = `距提醒 ${formatHms(remain)}`;
    } else if (!present) {
      const text = state.awayMs > 120000 ? "离开超过两分钟，落座计时已清零。" : "暂时离开画面，计时暂停。";
      els.sitCaption.textContent = text;
      els.dashSitNote.textContent = text;
    }
    const due = state.sitMs >= limit && Date.now() > state.snoozeUntil && Date.now() > state.breakUntil;
    if (due && present) openBreak("连续落座到达提醒点");
    if (state.breakUntil && Date.now() >= state.breakUntil) endBreak(false);
    if (state.lastFrame) broadcast(state.lastFrame.analysis, present);
  }
  requestAnimationFrame(tick);
}

async function fillCameras() {
  try {
    const cams = await engine.listCameras();
    const current = state.settings.cameraId || "";
    els.cameraSelect.innerHTML =
      `<option value="">系统默认</option>` +
      cams.map((c, i) => `<option value="${c.deviceId}">${c.label || `摄像头 ${i + 1}`}</option>`).join("");
    els.cameraSelect.value = current;
  } catch {
    /* permission may come after first start */
  }
}

function applyForm() {
  const s = state.settings;
  els.form.sitIntervalMinutes.value = String(s.sitIntervalMinutes);
  els.form.breakMinutes.value = String(s.breakMinutes);
  els.form.sensitivity.value = s.sensitivity;
  els.form.viewMode.value = s.viewMode || "side";
  els.form.theme.value = s.theme || "dark";
  els.form.sound.checked = !!s.sound;
  els.form.startOnLaunch.checked = !!s.startOnLaunch;
  els.form.launchAtLogin.checked = !!s.launchAtLogin;
  els.form.minimizeOnClose.checked = !!s.minimizeOnClose;
  for (const id of CHECK_ORDER) els.form[id].checked = s.checks[id] !== false;
  fillCameras();
}

async function startMonitor() {
  els.note.textContent = "正在加载姿态模型…";
  els.monitor.disabled = true;
  try {
    if (!engine.landmarker) {
      await engine.init();
      els.note.textContent = "模型已就绪，本地推理";
    }
    await engine.start(els.video, {
      cameraId: state.settings.cameraId,
      settings: state.settings,
      baseline: state.baseline,
      onFrame,
      onError: (err) => {
        els.note.textContent = err.message || String(err);
      },
    });
    await fillCameras();
    state.monitoring = true;
    state.lastTick = 0;
    els.monitor.textContent = "暂停监测";
    els.calibrate.disabled = false;
    els.viewStatus.textContent = "监测中";
    pushEvent("开始监测");
  } catch (err) {
    els.note.textContent = "无法打开摄像头，请检查系统隐私设置里是否允许好坐使用相机。";
    toast("摄像头未打开", err.message || "请到系统设置里允许使用相机");
    api.notify("好坐无法使用摄像头", "请在系统隐私设置中允许此应用访问相机。");
  } finally {
    els.monitor.disabled = false;
  }
}

function stopMonitor() {
  engine.stop();
  state.monitoring = false;
  els.monitor.textContent = "开启监测";
  els.calibrate.disabled = true;
  els.viewStatus.textContent = "已暂停";
  els.scoreNum.textContent = "—";
  setTray("idle");
  pushEvent("暂停监测");
  renderChecks(null);
  syncDashboard(null, false);
  broadcast(null, false);
}

function bind() {
  els.monitor.addEventListener("click", () => {
    if (state.monitoring) stopMonitor();
    else startMonitor();
  });
  els.calibrate.addEventListener("click", () => {
    try {
      state.baseline = engine.calibrate();
      localStorage.setItem("zuohao-baseline", JSON.stringify(state.baseline));
      api.saveBaseline(state.baseline);
      const cva = state.baseline.cva;
      if (cva != null && cva < 48) toast("校准偏前倾", `这次颅椎角只有 ${cva.toFixed(0)}°。先坐正再校准。`);
      else toast("已记录标准坐姿", `侧拍基准颅椎角 ${cva != null ? `${cva.toFixed(0)}°` : "已记下"}。`);
      pushEvent("完成坐姿校准");
      els.coach.textContent = "校准完成。侧看耳朵离开肩膀正上方超过两秒就会提醒。";
    } catch (err) {
      toast("校准没完成", err.message);
    }
  });
  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const next = {
      ...state.settings,
      sitIntervalMinutes: Number(els.form.sitIntervalMinutes.value),
      breakMinutes: Number(els.form.breakMinutes.value),
      sensitivity: els.form.sensitivity.value,
      viewMode: els.form.viewMode.value,
      theme: els.form.theme.value,
      sound: els.form.sound.checked,
      startOnLaunch: els.form.startOnLaunch.checked,
      launchAtLogin: els.form.launchAtLogin.checked,
      minimizeOnClose: els.form.minimizeOnClose.checked,
      cameraId: els.cameraSelect.value || null,
      checks: {
        forwardHead: els.form.forwardHead.checked,
        slouch: els.form.slouch.checked,
        headTilt: els.form.headTilt.checked,
        unevenShoulders: els.form.unevenShoulders.checked,
        lean: els.form.lean.checked,
      },
    };
    state.settings = await api.saveSettings(next);
    applyTheme(state.settings.theme);
    engine.setSettings(state.settings);
    if (state.monitoring && next.cameraId !== engine.cameraId) await engine.switchCamera(next.cameraId);
    toast("设置已保存", `每坐 ${state.settings.sitIntervalMinutes} 分钟提醒起身`);
    renderChecks(state.lastFrame?.analysis);
  });
  els.onboardBtn.addEventListener("click", async () => {
    localStorage.setItem("zuohao-onboarded", "1");
    els.onboard.hidden = true;
    showSection("Home");
    await startMonitor();
  });

  document.getElementById("btn-capsule").addEventListener("click", () => api.enableCapsule());
  document.getElementById("btn-settings").addEventListener("click", () => {
    applyForm();
    showSection("Settings");
  });
  document.getElementById("btn-settings-back").addEventListener("click", () => showSection("Home"));
  document.getElementById("window-minimize").addEventListener("click", () => api.minimizeWindow());
  document.getElementById("window-maximize").addEventListener("click", async () => {
    state.maximized = await api.toggleMaximizeWindow();
    document.querySelector("#window-maximize span").classList.toggle("restore-icon", state.maximized);
  });
  document.getElementById("window-close").addEventListener("click", () => api.closeWindow());

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select, textarea")) return;
    if (e.code === "Space") {
      e.preventDefault();
      els.monitor.click();
    }
    if (e.key === "c" || e.key === "C") els.calibrate.click();
    if (e.key === "Escape" && state.section === "Settings") showSection("Home");
  });

  api.onSettingsUpdated((next) => {
    state.settings = next;
    engine.setSettings(next);
    applyTheme(next.theme);
  });
  api.onBreakDismissed(() => endBreak(false));
  api.onBreakSnoozed(() => endBreak(true));
  api.onNavigate((section) => {
    if (section === "Settings") {
      applyForm();
      showSection("Settings");
      return;
    }
    showSection("Home");
  });
  api.onMaximizedChange((value) => {
    state.maximized = value;
    document.querySelector("#window-maximize span").classList.toggle("restore-icon", value);
  });
}

async function boot() {
  state.settings = await api.getSettings();
  state.history = await api.getHistory();
  applyTheme(state.settings.theme);
  try {
    state.baseline = JSON.parse(
      localStorage.getItem("zuohao-baseline") ||
        localStorage.getItem("haozuo-baseline") ||
        "null"
    );
    if (state.baseline && state.baseline.view !== "side" && state.baseline.view !== "oblique") state.baseline = null;
    if (state.baseline) api.saveBaseline(state.baseline);
  } catch {
    state.baseline = null;
  }
  renderChecks(null);
  updateDaySummary();
  applyMirror(null);
  applyForm();
  bind();
  tick();

  if (
    !localStorage.getItem("zuohao-onboarded") &&
    !localStorage.getItem("haozuo-onboarded")
  ) {
    els.onboard.hidden = false;
    showSection("Home");
    return;
  }
  if (state.settings.startOnLaunch) startMonitor();
}

boot();
