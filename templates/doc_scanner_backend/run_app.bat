@echo off
REM Run: app_folder\scripts\{app_name}\run_app.bat
REM cd to this script's own folder — app.py is a sibling
cd /d "%~dp0"

REM Auto-trigger setup if any Python dep is missing.
pip show openai >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto :need_setup
pip show watchdog >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto :need_setup
pip show pillow >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto :need_setup
goto :run

:need_setup
echo Python deps missing - running setup.bat...
call "%~dp0setup.bat" || (echo Setup failed. & exit /b 1)

:run
python app.py
