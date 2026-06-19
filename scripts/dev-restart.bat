@echo off
:: ShunCode 开发重启 - 杀进程 + 构建 + 启动
:: 用法:
::   dev-restart.bat           完整构建
::   dev-restart.bat -Fast     仅构建后端（跳过 webview）
::   dev-restart.bat -WebOnly  仅构建前端

pushd %~dp0\..
powershell -ExecutionPolicy Bypass -File "%~dp0dev-restart.ps1" %*
popd
