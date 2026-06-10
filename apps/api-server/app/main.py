"""FastAPI application entry point."""

import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings

# Apply APP_LOG_LEVEL to the entire app package so that info/debug
# messages (e.g. default model seeding) are visible at startup.
logging.getLogger("app").setLevel(settings.APP_LOG_LEVEL.upper())

logger = logging.getLogger(__name__)

# ── System utility model ───────────────────────────────────────────────
# Seeded on first startup.  Used by the platform for lightweight tasks
# (e.g. conversation title generation from first user message).
#
# It CANNOT be deleted via the admin UI — the delete endpoint checks
# against SYSTEM_UTILITY_MODEL_NAME.  Admins should edit it to set the
# API key and optionally switch provider / model.

SYSTEM_UTILITY_MODEL_NAME = "system-utility"

DEFAULT_MODEL = {
    "model_name": SYSTEM_UTILITY_MODEL_NAME,
    "litellm_params": {
        "model": "deepseek/deepseek-v4-flash",
        "api_base": "https://api.deepseek.com",
        "rpm": 500,
        "tpm": 100000,
    },
    "model_info": {
        "description": "System utility model — used for title generation and other lightweight tasks",
        "is_default": True,
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

    # Create the default model (api_key may be empty — admin fills it via UI)
    try:
        litellm_params = dict(DEFAULT_MODEL["litellm_params"])
        litellm_params["api_key"] = settings.DEEPSEEK_API_KEY or ""

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
    """Retry seeding until LiteLLM is reachable.

    The default model is always created (with an empty api_key if
    DEEPSEEK_API_KEY is not configured).  The admin fills in the key
    later via the System Admin page.
    """
    if not settings.DEEPSEEK_API_KEY:
        logger.info(
            "DEEPSEEK_API_KEY not set — default model will be seeded "
            "with an empty api_key. Edit it via the System Admin page."
        )

    async with httpx.AsyncClient(timeout=15.0) as client:
        for attempt in range(1, max_retries + 1):
            try:
                await _seed_default_model(client)
                return
            except httpx.RequestError as exc:
                # Network-level error (ConnectError, ReadError, TimeoutException,
                # RemoteProtocolError, etc.) — LiteLLM may not be ready yet.
                logger.debug(
                    "LiteLLM not reachable (attempt %d/%d, %s), retrying in %ds…",
                    attempt,
                    max_retries,
                    type(exc).__name__,
                    interval,
                )
                if attempt < max_retries:
                    await asyncio.sleep(interval)
            except Exception as exc:
                # Truly unexpected error — log and don't retry
                logger.warning(
                    "Unexpected error seeding default model (attempt %d/%d): %s",
                    attempt,
                    max_retries,
                    exc,
                )
                return
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
    seed_task = asyncio.create_task(_seed_with_retry())

    yield

    # Shutdown: cancel pending seed task, then dispose engine
    if not seed_task.done():
        seed_task.cancel()
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
