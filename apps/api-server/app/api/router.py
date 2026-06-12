"""Main API router — mounts all sub-routers under /api/v1."""

from fastapi import APIRouter

from app.api import admin, admin_ldap, auth, chat, files, keys, statistics

api_router = APIRouter(prefix="/api/v1")

# Mount sub-routers
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(chat.router, prefix="/chat", tags=["chat"])
api_router.include_router(keys.router, prefix="/keys", tags=["keys"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(admin_ldap.router, prefix="/admin/ldap", tags=["admin-ldap"])
api_router.include_router(files.router, prefix="/files", tags=["files"])
api_router.include_router(statistics.router, prefix="/stats", tags=["statistics"])
