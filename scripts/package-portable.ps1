param([bool]$Minify = $true, [string]$Arch = "x64")

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Push-Location $Root

Write-Host ""
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host "  ShunCode Portable Build"               -ForegroundColor Cyan
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host "  Platform: win32 | Arch: $Arch | Minify: $Minify" -ForegroundColor White
Write-Host ""

# Step 1: Dependencies
if (Test-Path "node_modules") { Write-Host "[1/5] Dependencies OK" -ForegroundColor Green } else { Write-Host "[1/5] Installing dependencies..." -ForegroundColor Yellow; npm ci; if ($LASTEXITCODE -ne 0) { throw "npm ci failed" } }

if (-not (Test-Path "build/node_modules")) {
    Write-Host "  Installing build dependencies..." -ForegroundColor Yellow
    Push-Location build; npm ci; Pop-Location
    if ($LASTEXITCODE -ne 0) { throw "build npm ci failed" }
}

# Step 2: Electron
Write-Host "[2/5] Downloading Electron..." -ForegroundColor Yellow
npm run electron
if ($LASTEXITCODE -ne 0) { throw "Electron download failed" }

# Step 3: Built-in extensions
Write-Host "[3/5] Downloading built-in extensions..." -ForegroundColor Yellow
npm run download-builtin-extensions
if ($LASTEXITCODE -ne 0) { Write-Host "  Warning: extensions download failed (non-fatal)" -ForegroundColor DarkYellow }

# Step 4: Compile and package
$GulpTask = "vscode-win32-$Arch"
if ($Minify) { $GulpTask = "vscode-win32-$Arch-min" }
Write-Host "[4/5] Compiling and packaging ($GulpTask)..." -ForegroundColor Yellow
Write-Host "  This may take several minutes..." -ForegroundColor DarkGray
npm run gulp -- $GulpTask
if ($LASTEXITCODE -ne 0) { throw "gulp $GulpTask failed" }

# Step 5: Create portable data folder
$OutputDir = Join-Path (Split-Path -Parent $Root) "VSCode-win32-$Arch"
Write-Host "[5/5] Creating portable mode marker..." -ForegroundColor Yellow
$DataDir = Join-Path $OutputDir "data"
if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir -Force | Out-Null }

Write-Host ""
Write-Host "========================================"  -ForegroundColor Green
Write-Host "  Build Complete!"                        -ForegroundColor Green
Write-Host "========================================"  -ForegroundColor Green
Write-Host "  Output: $OutputDir"                     -ForegroundColor White
Write-Host "  Launch: $OutputDir\ShunCode.exe"        -ForegroundColor Cyan
Write-Host ""
Write-Host "  data/ created - all user config stored inside." -ForegroundColor White
Write-Host ""

Pop-Location
