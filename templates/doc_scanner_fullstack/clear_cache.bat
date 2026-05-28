@echo off
REM Run: app_folder\scripts\receipts_app\clear_cache.bat
cd /d "%~dp0"

echo ========================================
echo  Clearing Cache
echo ========================================

echo Removing node_modules...
if exist "frontend\node_modules" rmdir /s /q "frontend\node_modules"

echo Removing __pycache__...
for /d /r . %%d in (__pycache__) do @if exist "%%d" rmdir /s /q "%%d"

echo Removing build artifacts...
if exist "frontend\build" rmdir /s /q "frontend\build"
if exist "frontend\dist" rmdir /s /q "frontend\dist"

echo.
echo Cache cleared. Running setup...
echo.
call "%~dp0setup.bat"
