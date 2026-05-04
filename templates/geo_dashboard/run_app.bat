@echo off
cd /d "%~dp0"

echo ========================================
echo  Geo Dashboard Dev
echo ========================================
echo.
echo Preparing dev assets and starting Vite. Browser will open to whichever port Vite picks.
echo Close this window to stop the dev server.
echo.

python app_core\prepare_dev_assets.py
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%

cd /d "%~dp0app_core"
npm run dev
