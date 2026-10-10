.PHONY: install infra migrate api processor worker beat web check test test-translation test-browser

install:
	uv --directory backend sync --all-extras
	npm --prefix api ci
	npm --prefix frontend ci

infra:
	docker compose up -d postgres redis storage

migrate:
	uv --directory backend run alembic upgrade head
	uv --directory backend run python -m transler.bootstrap

api:
	npm --prefix api run dev

processor:
	uv --directory backend run uvicorn transler.http.processor:app --host 127.0.0.1 --port 8001 --reload

worker:
	uv --directory backend run --env-file ../.env celery -A transler.worker:celery worker --loglevel=INFO --pool=solo --concurrency=1 -Q pdf,celery

beat:
	mkdir -p .runtime
	uv --directory backend run celery -A transler.worker:celery beat --loglevel=INFO --schedule=../.runtime/celerybeat-schedule

web:
	npm --prefix frontend run dev

check:
	uv --directory backend run python ../scripts/check_architecture.py
	npm --prefix api run check
	cd api && npx prettier --check src package.json tsconfig.json
	uv --directory backend run ruff check src tests migrations ../scripts
	uv --directory backend run ruff format --check src tests migrations ../scripts
	uv --directory backend run mypy src/transler
	npm --prefix frontend run check
	cd frontend && npx prettier --check src tests vite.config.ts playwright.config.ts playwright.production.config.ts

test:
	npm --prefix api run build
	uv --directory backend run pytest -m 'not translation' -q

test-translation:
	npm --prefix api run build
	uv --directory backend run --env-file ../.env pytest -m translation -q

test-browser:
	cd frontend && npx playwright install chromium
	npm --prefix frontend run test:e2e
