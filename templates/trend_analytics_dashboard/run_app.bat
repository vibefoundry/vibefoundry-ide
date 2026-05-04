@echo off
REM Windows dev launcher (plain-script, no npm, no Vite, no Node).
REM Stages assets, then serves src_app/ via a Python HTTP server.
cd /d "%~dp0"

echo ========================================
echo  Trend Analytics Dashboard Dev
echo ========================================
echo.

python app_core\prepare_dev_assets.py
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%

python app_core\serve_dev.py
