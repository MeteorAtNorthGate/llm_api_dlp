"""LDAP auth source admin endpoints — CRUD for domain controller configurations.

Only users in the 'admins' Keycloak group can access these endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_admin as _require_admin
from app.db.models.ldap_config import LdapAuthSource
from app.db.session import get_session

router = APIRouter()

AUTH_TYPES = [
    {"value": "bind_dn", "label": "LDAP (via BindDN)"},
    {"value": "principal", "label": "LDAP (via Principal)"},
    {"value": "anonymous", "label": "LDAP (Anonymous)"},
]

SECURITY_PROTOCOLS = [
    {"value": "unencrypted", "label": "Unencrypted"},
    {"value": "ldaps", "label": "LDAPS (SSL/TLS)"},
    {"value": "starttls", "label": "StartTLS"},
]


# ── Schemas ──────────────────────────────────────────────────────────────


class LdapSourceCreate(BaseModel):
    auth_type: str = Field(default="bind_dn", description="Auth type")
    name: str = Field(default="", description="Display name shown on login page")
    security_protocol: str = Field(default="unencrypted", description="Security protocol")
    host: str = Field(default="", description="Host address, e.g. mydomain.com")
    port: int = Field(default=389, description="Host port, e.g. 389, 636")
    bind_dn: str = Field(default="", description="Bind DN, e.g. cn=Search,dc=mydomain,dc=com")
    bind_password: str = Field(default="", description="Bind password (stored in plaintext)")
    user_search_base: str = Field(default="", description="User search base, e.g. ou=Users,dc=mydomain,dc=com")
    user_filter: str = Field(default="", description="User filter, e.g. (&(objectClass=posixAccount)(uid=%s))")
    admin_filter: str = Field(default="", description="Admin filter rule")
    username_attr: str = Field(default="", description="Username attribute (empty = use login username)")
    first_name_attr: str = Field(default="", description="First name attribute")
    last_name_attr: str = Field(default="", description="Last name attribute")
    email_attr: str = Field(default="", description="Email attribute, e.g. mail")
    enabled: bool = Field(default=True, description="Whether this source is enabled")


class LdapSourceUpdate(BaseModel):
    """Partial update — all fields optional."""
    auth_type: str | None = Field(default=None)
    name: str | None = Field(default=None)
    security_protocol: str | None = Field(default=None)
    host: str | None = Field(default=None)
    port: int | None = Field(default=None)
    bind_dn: str | None = Field(default=None)
    bind_password: str | None = Field(default=None)
    user_search_base: str | None = Field(default=None)
    user_filter: str | None = Field(default=None)
    admin_filter: str | None = Field(default=None)
    username_attr: str | None = Field(default=None)
    first_name_attr: str | None = Field(default=None)
    last_name_attr: str | None = Field(default=None)
    email_attr: str | None = Field(default=None)
    enabled: bool | None = Field(default=None)


class LdapSourceResponse(BaseModel):
    id: str
    auth_type: str
    name: str
    security_protocol: str
    host: str
    port: int
    bind_dn: str
    # bind_password is NOT returned in list/get responses for security
    bind_password_set: bool = False
    user_search_base: str
    user_filter: str
    admin_filter: str
    username_attr: str
    first_name_attr: str
    last_name_attr: str
    email_attr: str
    enabled: bool
    created_at: str | None = None
    updated_at: str | None = None

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_model(cls, source: LdapAuthSource) -> "LdapSourceResponse":
        return cls(
            id=str(source.id),
            auth_type=source.auth_type,
            name=source.name,
            security_protocol=source.security_protocol,
            host=source.host,
            port=source.port,
            bind_dn=source.bind_dn,
            bind_password_set=bool(source.bind_password),
            user_search_base=source.user_search_base,
            user_filter=source.user_filter,
            admin_filter=source.admin_filter,
            username_attr=source.username_attr,
            first_name_attr=source.first_name_attr,
            last_name_attr=source.last_name_attr,
            email_attr=source.email_attr,
            enabled=source.enabled,
            created_at=source.created_at.isoformat() if source.created_at else None,
            updated_at=source.updated_at.isoformat() if source.updated_at else None,
        )


class LdapSourceListResponse(BaseModel):
    sources: list[LdapSourceResponse]


# ── Endpoints ────────────────────────────────────────────────────────────


@router.get("/sources", response_model=LdapSourceListResponse)
async def list_sources(
    user: dict = Depends(_require_admin),
    session: AsyncSession = Depends(get_session),
):
    """List all LDAP auth sources (admin-only)."""
    result = await session.execute(
        select(LdapAuthSource).order_by(LdapAuthSource.created_at.desc())
    )
    sources = result.scalars().all()
    return LdapSourceListResponse(
        sources=[LdapSourceResponse.from_orm_model(s) for s in sources]
    )


@router.post("/sources", status_code=status.HTTP_201_CREATED)
async def create_source(
    body: LdapSourceCreate,
    user: dict = Depends(_require_admin),
    session: AsyncSession = Depends(get_session),
):
    """Add a new LDAP auth source (admin-only)."""
    source = LdapAuthSource(
        auth_type=body.auth_type,
        name=body.name,
        security_protocol=body.security_protocol,
        host=body.host,
        port=body.port,
        bind_dn=body.bind_dn,
        bind_password=body.bind_password,
        user_search_base=body.user_search_base,
        user_filter=body.user_filter,
        admin_filter=body.admin_filter,
        username_attr=body.username_attr,
        first_name_attr=body.first_name_attr,
        last_name_attr=body.last_name_attr,
        email_attr=body.email_attr,
        enabled=body.enabled,
    )
    session.add(source)
    await session.commit()
    await session.refresh(source)
    return LdapSourceResponse.from_orm_model(source)


@router.get("/sources/{source_id}", response_model=LdapSourceResponse)
async def get_source(
    source_id: str,
    user: dict = Depends(_require_admin),
    session: AsyncSession = Depends(get_session),
):
    """Get a single LDAP auth source by ID (admin-only)."""
    source = await session.get(LdapAuthSource, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="LDAP source not found")
    return LdapSourceResponse.from_orm_model(source)


@router.put("/sources/{source_id}", response_model=LdapSourceResponse)
async def update_source(
    source_id: str,
    body: LdapSourceUpdate,
    user: dict = Depends(_require_admin),
    session: AsyncSession = Depends(get_session),
):
    """Update an LDAP auth source (admin-only)."""
    source = await session.get(LdapAuthSource, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="LDAP source not found")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(source, key, value)

    await session.commit()
    await session.refresh(source)
    return LdapSourceResponse.from_orm_model(source)


@router.delete("/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source(
    source_id: str,
    user: dict = Depends(_require_admin),
    session: AsyncSession = Depends(get_session),
):
    """Delete an LDAP auth source (admin-only)."""
    source = await session.get(LdapAuthSource, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="LDAP source not found")
    await session.delete(source)
    await session.commit()
