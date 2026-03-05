"""Shared test fixtures and configuration."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from ventureforge.core.models import Base


@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for the test session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Create an in-memory SQLite session for testing."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session

    await engine.dispose()


@pytest.fixture
def sample_opportunity() -> dict:
    """Load sample opportunity fixture."""
    path = Path(__file__).parent / "fixtures" / "sample_opportunity.json"
    with open(path) as f:
        return json.load(f)


@pytest.fixture
def sample_run_state() -> dict:
    """Load sample run state fixture."""
    path = Path(__file__).parent / "fixtures" / "sample_run_state.json"
    with open(path) as f:
        return json.load(f)
