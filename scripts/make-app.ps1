[CmdletBinding()]
param(
    [switch]$SkipTests,
    [switch]$SkipInstall,
    [switch]$SkipLaunch
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$distributionRoot = Join-Path $repositoryRoot "dist"
$installedExecutable = Join-Path $env:LOCALAPPDATA "Programs\ZuoHao\ZuoHao.exe"
$startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$desktopDir = [Environment]::GetFolderPath("Desktop")

function Invoke-Npm {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & npm.cmd @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "npm command failed: npm $($Arguments -join ' ')"
    }
}

function Stop-ExistingZuoHao {
    $normalizedRepositoryRoot = $repositoryRoot.TrimEnd("\")
    $processes = Get-CimInstance Win32_Process | Where-Object {
        $executablePath = [string]$_.ExecutablePath
        $commandLine = [string]$_.CommandLine
        ($executablePath -and $executablePath.Equals($installedExecutable, [StringComparison]::OrdinalIgnoreCase)) -or
        (
            $_.Name -ieq "electron.exe" -and
            $commandLine.IndexOf($normalizedRepositoryRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
        ) -or
        (
            $_.Name -ieq "ZuoHao.exe" -and
            $executablePath -and
            $executablePath.IndexOf("ZuoHao", [StringComparison]::OrdinalIgnoreCase) -ge 0
        )
    }
    foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    if ($processes) {
        Start-Sleep -Milliseconds 750
    }
}

Push-Location $repositoryRoot
try {
    if (-not $SkipTests) {
        Invoke-Npm run test:analyze
    }
    Invoke-Npm run dist
} finally {
    Pop-Location
}

$installer = Get-ChildItem -LiteralPath $distributionRoot -Filter "ZuoHao-Setup-*.exe" -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
if ($null -eq $installer) {
    throw "The ZuoHao installer was not created below $distributionRoot"
}

if (-not $SkipInstall) {
    Stop-ExistingZuoHao
    $installerProcess = Start-Process -FilePath $installer.FullName -ArgumentList "/S" -PassThru -Wait
    if ($installerProcess.ExitCode -ne 0) {
        throw "The ZuoHao installer failed with exit code $($installerProcess.ExitCode)."
    }
    if (-not (Test-Path -LiteralPath $installedExecutable -PathType Leaf)) {
        throw "ZuoHao was not installed at the canonical path $installedExecutable"
    }

    if (-not $SkipLaunch) {
        Start-Process -FilePath $installedExecutable | Out-Null
        $ready = $false
        for ($attempt = 0; $attempt -lt 80; $attempt += 1) {
            try {
                $health = Invoke-RestMethod -Uri "http://127.0.0.1:18765/api/health" -TimeoutSec 1
                if ($health.ok -eq $true) {
                    $ready = $true
                    break
                }
            } catch {
                Start-Sleep -Milliseconds 250
            }
        }
        if (-not $ready) {
            throw "Installed ZuoHao launched, but its local API did not become healthy."
        }
        $installedProcesses = Get-CimInstance Win32_Process | Where-Object {
            $executablePath = [string]$_.ExecutablePath
            $executablePath -and $executablePath.Equals($installedExecutable, [StringComparison]::OrdinalIgnoreCase)
        }
        if (-not $installedProcesses) {
            throw "The canonical installed ZuoHao process is not running."
        }
    }

    function Test-ShortcutToZuoHao([string]$directory) {
        $shell = New-Object -ComObject WScript.Shell
        Get-ChildItem -LiteralPath $directory -Filter "*.lnk" -ErrorAction SilentlyContinue | Where-Object {
            try {
                $target = [string]$shell.CreateShortcut($_.FullName).TargetPath
                $target.Equals($installedExecutable, [StringComparison]::OrdinalIgnoreCase)
            } catch {
                $false
            }
        }
    }
    if (-not (Test-ShortcutToZuoHao $startMenuDir)) {
        throw "The ZuoHao Start menu shortcut was not created."
    }
    if (-not (Test-ShortcutToZuoHao $desktopDir)) {
        throw "The ZuoHao desktop shortcut was not created."
    }
}

Write-Host "Built installer: $($installer.FullName)"
if (-not $SkipInstall) {
    Write-Host "Installed application: $installedExecutable"
}
