.PHONY: help dev dev-infra dev-api dev-web build test-api test-web lint clean db-migrate db-rollback

help:           ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

dev: dev-infra dev-api dev-web  ## Start all dev services

dev-infra:      ## Start Postgres, Keycloak, LiteLLM
	DOCKER_BUILDKIT=0 docker compose -f infra/docker-compose.yml up -d postgres keycloak litellm

dev-api:        ## Start FastAPI dev server with hot-reload
	cd apps/api-server && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

dev-web:        ## Start Vite dev server
	cd apps/web-client && pnpm dev

build:          ## Build all Docker images
	DOCKER_BUILDKIT=0 docker compose -f infra/docker-compose.yml build

up:             ## Start all services via Docker Compose
	DOCKER_BUILDKIT=0 docker compose -f infra/docker-compose.yml up -d

down:           ## Stop all services
	DOCKER_BUILDKIT=0 docker compose -f infra/docker-compose.yml down

test-api:       ## Run API tests
	cd apps/api-server && python -m pytest tests/ -v

test-web:       ## Run web tests
	cd apps/web-client && pnpm test

lint:           ## Lint all code
	cd apps/api-server && ruff check app/
	cd apps/web-client && pnpm lint

clean:          ## Clean up containers, volumes, temp files
	DOCKER_BUILDKIT=0 docker compose -f infra/docker-compose.yml down -v
	rm -rf apps/*/__pycache__ apps/*/.venv apps/*/node_modules

db-migrate:     ## Run Alembic migrations
	cd apps/api-server && alembic upgrade head

db-rollback:    ## Rollback Alembic migration by one step
	cd apps/api-server && alembic downgrade -1
