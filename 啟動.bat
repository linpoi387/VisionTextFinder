@echo off
setlocal
title Vision Text Finder
pushd "%~dp0"
if errorlevel 1 (
  echo Cannot open the project folder:
  echo %~dp0
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 18 or later, then try again.
  pause
  exit /b 1
)

echo Starting local static site. The actual URL will be shown below.
node "%~dp0server.js"
set "EXIT_CODE=%errorlevel%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo The server stopped with error code %EXIT_CODE%. See the message above for details.
) else (
  echo The server stopped normally.
)
pause
