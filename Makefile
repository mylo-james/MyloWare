# MyloWare Makefile
# Common commands for development workflow

.PHONY: help install dev-install test lint format type-check ci docker-up docker-down clean

# Default target
help:
	@echo "MyloWare Development Commands"
	@echo "=============================="
	@echo ""
	@echo "Setup:"
	@echo "  make install       Install production dependencies"
	@echo "  make dev-install   Install with dev dependencies"
	@echo ""
	@echo "Quality:"
	@echo "  make lint          Run linter (ruff)"
	@echo "  make format        Format code (black + ruff)"
	@echo "  make type-check    Run type checker (mypy)"
	@echo "  make test          Run unit tests"
	@echo "  make test-cov      Run tests with coverage"
	@echo "  make ci            Run all CI checks locally"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-up     Start all services"
	@echo "  make docker-down   Stop all services"
	@echo "  make docker-logs   Follow service logs"
	@echo ""
	@echo "Database:"
	@echo "  make db-migrate    Run database migrations"
	@echo "  make db-reset      Reset database (WARNING: drops data)"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean         Remove build artifacts"

# =============================================================================
# Setup
# =============================================================================

install:
	pip install -e .

dev-install:
	pip install -e ".[dev]"
	@echo "Installing pre-commit hooks..."
	pre-commit install || echo "pre-commit not installed, skipping hooks"

# =============================================================================
# Quality Checks
# =============================================================================

lint:
	ruff check src/ tests/

format:
	black src/ tests/
	ruff check --fix src/ tests/

type-check:
	mypy src/ --ignore-missing-imports

test:
	PYTHONPATH=src pytest tests/unit/ -v --tb=short

test-cov:
	PYTHONPATH=src pytest tests/unit/ -v --tb=short --cov=src --cov-report=html --cov-report=term

test-integration:
	PYTHONPATH=src pytest tests/integration/ -v --tb=short -m integration

# Run all CI checks locally
ci: lint type-check test
	@echo "✅ All CI checks passed!"

# =============================================================================
# Docker
# =============================================================================

docker-up:
	docker compose up -d
	@echo "Services starting... Check status with 'docker compose ps'"

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-build:
	docker compose build

# =============================================================================
# Database
# =============================================================================

db-migrate:
	PYTHONPATH=src alembic upgrade head

db-reset:
	@echo "⚠️  This will DROP all data. Press Ctrl+C to cancel."
	@sleep 3
	PYTHONPATH=src alembic downgrade base
	PYTHONPATH=src alembic upgrade head

# =============================================================================
# Cleanup
# =============================================================================

clean:
	rm -rf build/
	rm -rf dist/
	rm -rf *.egg-info/
	rm -rf src/*.egg-info/
	rm -rf .pytest_cache/
	rm -rf .ruff_cache/
	rm -rf .mypy_cache/
	rm -rf htmlcov/
	rm -rf .coverage
	rm -rf coverage.xml
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	@echo "✅ Cleaned build artifacts"

# =============================================================================
# Development Helpers
# =============================================================================

# Start API server in development mode
serve:
	PYTHONPATH=src uvicorn api.server:app --reload --host 0.0.0.0 --port 8000

# Run a single workflow (for testing)
run-workflow:
	@echo "Usage: make run-workflow PROJECT=test_video_gen BRIEF='your brief'"
	PYTHONPATH=src python -c "from cli.main import cli; cli()" workflow start $(PROJECT) "$(BRIEF)"

