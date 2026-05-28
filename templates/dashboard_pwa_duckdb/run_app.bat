@echo off
cd /d "%~dp0"

python app_core\prepare_dev_assets.py
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
python app_core\serve.py
