@echo off
REM Run: app_folder\scripts\image_scanner\run_app.bat
REM cd to this script's own folder — app.py is a sibling
cd /d "%~dp0"
python app.py
