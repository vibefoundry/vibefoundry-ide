@echo off
REM Run: app_folder\scripts\{app_name}\setup.bat
cd /d "%~dp0"

echo ========================================
echo  Doc Scanner Agent Setup
echo ========================================

echo.
echo [1/1] Checking Python dependencies...
pip show openai >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       Installing Python dependencies...
    pip install -r requirements.txt
) else (
    pip show watchdog >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo       Installing Python dependencies...
        pip install -r requirements.txt
    ) else (
        pip show pillow >nul 2>&1
        if %ERRORLEVEL% NEQ 0 (
            echo       Installing Python dependencies...
            pip install -r requirements.txt
        ) else (
            echo       Already installed, skipping.
        )
    )
)

echo.
echo ========================================
echo  Setup complete! Run: %~dp0run_app.bat
echo ========================================
