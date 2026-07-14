#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Set version — use argument if provided, otherwise read from pyproject.toml
if [ -n "$1" ]; then
  VERSION="$1"
  sed -i '' "s/^version = \".*\"/version = \"${VERSION}\"/" pyproject.toml
  echo "Version updated to ${VERSION}"
else
  VERSION=$(grep '^version' pyproject.toml | head -1 | sed 's/.*"\(.*\)".*/\1/')
fi
echo "Publishing vibefoundry v${VERSION}"

# Clear cache and build artifacts
echo "Clearing cache..."
rm -rf dist build src/vibefoundry.egg-info

echo "Clearing static files..."
rm -rf src/vibefoundry/static/*

# npm install and build frontend
echo "Installing frontend dependencies..."
cd frontend
npm install
echo "Building frontend..."
npm run build
echo "Building Codex pane bundle..."
npm run build:pane
cd ..

# Sync the pane MCP (Node server + built pane HTML) into the pip package so it
# ships as package data (used by the Codex desktop-app plugin).
echo "Packaging pane MCP..."
mkdir -p src/vibefoundry/pane_mcp/pane
cp codex-plugin/vibefoundry/server/index.js src/vibefoundry/pane_mcp/index.js
cp codex-plugin/vibefoundry/server/pane/index.pane.html src/vibefoundry/pane_mcp/pane/index.pane.html

# Build Python package
echo "Building Python package..."
python -m build

# Push to PyPI — token lives in .env (PYPI_TOKEN=...), with .pypi_token as a legacy fallback
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a; . "$SCRIPT_DIR/.env"; set +a
fi
if [ -z "$PYPI_TOKEN" ] && [ -f "$SCRIPT_DIR/.pypi_token" ]; then
  PYPI_TOKEN=$(cat "$SCRIPT_DIR/.pypi_token")
fi
if [ -z "$PYPI_TOKEN" ]; then
  echo "Error: PYPI_TOKEN not set"
  echo "Add PYPI_TOKEN=pypi-... to .env in the project root"
  exit 1
fi
echo "Uploading to PyPI..."
twine upload dist/* -u __token__ -p "$PYPI_TOKEN"

echo "Done! vibefoundry v${VERSION} published to PyPI"
