const clock = document.getElementById("clock");
const body = document.getElementById("body");
let endAt = Date.now() + 180000;

function pad(n) {
  return String(n).padStart(2, "0");
}

function tick() {
  const left = Math.max(0, endAt - Date.now());
  const s = Math.ceil(left / 1000);
  clock.textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  if (left <= 0) window.zuohao.dismissBreak();
}

window.zuohao.onBreakUpdate((payload) => {
  if (payload?.body) body.textContent = payload.body;
  if (payload?.remainMs) endAt = Date.now() + payload.remainMs;
  tick();
});

document.getElementById("done").onclick = () => window.zuohao.dismissBreak();
document.getElementById("snooze").onclick = () => window.zuohao.snoozeBreak();
setInterval(tick, 250);
tick();
