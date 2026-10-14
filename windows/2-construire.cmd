@echo off
chcp 65001 >nul
echo ============================================================
echo  MAGIS Accounts - Step 2 / 2 : build the Windows installer
echo  Needs internet the first time. Takes 10-20 minutes.
echo ============================================================
cd /d "%~dp0.."
call rustup default stable-msvc
call npm ci
if errorlevel 1 goto fail
call npx tauri build --bundles nsis
if errorlevel 1 goto fail
echo.
echo ============================================================
echo  SUCCESS. The installer is in the folder that opens now:
echo  "MAGIS Accounts_..._x64-setup.exe"  - copy it to each holder.
echo ============================================================
explorer "src-tauri\target\release\bundle\nsis"
pause
exit /b 0
:fail
echo.
echo  Something failed. Take a photo of this window and send it.
pause
exit /b 1
