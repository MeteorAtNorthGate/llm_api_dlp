"""LDAP auth source admin endpoints — proxies Keycloak Admin REST API.

These endpoints manage Keycloak's LDAP User Storage Provider components
and their associated user-attribute mappers.  Only users in the 'admins'
Keycloak group can access them.
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
MAPPER_TYPE = "org.keycloak.storage.ldap.mappers.LDAPStorageMapper"

VENDORS = [
    {"value": "ad", "label": "Active Directory"},
    {"value": "rhds", "label": "Red Hat Directory Server"},
    {"value": "tivoli", "label": "IBM Tivoli Directory"},
    {"value": "other", "label": "Other (OpenLDAP / Generic)"},
]

AUTH_TYPES = [
    {"value": "simple", "label": "LDAP (via BindDN)"},
    {"value": "anonymous", "label": "LDAP (Anonymous)"},
]


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


# ── Schema helpers ──────────────────────────────────────────────────────

def _ldap_config_to_form(comp: dict) -> dict:
    """Convert a Keycloak LDAP component back to our form-friendly shape."""
    cfg = {k: (v[0] if v else "") for k, v in comp.get("config", {}).items()}

    # Parse connectionUrl → host + port + protocol
    conn = cfg.get("connectionUrl", "")
    security_protocol = "unencrypted"
    host = ""
    port = 389
    if conn:
        if conn.startswith("ldaps://"):
            security_protocol = "ldaps"
            rest = conn[len("ldaps://"):]
            port = 636
        elif conn.startswith("ldap://"):
            security_protocol = "unencrypted"
            rest = conn[len("ldap://"):]
        else:
            rest = conn
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
        "vendor": cfg.get("vendor", "ad"),
        "auth_type": cfg.get("authType", "simple"),
        "security_protocol": security_protocol,
        "host": host,
        "port": port,
        "bind_dn": cfg.get("bindDn", ""),
        "bind_password_set": bool(cfg.get("bindCredential", "")),
        "user_search_base": cfg.get("usersDn", ""),
        "user_filter": cfg.get("customUserSearchFilter", ""),
        "username_attr": cfg.get("usernameLDAPAttribute", ""),
        "rdn_attr": cfg.get("rdnLDAPAttribute", ""),
        "uuid_attr": cfg.get("uuidLDAPAttribute", ""),
        "enabled": cfg.get("enabled", "true") == "true",
        # Mapper attributes — fetched from child mappers
        "first_name_attr": "",
        "last_name_attr": "",
        "email_attr": "",
    }


def _form_to_ldap_config(body: dict) -> dict:
    """Build Keycloak LDAP component config from our form payload.

    All Keycloak config values must be lists of strings.
    """
    protocol = body.get("security_protocol", "unencrypted")
    host = body.get("host", "")
    port = body.get("port", 389)

    if protocol == "ldaps":
        connection_url = f"ldaps://{host}:{port}" if port != 636 else f"ldaps://{host}"
    else:
        connection_url = f"ldap://{host}:{port}" if port != 389 else f"ldap://{host}"

    config = {
        "enabled": [str(body.get("enabled", True)).lower()],
        "priority": ["1"],
        "editMode": ["READ_ONLY"],
        "syncRegistrations": ["false"],
        "vendor": [body.get("vendor", "ad")],
        "usernameLDAPAttribute": [body.get("username_attr", "")],
        "rdnLDAPAttribute": [body.get("rdn_attr", "")],
        "uuidLDAPAttribute": [body.get("uuid_attr", "")],
        "userObjectClasses": ["person,organizationalPerson,user"],
        "connectionUrl": [connection_url],
        "usersDn": [body.get("user_search_base", "")],
        "bindDn": [body.get("bind_dn", "")],
        "bindCredential": [body.get("bind_password", "")],
        "authType": [body.get("auth_type", "simple")],
        "searchScope": ["1"],
        "useTruststoreSpi": ["false"],
        "connectionPooling": ["true"],
        "importEnabled": ["true"],
        "cachePolicy": ["DEFAULT"],
        "fullSyncPeriod": ["86400"],
        "changedSyncPeriod": ["3600"],
        "batchSizeForSync": ["1000"],
    }

    # Custom LDAP filter (optional)
    user_filter = body.get("user_filter", "")
    if user_filter:
        config["customUserSearchFilter"] = [user_filter]

    return config


# ── Mapper helpers ──────────────────────────────────────────────────────

async def _sync_mappers(
    token: str,
    parent_id: str,
    body: dict,
):
    """Create or update user-attribute mappers for firstName / lastName / email.

    These are separate components in Keycloak that reference the parent
    LDAP provider.  We remove existing mappers of the same type and
    re-create them when attribute names are specified.
    """
    attr_map = {
        "first_name_attr": ("givenName", "firstName", "First name"),
        "last_name_attr": ("sn", "lastName", "Last name"),
        "email_attr": ("mail", "email", "Email"),
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        # List existing mappers for this parent
        existing_resp = await client.get(
            f"{KC_ADMIN_URL}/components?parent={parent_id}&type={MAPPER_TYPE}",
            headers={"Authorization": f"Bearer {token}"},
        )
        existing_mappers = existing_resp.json() if existing_resp.status_code == 200 else []

        for field, (default_attr, mapper_name, label) in attr_map.items():
            attr_value = body.get(field, "")

            # Delete existing mapper of this type
            for m in existing_mappers:
                if m.get("name") == mapper_name:
                    await client.delete(
                        f"{KC_ADMIN_URL}/components/{m['id']}",
                        headers={"Authorization": f"Bearer {token}"},
                    )

            # Create new mapper if attribute is specified
            if attr_value:
                mapper_payload = {
                    "name": mapper_name,
                    "providerId": "user-attribute-ldap-mapper",
                    "providerType": MAPPER_TYPE,
                    "parentId": parent_id,
                    "config": {
                        "ldap.attribute": [attr_value],
                        "user.model.attribute": [mapper_name],
                        "is.mandatory": ["false"],
                        "read.only": ["true"],
                        "always.read.value.from.ldap": ["true"],
                    },
                }
                await client.post(
                    f"{KC_ADMIN_URL}/components",
                    json=mapper_payload,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                    },
                )


async def _enrich_mapper_attrs(token: str, comp: dict) -> dict:
    """Fetch child mappers and populate firstName/lastName/email attrs."""
    mappers_resp = None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{KC_ADMIN_URL}/components?parent={comp['id']}&type={MAPPER_TYPE}",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 200:
                mappers_resp = resp.json()
    except Exception:
        pass

    if mappers_resp:
        for m in mappers_resp:
            cfg = m.get("config", {})
            name = m.get("name", "")
            ldap_attr = (cfg.get("ldap.attribute") or [""])[0]
            if name == "firstName" and ldap_attr:
                comp["first_name_attr"] = ldap_attr
            elif name == "lastName" and ldap_attr:
                comp["last_name_attr"] = ldap_attr
            elif name == "email" and ldap_attr:
                comp["email_attr"] = ldap_attr

    return comp


# ── Schemas ──────────────────────────────────────────────────────────────

class LdapSourceCreate(BaseModel):
    name: str = Field(default="", description="Display name for this LDAP source")
    vendor: str = Field(default="ad", description="LDAP vendor: ad, rhds, tivoli, other")
    auth_type: str = Field(default="simple", description="Auth type: simple, anonymous")
    security_protocol: str = Field(default="unencrypted", description="unencrypted, ldaps, starttls")
    host: str = Field(default="", description="Host address, e.g. mydomain.com")
    port: int = Field(default=389, description="Host port, e.g. 389, 636")
    bind_dn: str = Field(default="", description="Bind DN")
    bind_password: str = Field(default="", description="Bind password")
    user_search_base: str = Field(default="", description="User search base DN")
    user_filter: str = Field(default="", description="Custom LDAP user filter")
    username_attr: str = Field(default="", description="Username LDAP attribute")
    rdn_attr: str = Field(default="", description="RDN LDAP attribute")
    uuid_attr: str = Field(default="", description="UUID LDAP attribute")
    first_name_attr: str = Field(default="", description="First name LDAP attribute (creates mapper if set)")
    last_name_attr: str = Field(default="", description="Last name LDAP attribute (creates mapper if set)")
    email_attr: str = Field(default="", description="Email LDAP attribute (creates mapper if set)")
    enabled: bool = Field(default=True)


class LdapSourceUpdate(BaseModel):
    name: str | None = None
    vendor: str | None = None
    auth_type: str | None = None
    security_protocol: str | None = None
    host: str | None = None
    port: int | None = None
    bind_dn: str | None = None
    bind_password: str | None = None
    user_search_base: str | None = None
    user_filter: str | None = None
    username_attr: str | None = None
    rdn_attr: str | None = None
    uuid_attr: str | None = None
    first_name_attr: str | None = None
    last_name_attr: str | None = None
    email_attr: str | None = None
    enabled: bool | None = None


class LdapSourceResponse(BaseModel):
    id: str
    name: str
    vendor: str
    auth_type: str
    security_protocol: str
    host: str
    port: int
    bind_dn: str
    bind_password_set: bool = False
    user_search_base: str
    user_filter: str
    username_attr: str
    rdn_attr: str
    uuid_attr: str
    first_name_attr: str
    last_name_attr: str
    email_attr: str
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

    components = resp.json()
    sources = []
    for comp in components:
        source = _ldap_config_to_form(comp)
        # Enrich with mapper attributes
        try:
            source = await _enrich_mapper_attrs(token, source)
        except Exception:
            pass
        sources.append(LdapSourceResponse(**source))

    return LdapSourceListResponse(sources=sources)


@router.post("/sources", status_code=status.HTTP_201_CREATED)
async def create_source(
    body: LdapSourceCreate,
    user: dict = Depends(_require_admin),
):
    """Create a new LDAP User Storage Provider in Keycloak."""
    token = await _get_kc_token()
    config = _form_to_ldap_config(body.model_dump())

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

        created = resp.json()
        # Create attribute mappers if needed
        await _sync_mappers(token, created.get("id", ""), body.model_dump())

    # Return the newly created source
    source = _ldap_config_to_form(created)
    return LdapSourceResponse(**source)


@router.get("/sources/{source_id}", response_model=LdapSourceResponse)
async def get_source(
    source_id: str,
    user: dict = Depends(_require_admin),
):
    """Get a single LDAP provider by ID from Keycloak."""
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
        comp = resp.json()

    source = _ldap_config_to_form(comp)
    source = await _enrich_mapper_attrs(token, source)
    return LdapSourceResponse(**source)


@router.put("/sources/{source_id}", response_model=LdapSourceResponse)
async def update_source(
    source_id: str,
    body: LdapSourceUpdate,
    user: dict = Depends(_require_admin),
):
    """Update an LDAP User Storage Provider in Keycloak."""
    token = await _get_kc_token()

    # Fetch existing component first
    async with httpx.AsyncClient(timeout=15.0) as client:
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

    # Merge form data into existing config
    update_data = body.model_dump(exclude_unset=True)
    merged = _ldap_config_to_form(existing)

    for key, value in update_data.items():
        if key in ("bind_password",) and not value:
            continue  # Keep existing password when empty
        merged[key] = value

    # Rebuild Keycloak config from merged data
    new_config = _form_to_ldap_config(merged)

    # Preserve bind credential if password was not changed
    if not update_data.get("bind_password"):
        new_config["bindCredential"] = existing.get("config", {}).get("bindCredential", [""])

    # Preserve existing component name if not changed
    new_name = update_data.get("name", existing.get("name", ""))

    payload = {
        "name": new_name,
        "providerId": "ldap",
        "providerType": LDAP_PROVIDER_TYPE,
        "parentId": KC_REALM,
        "config": new_config,
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

        # Sync attribute mappers
        await _sync_mappers(token, source_id, merged)

        # Fetch updated component
        get_resp2 = await client.get(
            f"{KC_ADMIN_URL}/components/{source_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if get_resp2.status_code != 200:
            updated = {"id": source_id, "config": new_config}
        else:
            updated = get_resp2.json()

    source = _ldap_config_to_form(updated)
    source = await _enrich_mapper_attrs(token, source)
    return LdapSourceResponse(**source)


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
    """Delete an LDAP User Storage Provider from Keycloak.

    Also deletes any child mapper components.
    """
    token = await _get_kc_token()
    async with httpx.AsyncClient(timeout=15.0) as client:
        # Delete child mappers first
        mappers_resp = await client.get(
            f"{KC_ADMIN_URL}/components?parent={source_id}&type={MAPPER_TYPE}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if mappers_resp.status_code == 200:
            for m in mappers_resp.json():
                await client.delete(
                    f"{KC_ADMIN_URL}/components/{m['id']}",
                    headers={"Authorization": f"Bearer {token}"},
                )

        # Delete the LDAP provider itself
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
