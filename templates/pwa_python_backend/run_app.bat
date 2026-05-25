@echo off
REM Run: app_folder\scripts\receipts_app\run_app.bat
cd /d "%~dp0"

if not exist "frontend\node_modules" (
    echo Dependencies not installed. Run setup.bat first.
    echo   app_folder\scripts\receipts_app\setup.bat
    exit /b 1
)

echo ========================================
echo  Launching Receipts App
echo ========================================

REM Reserve two free ports up front so frontend + backend agree on what's used.
for /f %%p in ('python -c "import socket; s=socket.socket(); s.bind((''''127.0.0.1'''',0)); print(s.getsockname()[1]); s.close()"') do set BACKEND_PORT=%%p
for /f %%p in ('python -c "import socket; s=socket.socket(); s.bind((''''127.0.0.1'''',0)); print(s.getsockname()[1]); s.close()"') do set FRONTEND_PORT=%%p

echo Backend  : http://localhost:%BACKEND_PORT%
echo Frontend : http://localhost:%FRONTEND_PORT%
cd frontend
call npx concurrently -n "backend,frontend" -c "blue,green" "cd /d \"%cd%\..\" && python backend\app.py" "npm run dev"
