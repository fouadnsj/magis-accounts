@echo off
rem Started by Windows at boot (task "MAGIS Server"). If the server ever stops, it starts again after 5 seconds.
cd /d "%~dp0"
if not exist "%ProgramData%\MAGIS" mkdir "%ProgramData%\MAGIS"
:loop
"%~dp0magis-node.exe" --no-warnings "%~dp0server.mjs" >> "%ProgramData%\MAGIS\server.log" 2>&1
timeout /t 5 /nobreak >nul
goto loop
