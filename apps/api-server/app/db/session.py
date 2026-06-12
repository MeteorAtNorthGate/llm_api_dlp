"""Async database session and engine factory."""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.APP_LOG_LEVEL == "DEBUG",
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# Separate engine for the LiteLLM database (read-only queries on SpendLogs etc.)
litellm_engine = create_async_engine(
    settings.LITELLM_DATABASE_URL,
    echo=settings.APP_LOG_LEVEL == "DEBUG",
    pool_size=5,
    max_overflow=5,
    pool_pre_ping=True,
)

litellm_session_factory = async_sessionmaker(
    litellm_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_session() -> AsyncSession:
    """FastAPI dependency that yields an async database session."""
    async with async_session_factory() as session:
        try:
            yield session
        finally:
            await session.close()


async def get_litellm_session() -> AsyncSession:
    """FastAPI dependency that yields a LiteLLM database async session."""
    async with litellm_session_factory() as session:
        try:
            yield session
        finally:
            await session.close()
