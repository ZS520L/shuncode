<#
.SYNOPSIS
    ShunCode 开发重启脚本
    杀死残留进程 → 重新构建（前端 + 后端）→ 启动

.USAGE
    .\scripts\dev-restart.ps1           # 完整构建 + 启动
    .\scripts\dev-restart.ps1 -Fast     # 仅构建扩展后端（跳过 webview），适合只改了 .ts 文件
    .\scripts\dev-restart.ps1 -WebOnly  # 仅构建 webview 前端
#>

param(
    [switch]$Fast,      # 跳过 webview 构建
    [switch]$WebOnly    # 仅构建 webview
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ExtDir = Join-Path $RootDir "extensions\shuncode"
$WebviewDir = Join-Path $ExtDir "webview-ui"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  ShunCode Dev Restart" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# ============================================================
# Step 1: 杀死残留进程
# ============================================================
Write-Host "[1/4] Killing ShunCode processes..." -ForegroundColor Yellow

$processNames = @("ShunCode", "shuncode")
foreach ($name in $processNames) {
    $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
    if ($procs) {
        $procs | Stop-Process -Force
        Write-Host "  Killed $($procs.Count) '$name' process(es)" -ForegroundColor Gray
    }
}

# Also kill any electron processes from .build directory
$electronProcs = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path -like "*$RootDir\.build\electron*"
}
if ($electronProcs) {
    $electronProcs | Stop-Process -Force
    Write-Host "  Killed $($electronProcs.Count) electron dev process(es)" -ForegroundColor Gray
}

# Wait for processes to fully exit
Start-Sleep -Milliseconds 500
Write-Host "  Done." -ForegroundColor Green

# ============================================================
# Step 2: 构建 Webview 前端
# ============================================================
if (-not $Fast) {
    Write-Host "`n[2/4] Building webview (frontend)..." -ForegroundColor Yellow
    Push-Location $WebviewDir
    try {
        & npm run build 2>&1 | ForEach-Object {
            if ($_ -match "error|ERROR") { Write-Host "  $_" -ForegroundColor Red }
        }
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Webview build FAILED!" -ForegroundColor Red
            Pop-Location
            exit 1
        }
        Write-Host "  Done." -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
} else {
    Write-Host "`n[2/4] Skipping webview build (-Fast mode)" -ForegroundColor DarkGray
}

# ============================================================
# Step 3: 构建 Extension 后端
# ============================================================
if (-not $WebOnly) {
    Write-Host "`n[3/4] Building extension (backend)..." -ForegroundColor Yellow
    Push-Location $ExtDir
    try {
        & node esbuild.mjs 2>&1 | ForEach-Object {
            if ($_ -match "ERROR") { Write-Host "  $_" -ForegroundColor Red }
            elseif ($_ -match "build finished") { Write-Host "  $_" -ForegroundColor Green }
        }
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Extension build FAILED!" -ForegroundColor Red
            Pop-Location
            exit 1
        }
        Write-Host "  Done." -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
} else {
    Write-Host "`n[3/4] Skipping extension build (-WebOnly mode)" -ForegroundColor DarkGray
}

# ============================================================
# Step 4: 启动 ShunCode
# ============================================================
Write-Host "`n[4/4] Launching ShunCode..." -ForegroundColor Yellow

$electronExe = Join-Path $RootDir ".build\electron\ShunCode.exe"
if (-not (Test-Path $electronExe)) {
    Write-Host "  ERROR: $electronExe not found!" -ForegroundColor Red
    Write-Host "  Run 'npm run electron' in root first." -ForegroundColor Red
    exit 1
}

$env:NODE_ENV = "development"
$env:VSCODE_DEV = "1"
$env:VSCODE_CLI = "1"
$env:ELECTRON_ENABLE_LOGGING = "1"
$env:ELECTRON_ENABLE_STACK_DUMPING = "1"
if (-not $env:SHUNCODE_ENVIRONMENT) { $env:SHUNCODE_ENVIRONMENT = "production" }

# Launch in background so script can exit
Start-Process -FilePath $electronExe -ArgumentList ".", "--disable-extension=vscode.vscode-api-tests" -WorkingDirectory $RootDir

Write-Host "  ShunCode launched!" -ForegroundColor Green
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  All done! ShunCode is starting." -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan
