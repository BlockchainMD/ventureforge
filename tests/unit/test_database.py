"""Tests for database utilities."""

from __future__ import annotations

from ventureforge.core.database import _get_async_url


def test_sqlite_url_conversion():
    assert _get_async_url("sqlite:///./test.db") == "sqlite+aiosqlite:///./test.db"


def test_postgres_url_conversion():
    assert _get_async_url("postgresql://user:pass@localhost/db") == "postgresql+asyncpg://user:pass@localhost/db"


def test_unknown_url_passthrough():
    assert _get_async_url("mysql://localhost/db") == "mysql://localhost/db"
