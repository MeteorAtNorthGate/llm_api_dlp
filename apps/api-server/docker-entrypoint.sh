#!/bin/sh
# Container entrypoint: bring the database schema up to date, then serve.
#
# This used to be an inline CMD that began with an unconditional
# `alembic stamp 0001`.  That was wrong in two ways:
#
#   1. It rewound `alembic_version` to 0001 on *every* restart, so every later
#      migration replayed each time the container came up.  Only survivable
#      because 0002 happens to be written idempotently.
#   2. It could not bootstrap a brand-new database at all: stamping 0001 onto an
#      empty schema makes `upgrade head` skip 0001's CREATE TABLEs, so the very
#      first ALTER fails with `relation "messages" does not exist` and the
#      container never starts.
#
# So decide the starting revision by looking at the database instead:
#
#   already versioned      -> migrate from wherever it is
#   schema exists, but     -> adopt it at the baseline revision, then migrate
#   was never versioned       (the pre-alembic install this was written for)
#   empty database         -> migrate from scratch

set -e

STAMP_TO="$(
    python - <<'PY'
import asyncio
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

BASELINE = "0001"


async def detect() -> str:
    engine = create_async_engine(os.environ["DATABASE_URL"])
    try:
        async with engine.connect() as conn:
            versioned = await conn.scalar(
                text("SELECT to_regclass('public.alembic_version') IS NOT NULL")
            )
            if versioned and await conn.scalar(
                text("SELECT EXISTS (SELECT 1 FROM alembic_version)")
            ):
                return ""  # normal case — let alembic work it out
            has_schema = await conn.scalar(
                text("SELECT to_regclass('public.users') IS NOT NULL")
            )
            return BASELINE if has_schema else ""
    finally:
        await engine.dispose()


print(asyncio.run(detect()))
PY
)"

if [ -n "$STAMP_TO" ]; then
    echo "[entrypoint] schema present but unversioned — adopting it at $STAMP_TO"
    alembic stamp "$STAMP_TO"
fi

alembic upgrade head

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
