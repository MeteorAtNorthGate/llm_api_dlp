"""Auth endpoints — Keycloak OIDC callback and user info."""

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.config import settings
from app.core.security import get_current_user
from app.schemas.auth import AuthCallbackRequest, TokenResponse, UserInfo

router = APIRouter()


@router.get("/me", response_model=UserInfo)
async def get_me(user: dict = Depends(get_current_user)):
    """Return the current authenticated user's profile."""
    return UserInfo(
        sub=user.get("sub", ""),
        preferred_username=user.get("preferred_username"),
        email=user.get("email"),
        name=user.get("name"),
        department=user.get("department"),
        groups=user.get("groups", []),
        auth_source=user.get("auth_source", ""),
    )


@router.post("/callback", response_model=TokenResponse)
async def auth_callback(body: AuthCallbackRequest):
    """Exchange Keycloak authorization code for tokens."""
    token_url = (
        f"{settings.KEYCLOAK_URL}/realms/{settings.KEYCLOAK_REALM}"
        f"/protocol/openid-connect/token"
    )

    async with httpx.AsyncClient() as client:
        form_data = {
            "grant_type": "authorization_code",
            "code": body.code,
            "redirect_uri": body.redirect_uri,
            "client_id": body.client_id,
            "client_secret": settings.KEYCLOAK_CLIENT_SECRET,
        }
        # Include PKCE code_verifier for public clients
        if body.code_verifier:
            form_data["code_verifier"] = body.code_verifier

        resp = await client.post(
            token_url,
            data=form_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

        if resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Token exchange failed: {resp.text}",
            )

        data = resp.json()
        return TokenResponse(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token"),
            id_token=data.get("id_token"),
            expires_in=data.get("expires_in", 3600),
            token_type=data.get("token_type", "Bearer"),
        )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(refresh_token: str):
    """Refresh an expired access token."""
    token_url = (
        f"{settings.KEYCLOAK_URL}/realms/{settings.KEYCLOAK_REALM}"
        f"/protocol/openid-connect/token"
    )

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            token_url,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": settings.KEYCLOAK_CLIENT_ID,
                "client_secret": settings.KEYCLOAK_CLIENT_SECRET,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

        if resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token refresh failed",
            )

        data = resp.json()
        return TokenResponse(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token"),
            expires_in=data.get("expires_in", 3600),
            token_type=data.get("token_type", "Bearer"),
        )
