const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Tray dots are generated from assets/icon.png via PowerShell System.Drawing.
const ps = `
Add-Type -AssemblyName System.Drawing
$destDir = "${path.join(__dirname, "..", "assets").replace(/\\/g, "\\\\")}"
$img = [System.Drawing.Image]::FromFile((Join-Path $destDir "icon.png"))
function Save-Tray($name, $r, $g, $b) {
  $size = 32
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $gfx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $gfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gfx.Clear([System.Drawing.Color]::Transparent)
  $gfx.DrawImage($img, 0, 0, $size, $size)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, $r, $g, $b))
  $gfx.FillEllipse($brush, 22, 22, 9, 9)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(230, 255, 255, 255), 1.2)
  $gfx.DrawEllipse($pen, 22, 22, 9, 9)
  $bmp.Save((Join-Path $destDir "tray-$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $gfx.Dispose(); $bmp.Dispose(); $brush.Dispose(); $pen.Dispose()
}
Save-Tray idle 113 113 122
Save-Tray good 34 197 94
Save-Tray warn 250 204 21
Save-Tray alert 239 68 68
Save-Tray break 16 163 127
function Save-Square($size, $name) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $gfx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $gfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gfx.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $gfx.Clear([System.Drawing.Color]::Transparent)
  $gfx.DrawImage($img, 0, 0, $size, $size)
  $bmp.Save((Join-Path $destDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $gfx.Dispose(); $bmp.Dispose()
}
Save-Square 256 "icon-256.png"
Save-Square 48 "icon-48.png"
Save-Square 32 "icon-32.png"
Save-Square 16 "icon-16.png"
$img.Dispose()
`;
const result = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status || 1);
}
console.log("tray icons written from assets/icon.png");

const destDir = path.join(__dirname, "..", "assets");
const sizes = [256, 48, 32, 16];
const parts = sizes.map((size) => ({
  width: size,
  height: size,
  png: fs.readFileSync(path.join(destDir, `icon-${size}.png`)),
}));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(parts.length, 4);
let offset = 6 + 16 * parts.length;
const entries = [];
for (const part of parts) {
  const entry = Buffer.alloc(16);
  entry[0] = part.width >= 256 ? 0 : part.width;
  entry[1] = part.height >= 256 ? 0 : part.height;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(part.png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += part.png.length;
  entries.push(entry);
}
fs.writeFileSync(path.join(destDir, "icon.ico"), Buffer.concat([header, ...entries, ...parts.map((p) => p.png)]));
for (const size of sizes) fs.unlinkSync(path.join(destDir, `icon-${size}.png`));
console.log("icon.ico written from assets/icon.png");
