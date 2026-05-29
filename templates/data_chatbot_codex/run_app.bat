@echo off
REM Run: app_folder\scripts\data_chatbot_codex\run_app.bat
cd /d "%~dp0"

REM The vite binary is the install sentinel — `npm run dev` calls it directly,
REM so its absence (missing OR half-installed node_modules\) means setup must run.
if not exist "frontend\node_modules\.bin\vite.cmd" (
    echo Frontend deps missing or incomplete - running setup.bat...
    call "%~dp0setup.bat" || (echo Setup failed. & exit /b 1)
)

REM Re-check codex is on PATH even if setup didn't run this launch (a user
REM could uninstall codex between launches and we'd otherwise only notice at
REM the first /api/ask). Fast: one `where`.
where codex >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: codex CLI not found on PATH.
    echo Install OpenAI Codex CLI and try again.
    exit /b 1
)

REM Verify codex is authenticated. Exit code is 0 when logged in, non-zero
REM when missing/expired — in which case we run `codex login` interactively
REM so the browser-OAuth happens before the backend starts (Flask has no TTY,
REM so a 401 mid-request would be unrecoverable from the UI).
codex login status >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Codex not logged in - opening browser for OAuth...
    call codex login
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: codex login failed.
        exit /b 1
    )
)

echo ========================================
echo  Launching Data Chatbot
echo ========================================

REM Reserve two free ports up front so frontend + backend agree on what's used.
for /f %%p in ('python -c "import socket; s=socket.socket(); s.bind((''''127.0.0.1'''',0)); print(s.getsockname()[1]); s.close()"') do set BACKEND_PORT=%%p
for /f %%p in ('python -c "import socket; s=socket.socket(); s.bind((''''127.0.0.1'''',0)); print(s.getsockname()[1]); s.close()"') do set FRONTEND_PORT=%%p

echo Backend  : http://localhost:%BACKEND_PORT%
echo Frontend : http://localhost:%FRONTEND_PORT%
cd frontend
call npx concurrently -n "backend,frontend" -c "blue,green" "cd /d \"%cd%\..\" && python backend\app.py" "npm run dev"
