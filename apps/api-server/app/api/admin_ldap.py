"""LDAP auth source admin endpoints — proxies Keycloak Admin REST API.

These endpoints manage Keycloak's LDAP User Storage Provider components.
Only users in the 'admins' Keycloak group can access them.

The API accepts a minimal set of fields and lets Keycloak fill in sensible
defaults for everything else (vendor=ad, authType=simple, editMode=READ_ONLY,
importEnabled=true, etc.).
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.security import require_admin as _require_admin

router = APIRouter()

# ── Constants ───────────────────────────────────────────────────────────

KC_BASE = settings.KEYCLOAK_URL.rstrip("/")
KC_REALM = settings.KEYCLOAK_REALM
KC_ADMIN_URL = f"{KC_BASE}/admin/realms/{KC_REALM}"
LDAP_PROVIDER_TYPE = "org.keycloak.storage.UserStorageProvider"


# ── Keycloak admin token helper ─────────────────────────────────────────

async def _get_kc_token() -> str:
    """Obtain a Keycloak admin access token."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{KC_BASE}/realms/master/protocol/openid-connect/token",
            data={
                "grant_type": "password",
                "client_id": "admin-cli",
                "username": settings.KEYCLOAK_ADMIN,
                "password": settings.KEYCLOAK_ADMIN_PASSWORD,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Keycloak admin authentication failed: {resp.text}",
            )
        return resp.json()["access_token"]


# ── Conversion helpers ──────────────────────────────────────────────────

def _kc_to_form(comp: dict) -> dict:
    """Convert Keycloak component → form-friendly dict."""
    cfg = {k: (v[0] if v else "") for k, v in comp.get("config", {}).items()}

    # Parse connectionUrl back to host / port
    conn = cfg.get("connectionUrl", "")
    host = ""
    port = 389
    if conn:
        prefix = "ldaps://" if conn.startswith("ldaps://") else "ldap://"
        rest = conn[len(prefix):] if conn.startswith(prefix) else conn
        if ":" in rest:
            host, port_str = rest.rsplit(":", 1)
            try:
                port = int(port_str)
            except ValueError:
                port = 389
        else:
            host = rest

    return {
        "id": comp["id"],
        "name": comp.get("name", ""),
        "host": host,
        "port": port,
        "bind_dn": cfg.get("bindDn", ""),
        "bind_password_set": bool(cfg.get("bindCredential", "")),
        "users_dn": cfg.get("usersDn", ""),
        "username_attr": cfg.get("usernameLDAPAttribute", "sAMAccountName"),
        "rdn_attr": cfg.get("rdnLDAPAttribute", "sAMAccountName"),
        "uuid_attr": cfg.get("uuidLDAPAttribute", "objectGUID"),
        "enabled": cfg.get("enabled", "true") == "true",
    }


def _form_to_kc(body: dict) -> dict:
    """Build minimal Keycloak LDAP component payload from form data.

    Only emits the essential fields — Keycloak fills the rest with defaults.
    """
    host = body.get("host", "")
    port = body.get("port", 389)

    # Build connection URL
    if port == 636:
        connection_url = f"ldaps://{host}:636"
    else:
        connection_url = f"ldap://{host}" if port == 389 else f"ldap://{host}:{port}"

    return {
        # ── Core connectivity ──
        "vendor": ["ad"],
        "connectionUrl": [connection_url],
        "bindDn": [body.get("bind_dn", "")],
        "bindCredential": [body.get("bind_password", "")],

        # ── User search ──
        "usersDn": [body.get("users_dn", "")],
        "usernameLDAPAttribute": [body.get("username_attr", "sAMAccountName")],
        "rdnLDAPAttribute": [body.get("rdn_attr", "sAMAccountName")],
        "uuidLDAPAttribute": [body.get("uuid_attr", "objectGUID")],
        "userObjectClasses": ["person,organizationalPerson,user"],

        # ── Safety & defaults ──
        "enabled": [str(body.get("enabled", True)).lower()],
        "editMode": ["READ_ONLY"],
        "importEnabled": ["true"],
        "authType": ["simple"],
    }


# ── Schemas ──────────────────────────────────────────────────────────────

class LdapSourceCreate(BaseModel):
    """Minimal fields — the rest is filled by Keycloak defaults."""
    name: str = Field(default="", description="Display name, e.g. 公司内部AD域")
    host: str = Field(default="", description="AD host IP, e.g. 10.0.0.5")
    port: int = Field(default=389, description="LDAP port: 389 or 636")
    bind_dn: str = Field(default="", description="Bind DN of the read-only service account")
    bind_password: str = Field(default="", description="Password for the bind account")
    users_dn: str = Field(default="", description="User search base DN")
    username_attr: str = Field(default="sAMAccountName", description="AD username attribute")
    rdn_attr: str = Field(default="sAMAccountName", description="AD RDN attribute")
    uuid_attr: str = Field(default="objectGUID", description="AD UUID attribute")
    enabled: bool = Field(default=True)


class LdapSourceUpdate(BaseModel):
    """Partial update — all fields optional."""
    name: str | None = None
    host: str | None = None
    port: int | None = None
    bind_dn: str | None = None
    bind_password: str | None = None
    users_dn: str | None = None
    username_attr: str | None = None
    rdn_attr: str | None = None
    uuid_attr: str | None = None
    enabled: bool | None = None


class LdapSourceResponse(BaseModel):
    id: str
    name: str
    host: str
    port: int
    bind_dn: str
    bind_password_set: bool = False
    users_dn: str
    username_attr: str
    rdn_attr: str
    uuid_attr: str
    enabled: bool


class LdapSourceListResponse(BaseModel):
    sources: list[LdapSourceResponse]


# ── Endpoints ────────────────────────────────────────────────────────────

@router.get("/sources", response_model=LdapSourceListResponse)
async def list_sources(user: dict = Depends(_require_admin)):
    """List all LDAP User Storage Providers from Keycloak."""
    token = await _get_kc_token()
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{KC_ADMIN_URL}/components?type={LDAP_PROVIDER_TYPE}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Keycloak component list failed: {resp.text}",
            )

    sources = [LdapSourceResponse(**_kc_to_form(c)) for c in resp.json()]
    return LdapSourceListResponse(sources=sources)


@router.post("/sources", status_code=status.HTTP_201_CREATED)
async def create_source(
    body: LdapSourceCreate,
    user: dict = Depends(_require_admin),
):
    """Create a new LDAP User Storage Provider in Keycloak."""
    token = await _get_kc_token()
    config = _form_to_kc(body.model_dump())

    payload = {
        "name": body.name or "ldap-source",
        "providerId": "ldap",
        "providerType": LDAP_PROVIDER_TYPE,
        "parentId": KC_REALM,
        "config": config,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{KC_ADMIN_URL}/components",
            json=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Keycloak LDAP creation failed: {resp.text}",
            )

        # Keycloak may return 201 with an empty body; extract id from
        # Location header (e.g. .../components/<uuid>) and fetch the new
        # component.  Fall back to the response body when it is present.
        if resp.content:
            created = resp.json()
        else:
            loc = resp.headers.get("Location", "")
            comp_id = loc.rstrip("/").rsplit("/", 1)[-1] if loc else ""
            if not comp_id:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Keycloak LDAP creation returned empty body and no Location header",
                )
            get_resp = await client.get(
                f"{KC_ADMIN_URL}/components/{comp_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            if get_resp.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Keycloak LDAP created but fetch failed: {get_resp.text}",
                )
            created = get_resp.json()

    return LdapSourceResponse(**_kc_to_form(created))


@router.get("/sources/{source_id}", response_model=LdapSourceResponse)
async def get_source(
    source_id: str,
    user: dict = Depends(_require_admin),
):
    """Get a single LDAP provider from Keycloak."""
    token = await _get_kc_token()
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            f"{KC_ADMIN_URL}/components/{source_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="LDAP source not found")
        if resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Keycloak component get failed: {resp.text}",
            )

    return LdapSourceResponse(**_kc_to_form(resp.json()))


@router.put("/sources/{source_id}", response_model=LdapSourceResponse)
async def update_source(
    source_id: str,
    body: LdapSourceUpdate,
    user: dict = Depends(_require_admin),
):
    """Update an LDAP User Storage Provider in Keycloak."""
    token = await _get_kc_token()

    async with httpx.AsyncClient(timeout=15.0) as client:
        # Fetch existing
        get_resp = await client.get(
            f"{KC_ADMIN_URL}/components/{source_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if get_resp.status_code == 404:
            raise HTTPException(status_code=404, detail="LDAP source not found")
        if get_resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Keycloak component get failed: {get_resp.text}",
            )
        existing = get_resp.json()

    # Merge update into existing
    update_data = body.model_dump(exclude_unset=True)
    merged = _kc_to_form(existing)
    for key, value in update_data.items():
        if key == "bind_password" and not value:
            continue
        merged[key] = value

    config = _form_to_kc(merged)

    # Preserve password when not changed
    if not update_data.get("bind_password"):
        config["bindCredential"] = existing.get("config", {}).get("bindCredential", [""])

    new_name = update_data.get("name", existing.get("name", ""))

    payload = {
        "name": new_name,
        "providerId": "ldap",
        "providerType": LDAP_PROVIDER_TYPE,
        "parentId": KC_REALM,
        "config": config,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.put(
            f"{KC_ADMIN_URL}/components/{source_id}",
            json=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )
        if resp.status_code not in (200, 204):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Keycloak LDAP update failed: {resp.text}",
            )

        # Fetch updated
        get_resp2 = await client.get(
            f"{KC_ADMIN_URL}/components/{source_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        updated = get_resp2.json() if get_resp2.status_code == 200 else {"id": source_id, "config": config}

    return LdapSourceResponse(**_kc_to_form(updated))


@router.post("/sources/{source_id}/sync")
async def sync_source(
    source_id: str,
    user: dict = Depends(_require_admin),
):
    """Trigger a full LDAP user sync for this provider in Keycloak."""
    token = await _get_kc_token()
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{KC_ADMIN_URL}/user-storage/{source_id}/sync?action=triggerFullSync",
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code not in (200, 204):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Keycloak sync trigger failed: {resp.text}",
            )
    return {"status": "sync_triggered", "source_id": source_id}


@router.delete("/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source(
    source_id: str,
    user: dict = Depends(_require_admin),
):
    """Delete an LDAP User Storage Provider from Keycloak."""
    token = await _get_kc_token()
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.delete(
            f"{KC_ADMIN_URL}/components/{source_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="LDAP source not found")
        if resp.status_code not in (200, 204):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Keycloak LDAP deletion failed: {resp.text}",
            )
