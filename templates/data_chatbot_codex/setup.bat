@echo off
REM Run: app_folder\scripts\data_chatbot_codex\setup.bat
cd /d "%~dp0"

echo ========================================
echo  Data Chatbot Setup
echo ========================================

echo.
echo [1/4] Checking Codex CLI...
REM The chatbot drives every model call through `codex exec`. If codex isn't on
REM PATH there is nothing for the backend to talk to — fail fast here instead
REM of at the first /api/ask.
where codex >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: codex CLI not found on PATH.
    echo Install OpenAI Codex CLI and run 'codex login' before launching.
    exit /b 1
) else (
    echo       Codex CLI found.
)

echo.
echo [2/4] Checking Python dependencies...
pip show flask >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       Installing Python dependencies...
    pip install -r backend\requirements.txt
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: pip install failed
        exit /b 1
    )
) else (
    echo       Already installed, skipping.
)

echo.
echo [3/4] Checking Node dependencies...
REM The vite binary is the sentinel — `npm run dev` invokes it. A half-installed
REM node_modules\ (missing .bin\vite.cmd) needs `npm install` to re-run.
if not exist "frontend\node_modules\.bin\vite.cmd" (
    echo       Installing Node dependencies (clean install)...
    REM Nuke any residue from a prior interrupted install — leftover files
    REM with broken perms (EACCES on esbuild's postinstall, etc.) make
    REM `npm install` over the top fail. Starting clean guarantees a fresh,
    REM consistent tree.
    if exist "frontend\node_modules" rmdir /s /q "frontend\node_modules"
    cd frontend
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: npm install failed
        cd ..
        exit /b 1
    )
    cd ..
) else (
    echo       Already installed, skipping.
)

echo.
echo [4/4] Checking concurrently...
REM Check the binary directly — `npx concurrently --version` can hang on Windows
REM when npm contacts the registry, even with the package already installed.
if not exist "frontend\node_modules\.bin\concurrently.cmd" (
    echo       Installing concurrently...
    cd frontend
    call npm install concurrently --save-dev
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: concurrently install failed
        cd ..
        exit /b 1
    )
    cd ..
) else (
    echo       Already installed, skipping.
)

echo.
echo ========================================
echo  Setup complete! Run: app_folder\scripts\data_chatbot_codex\run_app.bat
echo ========================================
