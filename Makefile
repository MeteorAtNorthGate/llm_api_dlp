.PHONY: help dev-infra dev-api dev-web build test-api test-web lint clean db-migrate db-rollback build-cloud push-cloud

help:           ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

dev-infra:      ## Start Postgres, Keycloak, LiteLLM (Docker)
	DOCKER_BUILDKIT=0 docker compose -f infra/docker-compose.yml up -d postgres
	@sleep 3
	@docker exec llm-dlp-postgres psql -U llmuser -c "CREATE DATABASE keycloak;" 2>/dev/null || echo "  keycloak DB already exists"
	DOCKER_BUILDKIT=0 docker compose -f infra/docker-compose.yml up -d keycloak litellm

dev-api:        ## Start FastAPI dev server with hot-reload (port 8000)
	cd apps/api-server && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

dev-web:        ## Start Vite dev server with HMR (port 5173)
	cd apps/web-client && pnpm dev

build:          ## Build all Docker images (local)
	DOCKER_BUILDKIT=0 docker compose -f infra/docker-compose.yml build

up:             ## Start all services locally via Docker Compose
	DOCKER_BUILDKIT=0 docker compose -f infra/docker-compose.yml up -d

down:           ## Stop all local services
	DOCKER_BUILDKIT=0 docker compose -f infra/docker-compose.yml down

# --- Cloud deployment ---

build-cloud:    ## Build images and package for cloud (output: infra/images.tar.gz)
	DOCKER_BUILDKIT=0 docker compose -f infra/docker-compose.yml build
	docker save llm-dlp-api:latest llm-dlp-web:latest -o infra/images.tar.gz
	@echo "✓ infra/images.tar.gz ready for transfer"

push-cloud: build-cloud  ## Build + upload to cloud server (set CLOUD_HOST env var)
	@test -n "$(CLOUD_HOST)" || (echo "❌ Set CLOUD_HOST first, e.g. CLOUD_HOST=user@1.2.3.4" && exit 1)
	scp infra/images.tar.gz $(CLOUD_HOST):~/llm-dlp/infra/
	scp infra/docker-compose.cloud.yml $(CLOUD_HOST):~/llm-dlp/infra/
	scp infra/.env.cloud $(CLOUD_HOST):~/llm-dlp/infra/
	scp -r infra/keycloak/ infra/litellm/ $(CLOUD_HOST):~/llm-dlp/infra/
	ssh $(CLOUD_HOST) "cd ~/llm-dlp && docker load -i infra/images.tar.gz && docker compose -f infra/docker-compose.cloud.yml --env-file infra/.env.cloud up -d"
	@echo "✓ Cloud deploy complete"

# --- Testing & quality ---

test-api:       ## Run API tests
	cd apps/api-server && .venv/bin/python -m pytest tests/ -v

test-web:       ## Run web tests
	cd apps/web-client && pnpm test

lint:           ## Lint all code
	cd apps/api-server && .venv/bin/ruff check app/
	cd apps/web-client && pnpm lint

# --- Maintenance ---

clean:          ## Clean up containers, volumes, temp files
	DOCKER_BUILDKIT=0 docker compose -f infra/docker-compose.yml down -v
	rm -rf apps/*/__pycache__ apps/*/.venv apps/*/node_modules
	rm -f infra/images.tar.gz

db-migrate:     ## Run Alembic migrations
	cd apps/api-server && .venv/bin/alembic upgrade head

db-rollback:    ## Rollback Alembic migration by one step
	cd apps/api-server && .venv/bin/alembic downgrade -1
