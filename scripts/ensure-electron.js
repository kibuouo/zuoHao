const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const exe = path.join(__dirname, "..", "node_modules", "electron", "dist", "electron.exe");
if (fs.existsSync(exe)) process.exit(0);

const installer = path.join(__dirname, "..", "node_modules", "electron", "install.js");
if (!fs.existsSync(installer)) {
  console.warn("electron package missing; run npm install again");
  process.exit(0);
}

const result = spawnSync(process.execPath, [installer], {
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/",
  },
});
process.exit(result.status || 0);
