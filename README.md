# llm_api_dlp — Enterprise AI Platform

Internal enterprise LLM service portal providing a ChatGPT-like chat interface and developer API key self-service, with enterprise SSO (Keycloak/LDAP) and DLP data masking via LiteLLM hooks.

## Architecture

```
Browser → React (Vite) → FastAPI → LiteLLM Proxy (DLP) → External LLMs
                   ↓                    ↓
              Keycloak (OIDC)      PostgreSQL
```

## Quick Start

```bash
# 1. Start infrastructure (Postgres, Keycloak, LiteLLM)
make dev-infra

# 2. Install dependencies
cd apps/api-server && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
cd apps/web-client && pnpm install

# 3. Run migrations
make db-migrate

# 4. Start dev servers
make dev
```

## Services

| Service    | Port  | URL                          |
|------------|-------|------------------------------|
| Web Client | 5173  | http://localhost:5173        |
| API Server | 8000  | http://localhost:8000/docs   |
| LiteLLM    | 4000  | http://localhost:4000        |
| Keycloak   | 8080  | http://localhost:8080        |
| PostgreSQL | 5432  | localhost:5432               |

## Project Structure

```
llm_api_dlp/
├── apps/
│   ├── web-client/     # React + Vite + TailwindCSS frontend
│   ├── api-server/     # FastAPI backend
│   └── dlp-plugin/     # LiteLLM DLP data masking hooks
├── infra/
│   ├── docker-compose.yml
│   ├── litellm/        # LiteLLM model routing config
│   └── keycloak/       # Keycloak realm config
└── docs/               # Architecture docs
```
