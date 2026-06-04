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

    async with httpx.AsyncClient() as client:
        # Fetch OIDC config to get jwks_uri
        resp = await client.get(settings.keycloak_openid_config_url)
        resp.raise_for_status()
        oidc_config = resp.json()

        # Fetch JWKS
        jwks_resp = await client.get(oidc_config["jwks_uri"])
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
