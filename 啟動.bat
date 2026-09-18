@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 Node.js。請先安裝 Node.js 18 或更新版本後再試一次。
  pause
  exit /b 1
)

echo 啟動本機靜態網站：PaddleOCR 會在瀏覽器內執行。
node server.js
pause
