@echo off
rem CloudClientForge - double-click friendly wrapper (ASCII only)
rem
rem Usage:
rem   forge.cmd                                         (asks for a URL)
rem   forge.cmd https://xxx.com/cloudgame              (URL only)
rem   forge.cmd https://xxx.com/cloudgame -Name "My Cloud" -Shortcuts
rem
setlocal
set "ELECTRON_RUN_AS_NODE="
set "HERE=%~dp0"

if "%~1"=="" (
  echo.
  echo   CloudClientForge - build a desktop client from a cloud game web page
  echo.
  set /p "URL=  Enter the cloud game URL: "
  echo.
  if "%URL%"=="" (
    echo   [x] No URL given.
    pause
    exit /b 1
  )
  powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%forge.ps1" -Url "%URL%"
) else (
  echo.
  echo   CloudClientForge: %*
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%forge.ps1" %*
)

echo.
pause
