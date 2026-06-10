"""FastAPI application entry point."""

import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── Default model definition ──────────────────────────────────────────
# This model is seeded into LiteLLM's database on first startup so it
# appears in the model list and can be edited / deleted via the admin UI.

DEFAULT_MODEL = {
    "model_name": "deepseek-v4-flash",
    "litellm_params": {
        "model": "deepseek/deepseek-v4-flash",
        "api_base": "https://api.deepseek.com",
        "rpm": 500,
        "tpm": 100000,
    },
    "model_info": {
        "description": "Default DeepSeek model — managed via admin UI",
    },
}


async def _seed_default_model(client: httpx.AsyncClient) -> None:
    """Ensure the default model exists in LiteLLM (idempotent)."""
    model_name = DEFAULT_MODEL["model_name"]

    # Check if the model already exists
    try:
        resp = await client.get(
            f"{settings.LITELLM_BASE_URL}/model/info",
            headers={"Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}"},
        )
        if resp.status_code == 200:
            data = resp.json()
            existing = {m.get("model_name") for m in data.get("data", [])}
            if model_name in existing:
                logger.info("Default model '%s' already exists — skipping seed.", model_name)
                return
    except Exception:
        logger.warning("Could not query LiteLLM models, will attempt create anyway.")

    # Create the default model
    try:
        litellm_params = dict(DEFAULT_MODEL["litellm_params"])
        litellm_params["api_key"] = settings.DEEPSEEK_API_KEY

        resp = await client.post(
            f"{settings.LITELLM_BASE_URL}/model/new",
            json={
                "model_name": model_name,
                "litellm_params": litellm_params,
                "model_info": DEFAULT_MODEL["model_info"],
            },
            headers={
                "Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}",
                "Content-Type": "application/json",
            },
        )
        if resp.status_code in (200, 201):
            logger.info("Default model '%s' seeded successfully.", model_name)
        else:
            logger.error(
                "Failed to seed default model '%s': %s %s",
                model_name,
                resp.status_code,
                resp.text,
            )
    except Exception:
        logger.exception("Failed to seed default model '%s'.", model_name)


async def _seed_with_retry(max_retries: int = 30, interval: int = 2) -> None:
    """Retry seeding until LiteLLM is reachable."""
    if not settings.DEEPSEEK_API_KEY:
        logger.info(
            "DEEPSEEK_API_KEY not set — skipping default model seed. "
            "Add a model manually via the System Admin page."
        )
        return

    async with httpx.AsyncClient(timeout=15.0) as client:
        for attempt in range(1, max_retries + 1):
            try:
                await _seed_default_model(client)
                return
            except httpx.ConnectError:
                logger.debug(
                    "LiteLLM not reachable (attempt %d/%d), retrying in %ds…",
                    attempt,
                    max_retries,
                    interval,
                )
                if attempt < max_retries:
                    await asyncio.sleep(interval)
        logger.warning(
            "LiteLLM still not reachable after %d attempts — default model was not seeded.",
            max_retries,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — startup and shutdown events."""
    # Startup: create tables if they don't exist (dev convenience)
    from app.db.session import engine
    from app.db.base import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Seed default model into LiteLLM DB (non-blocking — runs in background)
    asyncio.create_task(_seed_with_retry())

    yield

    # Shutdown: dispose engine
    await engine.dispose()


app = FastAPI(
    title="LLM Platform API",
    description="Enterprise AI Platform — Chat, DLP, and API Key Management",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Include API router
from app.api.router import api_router

app.include_router(api_router)

# Health check
@app.get("/health", tags=["health"])
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": "0.1.0"}
