.PHONY: install dev build clean publish test

# Install dependencies for development
install:
	cd frontend && npm install
	pip install -e ".[dev]"

# Run in development mode (frontend dev server + backend)
dev:
	@echo "Starting development servers..."
	@echo "Frontend: http://localhost:5173"
	@echo "Backend: http://localhost:8765"
	@trap 'kill 0' EXIT; \
		cd frontend && npm run dev & \
		VIBEFOUNDRY_PROJECT_PATH="" python -m vibefoundry --no-browser --port 8765

# Build the frontend and package
build: build-frontend build-package

# Build just the frontend
build-frontend:
	cd frontend && npm run build

# Build the Python package
build-package:
	python -m build

# Clean build artifacts
clean:
	rm -rf dist/
	rm -rf src/vibefoundry.egg-info/
	rm -rf src/vibefoundry/static/assets/
	rm -f src/vibefoundry/static/index.html
	rm -f src/vibefoundry/static/vite.svg
	cd frontend && rm -rf node_modules/

# Publish to PyPI
publish: build
	twine upload dist/*

# Publish to Test PyPI
publish-test: build
	twine upload --repository testpypi dist/*

# Run the app locally (after building)
run:
	python -m vibefoundry

# Run tests
test:
	python -m pytest tests/
