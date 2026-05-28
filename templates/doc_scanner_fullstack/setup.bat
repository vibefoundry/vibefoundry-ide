@echo off
REM Run: app_folder\scripts\receipts_app\setup.bat
cd /d "%~dp0"

echo ========================================
echo  Receipts App Setup
echo ========================================

echo.
echo [1/3] Checking Python dependencies...
pip show flask >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       Installing Python dependencies...
    pip install -r backend\requirements.txt
) else (
    echo       Already installed, skipping.
)

echo.
echo [2/3] Checking Node dependencies...
REM The vite binary is the sentinel - `npm run dev` invokes it. A half-installed
REM node_modules\ (missing .bin\vite.cmd) needs `npm install` to re-run.
if not exist "frontend\node_modules\.bin\vite.cmd" (
    echo       Installing Node dependencies...
    cd frontend
    call npm install
    cd ..
) else (
    echo       Already installed, skipping.
)

echo.
echo [3/3] Checking concurrently...
call npx concurrently --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       Installing concurrently...
    cd frontend
    call npm install concurrently --save-dev
    cd ..
) else (
    echo       Already installed, skipping.
)

echo.
echo ========================================
echo  Setup complete! Run: app_folder\scripts\receipts_app\run_app.bat
echo ========================================
