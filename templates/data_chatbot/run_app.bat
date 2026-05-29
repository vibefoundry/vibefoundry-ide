@echo off
REM Run: app_folder\scripts\data_chatbot\run_app.bat
cd /d "%~dp0"

REM The vite binary is the install sentinel — `npm run dev` calls it directly,
REM so its absence (missing OR half-installed node_modules\) means setup must run.
if not exist "frontend\node_modules\.bin\vite.cmd" (
    echo Frontend deps missing or incomplete - running setup.bat...
    call "%~dp0setup.bat" || (echo Setup failed. & exit /b 1)
)

echo ========================================
echo  Launching Data Chatbot
echo ========================================

REM Reserve two free ports up front so frontend + backend agree on what's used.
REM Use a helper .py file instead of inline `python -c`. The inline form
REM requires escaping single quotes inside `for /f`, which is unreliable
REM across Windows shell variants (CMD vs. Terminal vs. PowerShell host).
for /f %%p in ('python "%~dp0backend\_pick_port.py"') do set BACKEND_PORT=%%p
for /f %%p in ('python "%~dp0backend\_pick_port.py"') do set FRONTEND_PORT=%%p

echo Backend  : http://localhost:%BACKEND_PORT%
echo Frontend : http://localhost:%FRONTEND_PORT%
cd frontend
call npx concurrently -n "backend,frontend" -c "blue,green" "cd /d \"%cd%\..\" && python backend\app.py" "npm run dev"
