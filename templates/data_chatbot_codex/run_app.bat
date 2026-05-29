@echo off
REM Run: app_folder\scripts\data_chatbot_codex\run_app.bat
cd /d "%~dp0"

echo [run_app] Starting launcher...
echo [run_app] Working directory: %CD%

REM The vite binary is the install sentinel — `npm run dev` calls it directly,
REM so its absence (missing OR half-installed node_modules\) means setup must run.
echo [run_app] Checking frontend deps...
if not exist "frontend\node_modules\.bin\vite.cmd" (
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
for /f %%p in ('python "%~dp0backend\_pick_port.py"') do set BACKEND_PORT=%%p
if "%BACKEND_PORT%"=="" (
    echo [run_app] ERROR: could not reserve backend port. Is Python installed and on PATH?
    pause
    exit /b 1
)
for /f %%p in ('python "%~dp0backend\_pick_port.py"') do set FRONTEND_PORT=%%p
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
call npx concurrently -n "backend,frontend" -c "blue,green" "cd /d \"%cd%\..\" && python backend\app.py" "npm run dev"
