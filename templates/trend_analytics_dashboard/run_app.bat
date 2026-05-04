@echo off
REM Run: app_folder\templates\trend_analytics_dashboard\run_app.bat
cd /d "%~dp0"
for %%I in ("%cd%") do set APP_NAME=%%~nxI

echo [1/2] Building app package...
python build_app_package.py
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%

echo [2/2] Launching...
cd /d "%~dp0..\..\..\output_folder\%APP_NAME%"
call pc_start.bat
