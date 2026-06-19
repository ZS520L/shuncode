@echo off
setlocal EnableDelayedExpansion

set "ARCH=x64"
set "MINIFY="
if "%~1"=="--no-minify" set "MINIFY=no"
if "%~1"=="-Minify" if "%~2"=="$false" set "MINIFY=no"
if "%~1"=="-Minify" if "%~2"=="false" set "MINIFY=no"

pushd "%~dp0\.."
set "ROOT=%CD%"

echo.
echo ========================================
echo   ShunCode Portable Build
echo ========================================
echo   Platform: win32
echo   Arch:     %ARCH%
echo   Minify:   %MINIFY%
echo.

:: Step 1: Dependencies
if exist "node_modules" (
    echo [1/5] Dependencies OK
) else (
    echo [1/5] Installing dependencies...
    call npm ci
    if errorlevel 1 goto :error
)

if not exist "build\node_modules" (
    echo   Installing build dependencies...
    pushd build
    call npm ci
    popd
    if errorlevel 1 goto :error
)

:: Step 2: Electron
echo [2/5] Downloading Electron...
call npm run electron
if errorlevel 1 goto :error

:: Step 3: Built-in extensions
echo [3/5] Downloading built-in extensions...
call npm run download-builtin-extensions
if errorlevel 1 (
    echo   Warning: extensions download failed, continuing...
)

:: Step 4: Compile and package
if "%MINIFY%"=="no" (
    set "GULP_TASK=vscode-win32-%ARCH%"
) else (
    set "GULP_TASK=vscode-win32-%ARCH%-min"
)
echo [4/5] Compiling and packaging (!GULP_TASK!)...
echo   This may take several minutes...
call npm run gulp -- !GULP_TASK!
if errorlevel 1 goto :error

:: Step 5: Create portable data folder
for %%I in ("%ROOT%\..") do set "PARENT=%%~fI"
set "OUTPUT_DIR=%PARENT%\VSCode-win32-%ARCH%"
echo [5/5] Creating portable mode marker...
if not exist "%OUTPUT_DIR%\data" mkdir "%OUTPUT_DIR%\data"

echo.
echo ========================================
echo   Build Complete!
echo ========================================
echo.
echo   Output: %OUTPUT_DIR%
echo   Launch: %OUTPUT_DIR%\ShunCode.exe
echo.
echo   data/ folder created - portable mode enabled.
echo   All user config will be stored inside data/
echo.

popd
exit /b 0

:error
echo.
echo   BUILD FAILED!
echo.
popd
exit /b 1
