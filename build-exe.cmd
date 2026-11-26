@echo off
rem CloudClientForge - build the GUI exe (double-click friendly, ASCII only)
rem
rem First run: full package (~1-2 min). Later runs: fast rebuild (~20 s).
rem Fast mode reuses _build\gui-release\win-unpacked and only re-packs app.asar,
rem so it is only available after a previous build that kept the runtime.
setlocal
set "ELECTRON_RUN_AS_NODE="
set "HERE=%~dp0"
set "RUNTIME=%HERE%_build\gui-release\win-unpacked\CloudClientForge.exe"

echo.
echo   CloudClientForge - build CloudClientForge.exe
echo.

if exist "%RUNTIME%" (
  echo   mode: fast rebuild ^(reuse existing runtime^)
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%tools\build-gui.ps1" -Fast -KeepRelease
) else (
  echo   mode: full build ^(first run, ~1-2 min^)
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%tools\build-gui.ps1" -KeepRelease
)

echo.
if exist "%HERE%CloudClientForge.exe" (
  echo   [OK] %HERE%CloudClientForge.exe
  echo   next builds will be fast ^(runtime is kept in _build\gui-release^)
  start "" explorer.exe "%HERE%"
) else (
  echo   [x] build failed - see the log above
)

echo.
pause
