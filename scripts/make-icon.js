const { spawnSync } = require("child_process");
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
$img.Dispose()
`;
const result = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status || 1);
}
console.log("tray icons written from assets/icon.png");
