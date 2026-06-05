"""Main API router — mounts all sub-routers under /api/v1."""

from fastapi import APIRouter

from app.api import admin, auth, chat, keys

api_router = APIRouter(prefix="/api/v1")

# Mount sub-routers
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(chat.router, prefix="/chat", tags=["chat"])
api_router.include_router(keys.router, prefix="/keys", tags=["keys"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
