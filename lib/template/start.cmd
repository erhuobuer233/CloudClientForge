@echo off
rem @@PRODUCT@@ - fallback launcher (ASCII only, safe on any codepage)
setlocal
set "ELECTRON_RUN_AS_NODE="
set "HERE=%~dp0"

rem 1) single-file client in this folder (cached, ~1s startup)
if exist "%HERE%@@PRODUCT@@.exe" (
  start "" "%HERE%@@PRODUCT@@.exe"
  exit /b 0
)

rem 2) unpacked folder build
for %%F in ("%HERE%release\win-unpacked\*.exe") do (
  start "" "%%~fF"
  exit /b 0
)

rem 3) run from source
set "ELECTRON=@@TOOLCHAIN@@\node_modules\electron\dist\electron.exe"
if exist "%ELECTRON%" (
  start "" "%ELECTRON%" "%HERE%app"
  exit /b 0
)

echo.
echo   [x] Client not found.
echo       Build it first:  powershell -ExecutionPolicy Bypass -File tools\build-client.ps1
echo.
pause
