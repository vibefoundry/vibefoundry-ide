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
cd ..

# Build Python package
echo "Building Python package..."
python -m build

# Push to PyPI
PYPI_TOKEN=$(cat "$SCRIPT_DIR/.pypi_token" 2>/dev/null)
if [ -z "$PYPI_TOKEN" ]; then
  echo "Error: .pypi_token file not found"
  echo "Create .pypi_token in the project root with your PyPI token"
  exit 1
fi
echo "Uploading to PyPI..."
twine upload dist/* -u __token__ -p "$PYPI_TOKEN"

echo "Done! vibefoundry v${VERSION} published to PyPI"
