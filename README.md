# llm_api_dlp — Enterprise AI Platform

Internal enterprise LLM service portal providing a ChatGPT-like chat interface and developer API key self-service, with enterprise SSO (Keycloak/LDAP) and DLP data masking via LiteLLM hooks.

## Architecture

```
Browser → React (Vite) → FastAPI → LiteLLM Proxy (DLP) → External LLMs
                   ↓                    ↓
              Keycloak (OIDC)      PostgreSQL
                   ↓                    ↓
              MinIO (S3)           File Attachments
```

### Chat Features
- **Streaming chat** with SSE (Server-Sent Events)
- **File upload** via drag-and-drop (PDF, DOCX, XLSX, TXT, CSV, images)
- **Document parsing** with `unstructured` library — parsed text is injected into the LLM context
- **DLP data masking** — sensitive data (credit cards, SSN, phone, email, etc.) is masked before reaching external LLMs
- **Conversation history** — all messages and file attachments persist across sessions
- **API key self-service** — developers can generate and manage their own LiteLLM virtual keys

## Prerequisites

| Dependency | Version | Purpose |
|---|---|---|
| Python | 3.11+ | API server runtime |
| Node.js / pnpm | 22+ | Web client build & dev |
| Docker | 24+ | Infrastructure containers |
| Docker Compose | v2 | Container orchestration |

### Third-party services (auto-started via `make dev-infra`)

| Service | Image | Default Port | Notes |
|---|---|---|---|
| PostgreSQL | `postgres:17-alpine` | 5432 | Requires databases `llm_dlp` and `keycloak` |
| Keycloak | `quay.io/keycloak/keycloak:26.6.3` | 8080 | Admin: `admin/admin`. Realm auto-imported on first start. |
| LiteLLM | `ghcr.io/berriai/litellm:v1.87.1` | 4000 | LLM gateway with DLP callbacks |
| MinIO | `quay.io/minio/minio:latest` | 9000 (API), 9001 (Console) | S3-compatible object storage for file attachments |

### Cloud-only services (already running on server)

| Service | Port | Notes |
|---|---|---|
| jc21/nginx-proxy-manager | 80, 443, 81 | Shared reverse proxy, `npm_default` network |

## Quick Start

All commands run from project root (`llm_api_dlp/`). Open a separate terminal for each `make dev-*` target — IDE sidebar (VSCode/JetBrains) handles this well.

### First-time setup

```bash
# 1. Create Python venv & install API deps
cd apps/api-server && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ../..

# 2. Install web deps
cd apps/web-client && pnpm install && cd ../..
```

### Start developing (need three new terminals for infra)

```bash
# Terminal 1 — Infrastructure (Postgres, Keycloak, LiteLLM)
make dev-infra

# Terminal 2 — API server (hot-reload, port 8000)
make dev-api

# Terminal 3 — Web client (HMR, port 5173)
make dev-web

# Terminal 1 or 4 — Run DB migrations, after that, for common use
make db-migrate
```

Then open **http://localhost:5173** in browser. Login redirects to Keycloak at `localhost:8080`.

## Services

| Service    | Port  | URL                          |
|------------|-------|------------------------------|
| Web Client | 5173  | http://localhost:5173        |
| API Server | 8000  | http://localhost:8000/docs   |
| LiteLLM    | 4000  | http://localhost:4000        |
| MinIO API  | 9000  | http://localhost:9000        |
| MinIO Console | 9001 | http://localhost:9001     |
| Keycloak   | 8080  | http://localhost:8080        |
| PostgreSQL | 5432  | localhost:5432               |

### One-time Keycloak setup after first login

Keycloak realm is auto-imported from `infra/keycloak/llm-dlp-realm.json` on first start. Default config includes:

- **Realm:** `llm-dlp`
- **Client:** `llm-dlp-web` (public OIDC, redirects to `http://localhost:5173/*`)
- **Test users:** See realm config

To add cloud domain redirect URIs after deployment, log into Keycloak admin console and update the `llm-dlp-web` client.

## Deployment (Cloud)

Target: `10.10.10.86`, user: `devuser`, path: `/home/devuser/projects/LLM_API/`

```bash
# First-time setup on server:
#   - Create infra/.env.cloud with production secrets
#   - Ensure jc21/nginx-proxy-manager is running with npm_default network

# Full deploy (api + web)
./deploy.sh

# Deploy only API server
./deploy_api.sh

# Deploy only web client
./deploy_web.sh
```

NPM proxy rule: `http` → `llm-dlp-web:80`

## Project Structure

```
llm_api_dlp/
├── apps/
│   ├── web-client/     # React + Vite + TailwindCSS + DaisyUI frontend
│   ├── api-server/     # FastAPI backend
│   │   └── app/
│   │       ├── api/         # REST endpoints (chat, files, keys, admin)
│   │       ├── db/models/   # SQLAlchemy ORM (User, Conversation, Message, Attachment, etc.)
│   │       ├── services/    # Business logic (DLP masking, MinIO storage, doc parsing)
│   │       └── schemas/     # Pydantic request/response models
│   └── dlp-plugin/     # LiteLLM DLP data masking hooks
├── infra/
│   ├── docker-compose.yml       # Local dev & build (postgres, keycloak, litellm, minio)
│   ├── docker-compose.cloud.yml # Cloud deployment (npm_default network)
│   ├── .env.cloud               # Cloud secrets (not in git)
│   ├── litellm/                 # LiteLLM model routing config
│   └── keycloak/                # Keycloak realm import config
├── deploy.sh                # Full cloud deploy
├── deploy_api.sh            # API-only cloud deploy
├── deploy_web.sh            # Web-only cloud deploy
├── Makefile                 # Dev & build commands
└── docs/                    # Architecture docs
```

## Makefile Commands

| Command | Description |
|---|---|
| `make dev-infra` | Start Postgres, Keycloak, LiteLLM, MinIO containers |
| `make dev-api` | Start FastAPI dev server (hot-reload, port 8000) |
| `make dev-web` | Start Vite dev server (HMR, port 5173) |
| `make build` | Build all Docker images locally |
| `make up` / `make down` | Start/stop all local containers |
| `make build-cloud` | Build images + export `infra/images.tar.gz` |
| `make push-cloud` | Build + scp + remote deploy (set `CLOUD_HOST`) |
| `make db-migrate` | Run Alembic migrations |
| `make test-api` / `make test-web` | Run tests |
| `make lint` | Lint all code |
| `make clean` | Tear down containers and remove artifacts |
