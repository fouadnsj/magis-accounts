@echo off
chcp 65001 >nul
echo ============================================================
echo  MAGIS Accounts - Step 1 / 2 : install the build tools
echo  (Node.js, Rust, Microsoft C++ Build Tools). Needs internet.
echo  Can take 30-60 minutes. Windows may ask "Allow changes?" : Yes.
echo ============================================================
echo.
winget --version >nul 2>&1
if errorlevel 1 (
  echo "winget" is missing. Open the Microsoft Store, install "App Installer", then run this file again.
  pause
  exit /b 1
)
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-source-agreements --accept-package-agreements --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
echo.
echo Done. RESTART THE COMPUTER, then double-click "2-construire.cmd".
pause
