@echo off
setlocal
cd /d "%~dp0"

set "PYTHON="
where python >nul 2>nul
if not errorlevel 1 set "PYTHON=python"
if not defined PYTHON if exist "%LocalAppData%\Programs\Python\Python311\python.exe" set "PYTHON=%LocalAppData%\Programs\Python\Python311\python.exe"
if not defined PYTHON if exist "%LocalAppData%\Programs\Python\Python312\python.exe" set "PYTHON=%LocalAppData%\Programs\Python\Python312\python.exe"

if not defined PYTHON (
  echo Python was not found. Install Python 3.10 through 3.12, then run this file again.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment...
  "%PYTHON%" -m venv .venv
  if errorlevel 1 goto :error
)

echo Installing required packages. The first installation may take several minutes...
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :error
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :error

echo Starting local PaddleOCR server at http://127.0.0.1:8123
start "" http://127.0.0.1:8123
".venv\Scripts\python.exe" -m uvicorn paddle_server:app --host 127.0.0.1 --port 8123
goto :end

:error
echo.
echo Startup failed. Check the messages above, your internet connection, and Python version.
:end
pause
