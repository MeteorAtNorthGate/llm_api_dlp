"""JWT verification and OIDC security helpers."""

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from jose.exceptions import ExpiredSignatureError

from app.core.config import settings

# JWKS cache
_jwks: dict | None = None


async def _fetch_jwks() -> dict:
    """Fetch JWKS from Keycloak, cached in memory."""
    global _jwks
    if _jwks is not None:
        return _jwks

    import httpx
    from urllib.parse import urlparse

    async with httpx.AsyncClient() as client:
        # Fetch OIDC config to get jwks_uri path
        resp = await client.get(settings.keycloak_openid_config_url)
        resp.raise_for_status()
        oidc_config = resp.json()

        # Rewrite jwks_uri hostname to match KEYCLOAK_URL so it works inside
        # Docker (where Keycloak may report itself as "localhost" but the
        # api-server container needs to reach it via the "keycloak" hostname).
        jwks_uri = oidc_config["jwks_uri"]
        parsed = urlparse(jwks_uri)
        base = urlparse(settings.KEYCLOAK_URL)
        if parsed.hostname != base.hostname:
            jwks_uri = parsed._replace(netloc=f"{base.hostname}:{base.port}").geturl()

        # Fetch JWKS
        jwks_resp = await client.get(jwks_uri)
        jwks_resp.raise_for_status()
        _jwks = jwks_resp.json()

    return _jwks


async def verify_jwt(token: str) -> dict:
    """Verify a JWT token against Keycloak and return the claims."""
    try:
        jwks = await _fetch_jwks()

        # Decode without verification first to extract kid
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")

        # Find the matching key
        key = None
        for jwk in jwks.get("keys", []):
            if jwk.get("kid") == kid:
                key = jwk
                break

        if key is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="No matching JWK found",
            )

        # Build the public key from JWK
        from jose import constants
        from jose.jwk import construct

        public_key = construct(key, algorithm=key.get("alg", "RS256"))

        # Verify the token
        claims = jwt.decode(
            token,
            public_key.to_pem(),
            algorithms=[key.get("alg", "RS256")],
            audience=settings.KEYCLOAK_CLIENT_ID,
            options={"verify_exp": True, "verify_aud": False},
        )

        return claims

    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )


security_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security_scheme),
) -> dict:
    """Dependency that extracts and validates the current user from JWT."""
    if credentials is None:
        # Try to get token from cookie as fallback
        token = request.cookies.get("access_token")
        if token is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
            )
    else:
        token = credentials.credentials

    claims = await verify_jwt(token)
    return claims


async def get_optional_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security_scheme),
) -> dict | None:
    """Dependency that optionally extracts the current user (no error if missing)."""
    try:
        return await get_current_user(request, credentials)
    except HTTPException:
        return None


def is_admin(user_claims: dict) -> bool:
    """Check if the user belongs to the 'admins' group."""
    groups = user_claims.get("groups", [])
    return "admins" in groups


def require_admin(user_claims: dict = Depends(get_current_user)) -> dict:
    """Dependency — raises 403 if user is not an admin."""
    if not is_admin(user_claims):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only system administrators can access this endpoint",
        )
    return user_claims
