#!/bin/bash
# Launch VibeFoundry IDE

# Navigate to script directory
cd "$(dirname "$0")"

# Check if vibefoundry is installed
if ! command -v vibefoundry &> /dev/null; then
    echo "vibefoundry not found, installing from local package..."
    pip install -e .
fi

# Launch with optional project folder argument
if [ -n "$1" ]; then
    vibefoundry "$1"
else
    vibefoundry
fi
