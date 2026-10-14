@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Накладні
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Не знайдено Node.js.
  echo  Встановіть його з https://nodejs.org ^(версія LTS^), потім запустіть цей файл ще раз.
  echo.
  start "" https://nodejs.org/uk
  pause
  exit /b 1
)
set OPEN_BROWSER=1
node --no-warnings server.mjs
pause
