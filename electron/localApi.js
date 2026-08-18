const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const RING_LIMIT = 180;

function createLocalApi({
  userFile,
  readJson,
  writeJson,
  loadSettings,
  saveSettings,
  loadHistory,
  getLive,
  setLive,
  getRing,
  pushRing,
  getFramePath,
  requestFrame,
  notifyRenderer,
}) {
  let server = null;
  let port = 0;
  let token = "";

  function loadToken() {
    const file = userFile("mcp-token.txt");
    try {
      const existing = fs.readFileSync(file, "utf8").trim();
      if (existing) return existing;
    } catch {
      /* create below */
    }
    const next = crypto.randomBytes(16).toString("hex");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, next, "utf8");
    return next;
  }

  function json(res, code, body) {
    const text = JSON.stringify(body);
    res.writeHead(code, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(text),
      "Access-Control-Allow-Origin": "*",
    });
    res.end(text);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > 1_000_000) {
          reject(new Error("请求体过大"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (!chunks.length) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", reject);
    });
  }

  function isLocal(req) {
    const addr = req.socket.remoteAddress || "";
    return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  }

  function authorized(req, pathname) {
    if (pathname === "/api/health") return true;
    const header = req.headers["x-zuohao-token"] || "";
    const query = new URL(req.url, "http://127.0.0.1").searchParams.get("token") || "";
    return header === token || query === token;
  }

  async function handle(req, res) {
    if (!isLocal(req)) {
      json(res, 403, { error: "只接受本机回环访问" });
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-ZuoHao-Token",
        "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
      });
      res.end();
      return;
    }

    const url = new URL(req.url, "http://127.0.0.1");
    const pathname = url.pathname;
    if (!authorized(req, pathname)) {
      json(res, 401, { error: "缺少或错误的 X-ZuoHao-Token。Token 在用户目录 mcp-token.txt。" });
      return;
    }

    if (pathname === "/api/health" && req.method === "GET") {
      json(res, 200, { ok: true, name: "zuohao", port, live: Boolean(getLive()), now: Date.now() });
      return;
    }
    if (pathname === "/api/snapshot" && req.method === "GET") {
      json(res, 200, getLive() || { running: false, note: "应用在跑，但还没有监测帧" });
      return;
    }
    if ((pathname === "/api/frame" || pathname === "/api/frame.jpg") && req.method === "GET") {
      const meta = requestFrame ? await requestFrame() : null;
      const file = (meta && meta.project) || (getFramePath && getFramePath());
      if (pathname === "/api/frame.jpg") {
        if (!file || !fs.existsSync(file)) {
          json(res, 404, { error: "还没有画面。先开启监测，并保持主窗口不要完全退出。" });
          return;
        }
        const buf = fs.readFileSync(file);
        res.writeHead(200, {
          "Content-Type": "image/jpeg",
          "Content-Length": buf.length,
          "Cache-Control": "no-store",
        });
        res.end(buf);
        return;
      }
      json(res, 200, {
        ok: Boolean(file && fs.existsSync(file)),
        path: file || null,
        userPath: meta?.user || null,
        bytes: meta?.bytes || (file && fs.existsSync(file) ? fs.statSync(file).size : 0),
        updatedAt: meta?.updatedAt || null,
        present: meta?.present ?? null,
        issues: meta?.issues || [],
        metrics: meta?.metrics || getLive()?.metrics || null,
        live: getLive() || null,
      });
      return;
    }
    if (pathname === "/api/samples" && req.method === "GET") {
      const limit = Math.min(Number(url.searchParams.get("limit")) || 60, RING_LIMIT);
      const items = getRing().slice(-limit);
      json(res, 200, { count: items.length, items });
      return;
    }
    if (pathname === "/api/settings" && req.method === "GET") {
      json(res, 200, loadSettings());
      return;
    }
    if (pathname === "/api/settings" && req.method === "PUT") {
      const body = await readBody(req);
      const merged = saveSettings(body);
      notifyRenderer(merged);
      json(res, 200, merged);
      return;
    }
    if (pathname === "/api/algorithm" && req.method === "GET") {
      json(res, 200, loadSettings().algorithm);
      return;
    }
    if (pathname === "/api/algorithm" && req.method === "PUT") {
      const body = await readBody(req);
      const current = loadSettings();
      const merged = saveSettings({ ...current, algorithm: { ...current.algorithm, ...body } });
      notifyRenderer(merged);
      json(res, 200, merged.algorithm);
      return;
    }
    if (pathname === "/api/history" && req.method === "GET") {
      json(res, 200, loadHistory());
      return;
    }
    if (pathname === "/api/baseline" && req.method === "GET") {
      json(res, 200, readJson(userFile("baseline.json"), { exists: false }));
      return;
    }
    if (pathname === "/api/notes" && req.method === "GET") {
      json(res, 200, readJson(userFile("agent-notes.json"), { notes: [] }));
      return;
    }
    if (pathname === "/api/notes" && req.method === "POST") {
      const body = await readBody(req);
      const text = String(body.text || body.note || "").trim();
      if (!text) {
        json(res, 400, { error: "需要 text 字段" });
        return;
      }
      const store = readJson(userFile("agent-notes.json"), { notes: [] });
      store.notes.unshift({
        t: Date.now(),
        text,
        snapshot: getLive() || null,
      });
      store.notes = store.notes.slice(0, 80);
      writeJson(userFile("agent-notes.json"), store);
      json(res, 200, { ok: true, count: store.notes.length });
      return;
    }

    json(res, 404, { error: `未知接口 ${req.method} ${pathname}` });
  }

  function start() {
    token = loadToken();
    server = http.createServer((req, res) => {
      handle(req, res).catch((err) => json(res, 500, { error: err.message || String(err) }));
    });
    return new Promise((resolve, reject) => {
      const tryPort = (candidate) => {
        server.once("error", (err) => {
          if (err.code === "EADDRINUSE" && candidate < 18770) {
            server.close();
            server = http.createServer((req, res) => {
              handle(req, res).catch((e) => json(res, 500, { error: e.message || String(e) }));
            });
            tryPort(candidate + 1);
            return;
          }
          reject(err);
        });
        server.listen(candidate, "127.0.0.1", () => {
          port = candidate;
          writeJson(userFile("mcp.json"), {
            port,
            url: `http://127.0.0.1:${port}`,
            tokenFile: userFile("mcp-token.txt"),
            startedAt: Date.now(),
          });
          resolve({ port, token });
        });
      };
      tryPort(18765);
    });
  }

  function stop() {
    if (server) server.close();
  }

  return { start, stop, RING_LIMIT, pushRing, setLive };
}

module.exports = { createLocalApi, RING_LIMIT };
