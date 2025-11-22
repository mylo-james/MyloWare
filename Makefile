COMPOSE ?= docker compose --env-file .env -f infra/docker-compose.yml
PYTEST ?= pytest -q
PYTEST_TARGETS ?= tests/unit tests/integration/python_api tests/integration/python_orchestrator
COVERAGE_FAIL_UNDER ?= 80
PYTHON ?= python3

.PHONY: up down logs lint test test-coverage coverage-report smoke type-check security deploy-staging-api deploy-staging-orchestrator migrate-staging demo-aismr demo-test-video-gen check-env

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down --remove-orphans

logs:
	$(COMPOSE) logs -f api orchestrator

lint:
	ruff check apps/api apps/orchestrator --select E9,F63,F7,F82
	$(PYTHON) scripts/dev/lint_no_direct_adapter_instantiation.py apps cli core content

test:
	@echo "🔒 Running tests in MOCK mode (PROVIDERS_MODE=mock)"
	PROVIDERS_MODE=mock $(PYTEST) $(PYTEST_TARGETS)

test-coverage:
	@echo "🔒 Running coverage tests in MOCK mode (PROVIDERS_MODE=mock)"
	$(PYTHON) -m coverage erase
	PROVIDERS_MODE=mock $(PYTHON) -m coverage run -m pytest -q $(PYTEST_TARGETS)
	$(PYTHON) -m coverage json -o coverage.json
	$(PYTHON) -m coverage xml -o python-coverage.xml
	$(PYTHON) -m coverage report --fail-under=$(COVERAGE_FAIL_UNDER)

coverage-report:
	$(PYTHON) -m coverage report --fail-under=$(COVERAGE_FAIL_UNDER)

smoke:
	./scripts/smoke.sh

type-check:
	mypy apps/ --strict

security:
	$(PYTHON) -m pip install pip-audit --quiet
	$(PYTHON) -m pip_audit

deploy-staging-api:
	flyctl deploy --config fly.api.toml

deploy-staging-orchestrator:
	flyctl deploy --config fly.orchestrator.toml

migrate-staging:
	bash infra/scripts/migrate_staging.sh

demo-aismr:
	mw-py demo aismr --env staging

demo-test-video-gen:
	mw-py demo test-video-gen --env staging

check-env:
	mw-py validate env
