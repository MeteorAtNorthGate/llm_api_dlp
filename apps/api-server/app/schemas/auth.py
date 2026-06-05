"""Auth schemas — request/response models for authentication."""

from pydantic import BaseModel


class UserInfo(BaseModel):
    """Authenticated user information returned to the frontend."""
    sub: str
    preferred_username: str | None = None
    email: str | None = None
    name: str | None = None
    department: str | None = None
    groups: list[str] = []


class TokenResponse(BaseModel):
    """Token response from Keycloak callback exchange."""
    access_token: str
    refresh_token: str | None = None
    expires_in: int
    token_type: str = "Bearer"


class AuthCallbackRequest(BaseModel):
    """Request body for the auth callback — Keycloak redirects with code."""
    code: str
    redirect_uri: str
    code_verifier: str = ""  # PKCE code verifier for public clients
