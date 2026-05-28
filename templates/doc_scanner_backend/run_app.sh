#!/bin/bash
# Run: bash app_folder/scripts/{app_name}/run_app.sh
# cd to this script's own folder — app.py is a sibling
cd "$(dirname "$0")"

# Auto-trigger setup if any Python dep is missing.
if ! pip show openai > /dev/null 2>&1 || ! pip show watchdog > /dev/null 2>&1 || ! pip show pillow > /dev/null 2>&1; then
    echo "Python deps missing — running setup.sh..."
    bash "$(dirname "$0")/setup.sh" || { echo "Setup failed."; exit 1; }
fi

python app.py
