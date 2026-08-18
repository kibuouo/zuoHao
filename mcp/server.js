#!/usr/bin/env node
/**
 * 好坐 / ZuoHao MCP server (stdio JSON-RPC).
 * Talks to the running Electron app on 127.0.0.1, or reads userData files if the app is closed.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const USER_DATA = process.env.ZUOHAO_USER_DATA || path.join(os.homedir(), "AppData", "Roaming", "zuohao");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readToken() {
  if (process.env.ZUOHAO_TOKEN) return process.env.ZUOHAO_TOKEN;
  const tokenFile = path.join(USER_DATA, "mcp-token.txt");
  try {
    return fs.readFileSync(tokenFile, "utf8").trim();
  } catch {
    return "";
  }
}

function resolveEndpoint() {
  const meta = readJson(path.join(USER_DATA, "mcp.json"), null);
  return {
    url: (process.env.ZUOHAO_API_URL || meta?.url || "http://127.0.0.1:18765").replace(/\/$/, ""),
    token: readToken(),
  };
}

function request(method, pathname, body) {
  const { url, token } = resolveEndpoint();
  const target = new URL(pathname, `${url}/`);
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method,
        timeout: 2500,
        headers: {
          Accept: "application/json",
          "X-ZuoHao-Token": token,
          ...(payload
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode, data: JSON.parse(text || "{}") });
          } catch {
            resolve({ status: res.statusCode, data: { raw: text } });
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (payload) req.write(payload);
    req.end();
  });
}

async function liveOrFile(livePath, fileName) {
  try {
    const res = await request("GET", livePath);
    if (res.status >= 200 && res.status < 300) return { source: "live", ...res.data };
  } catch {
    /* app not running */
  }
  const data = readJson(path.join(USER_DATA, fileName), null);
  if (data) return { source: "file", appRunning: false, ...data };
  throw new Error("好坐未运行，且用户目录里还没有这份数据。先启动应用：在 zuoHao 目录执行 npm start。");
}

const TOOLS = [
  {
    name: "zuohao_get_status",
    description: "检查好坐应用是否在运行，以及本机 MCP HTTP 接口是否可用。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "zuohao_get_snapshot",
    description: "读取当前坐姿快照：颅椎角、前移、含胸角、头侧倾、高低肩、侧倾、视角、问题列表。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "zuohao_get_samples",
    description: "读取最近若干帧的量化指标，用于对照误报/漏报。",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 180, description: "返回条数，默认 60" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "zuohao_get_frame",
    description: "抓取当前监测画面（视频+骨架叠图）并保存到项目 .debug/frame.jpg，同时返回指标。用来对照点位和误报。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "zuohao_get_settings",
    description: "读取监测设置：灵敏度、拍摄方向、检测项、久坐间隔。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "zuohao_update_settings",
    description: "更新监测设置。只传要改的字段。应用在运行时会立即生效。",
    inputSchema: {
      type: "object",
      properties: {
        sensitivity: { type: "string", enum: ["strict", "standard", "relaxed"] },
        viewMode: { type: "string", enum: ["side", "auto", "front"] },
        sitIntervalMinutes: { type: "number" },
        breakMinutes: { type: "number" },
        holdSeconds: { type: "number" },
        alertCooldownSeconds: { type: "number" },
        checks: { type: "object" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "zuohao_get_algorithm",
    description: "读取可热更新的算法阈值：颅椎角预警/报警、下巴前伸、躯干前倾、平滑系数。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "zuohao_update_algorithm",
    description:
      "热更新算法阈值。常用：cvaWarn(52)、cvaAlert(46)、earFwdWarn(0.24)、earFwdAlert(0.42)、worldFwdWarn(0.04)、smoothAlphaDown(0.48)。应用在运行时下一帧生效。",
    inputSchema: {
      type: "object",
      properties: {
        cvaWarn: { type: "number" },
        cvaAlert: { type: "number" },
        cvaHardAlert: { type: "number" },
        pokeWarn: { type: "number" },
        pokeCva: { type: "number" },
        earFwdWarn: { type: "number" },
        earFwdAlert: { type: "number" },
        chinFwdWarn: { type: "number" },
        chinFwdAlert: { type: "number" },
        worldFwdWarn: { type: "number" },
        worldFwdAlert: { type: "number" },
        trunkWarn: { type: "number" },
        trunkAlert: { type: "number" },
        tiltLimit: { type: "number" },
        slopeLimit: { type: "number" },
        leanLimit: { type: "number" },
        tiltLimitSide: { type: "number" },
        slopeLimitSide: { type: "number" },
        leanLimitSide: { type: "number" },
        smoothAlpha: { type: "number" },
        smoothAlphaDown: { type: "number" },
        landmarkAlphaSide: { type: "number" },
        landmarkAlphaFront: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "zuohao_get_history",
    description: "读取本地按日汇总的坐姿历史：良好占比、落座分钟、预警次数、采样点。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "zuohao_get_baseline",
    description: "读取用户校准的标准坐姿基准（若有）。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "zuohao_add_note",
    description: "写入一条算法调试笔记，并附带当时的坐姿快照，方便后续对照。",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "观察或假设，例如：侧拍含胸误报，当时躯干角 9°" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "zuohao_list_notes",
    description: "列出最近的算法调试笔记。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case "zuohao_get_status": {
      try {
        const res = await request("GET", "/api/health");
        return { running: res.status === 200, ...res.data };
      } catch (err) {
        return {
          running: false,
          error: err.message,
          hint: "在 zuoHao 目录执行 npm start 启动好坐后重试。",
        };
      }
    }
    case "zuohao_get_snapshot":
      return liveOrFile("/api/snapshot", "live-snapshot.json");
    case "zuohao_get_frame": {
      const res = await request("GET", "/api/frame");
      if (res.status >= 400) throw new Error(res.data.error || "抓取画面失败，确认应用正在监测");
      return res.data;
    }
    case "zuohao_get_samples": {
      try {
        const limit = args.limit || 60;
        const res = await request("GET", `/api/samples?limit=${limit}`);
        if (res.status >= 200 && res.status < 300) return { source: "live", ...res.data };
      } catch {
        /* fallback */
      }
      return { source: "file", appRunning: false, items: [] };
    }
    case "zuohao_get_settings":
      return liveOrFile("/api/settings", "settings.json");
    case "zuohao_update_settings": {
      const res = await request("PUT", "/api/settings", args);
      if (res.status >= 400) throw new Error(res.data.error || "更新设置失败，确认应用正在运行");
      return res.data;
    }
    case "zuohao_get_algorithm":
      return liveOrFile("/api/algorithm", "settings.json").then((data) => data.algorithm || data);
    case "zuohao_update_algorithm": {
      const res = await request("PUT", "/api/algorithm", args);
      if (res.status >= 400) throw new Error(res.data.error || "更新算法失败，确认应用正在运行");
      return res.data;
    }
    case "zuohao_get_history":
      return liveOrFile("/api/history", "history.json");
    case "zuohao_get_baseline":
      return liveOrFile("/api/baseline", "baseline.json");
    case "zuohao_add_note": {
      const res = await request("POST", "/api/notes", { text: args.text });
      if (res.status >= 400) throw new Error(res.data.error || "写笔记失败，确认应用正在运行");
      return res.data;
    }
    case "zuohao_list_notes":
      return liveOrFile("/api/notes", "agent-notes.json");
    default:
      throw new Error(`未知工具 ${name}`);
  }
}

function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function fail(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    return ok(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "zuohao-mcp-server", version: "1.0.0" },
    });
  }
  if (method === "notifications/initialized" || method === "initialized") return null;
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    try {
      const result = await callTool(params.name, params.arguments || {});
      return ok(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      });
    } catch (err) {
      return ok(id, {
        isError: true,
        content: [{ type: "text", text: err.message || String(err) }],
      });
    }
  }
  if (id === undefined) return null;
  return fail(id, -32601, `Method not found: ${method}`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const header = buffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) break;
    const raw = buffer.slice(start, start + length);
    buffer = buffer.slice(start + length);
    let message;
    try {
      message = JSON.parse(raw);
    } catch (err) {
      process.stderr.write(`bad json: ${err.message}\n`);
      continue;
    }
    Promise.resolve(handle(message))
      .then((response) => {
        if (!response) return;
        const body = Buffer.from(JSON.stringify(response), "utf8");
        process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
        process.stdout.write(body);
      })
      .catch((err) => {
        process.stderr.write(`${err.stack || err.message}\n`);
      });
  }
});
