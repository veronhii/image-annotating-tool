@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not in PATH.
  echo Install Node.js from https://nodejs.org/ then try again.
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo Installing dependencies for first run...
  call npm install
  if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

echo Launching Image Annotation Workspace...
call npm start

if errorlevel 1 (
  echo App exited with an error.
  pause
)

endlocal
