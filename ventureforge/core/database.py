"""Database setup and session management."""

from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from ventureforge.core.config import get_settings
from ventureforge.core.models import Base

_engine = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def _get_async_url(url: str) -> str:
    """Convert a sync database URL to async."""
    if url.startswith("sqlite:///"):
        return url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


def get_engine(url: str | None = None):
    """Get or create the async engine."""
    global _engine  # noqa: PLW0603
    if _engine is None:
        db_url = url or get_settings().database_url
        async_url = _get_async_url(db_url)
        _engine = create_async_engine(async_url, echo=False)

        if "sqlite" in async_url:

            @event.listens_for(_engine.sync_engine, "connect")
            def _set_sqlite_pragma(dbapi_conn, _connection_record):
                cursor = dbapi_conn.cursor()
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()

    return _engine


def get_session_factory(url: str | None = None) -> async_sessionmaker[AsyncSession]:
    """Get or create the session factory."""
    global _session_factory  # noqa: PLW0603
    if _session_factory is None:
        engine = get_engine(url)
        _session_factory = async_sessionmaker(engine, expire_on_commit=False)
    return _session_factory


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield a database session (for FastAPI dependency injection)."""
    factory = get_session_factory()
    async with factory() as session:
        yield session


async def init_db(url: str | None = None) -> None:
    """Create all tables."""
    engine = get_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db() -> None:
    """Close the engine connection pool."""
    global _engine, _session_factory  # noqa: PLW0603
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
