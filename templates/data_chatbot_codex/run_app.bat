@echo off
REM Run: app_folder\scripts\data_chatbot_codex\run_app.bat
cd /d "%~dp0"

echo [run_app] Starting launcher...
echo [run_app] Working directory: %CD%

REM The vite AND concurrently binaries are the install sentinels — the launcher
REM calls both directly (see concurrently call below), so either one's absence
REM (missing OR half-installed node_modules\, e.g. a tree from before
REM concurrently was added to package.json) means setup must run.
echo [run_app] Checking frontend deps...
set NEED_SETUP=
if not exist "frontend\node_modules\.bin\vite.cmd" set NEED_SETUP=1
if not exist "frontend\node_modules\.bin\concurrently.cmd" set NEED_SETUP=1
if defined NEED_SETUP (
    echo [run_app] Frontend deps missing - running setup.bat...
    call "%~dp0setup.bat"
    if %ERRORLEVEL% NEQ 0 (
        echo [run_app] ERROR: setup.bat failed with code %ERRORLEVEL%.
        pause
        exit /b 1
    )
)
echo [run_app] Frontend deps OK.

REM Re-check codex is on PATH.
echo [run_app] Checking codex is on PATH...
where codex >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [run_app] ERROR: codex CLI not found on PATH.
    echo Install OpenAI Codex CLI and try again.
    pause
    exit /b 1
)
echo [run_app] Codex found.

REM Skip the `codex login status` check — on some Windows machines that call
REM hangs indefinitely contacting the auth server. Auth errors surface in the
REM app UI via the re-auth modal instead.

echo [run_app] Reserving ports...
REM One python call returns both ports (see backend\_pick_port.py).
for /f "tokens=1,2" %%a in ('python "%~dp0backend\_pick_port.py"') do (
    set BACKEND_PORT=%%a
    set FRONTEND_PORT=%%b
)
if "%BACKEND_PORT%"=="" (
    echo [run_app] ERROR: could not reserve backend port. Is Python installed and on PATH?
    pause
    exit /b 1
)
if "%FRONTEND_PORT%"=="" (
    echo [run_app] ERROR: could not reserve frontend port.
    pause
    exit /b 1
)
echo [run_app] Ports reserved OK.

echo ========================================
echo  Launching Data Chatbot
echo ========================================
echo Backend  : http://localhost:%BACKEND_PORT%
echo Frontend : http://localhost:%FRONTEND_PORT%

echo [run_app] Starting servers with concurrently...
cd frontend
REM Call the local concurrently + vite binaries directly. `npx` does a registry
REM round-trip that can hang on Windows even when the package is installed, and
REM invoking vite directly skips an extra `npm run dev` Node bootstrap.
call node_modules\.bin\concurrently.cmd -n "backend,frontend" -c "blue,green" "cd /d \"%cd%\..\" && python backend\app.py" "node_modules\.bin\vite.cmd"
