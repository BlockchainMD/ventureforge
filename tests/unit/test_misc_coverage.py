"""Tests for miscellaneous modules to improve coverage."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ventureforge.core.schemas import TokenUsage


# ------------------------------------------------------------------
# Database module
# ------------------------------------------------------------------


def test_database_get_engine():
    """Test get_engine creates engine and session factory."""
    import ventureforge.core.database as db_mod

    # Reset globals
    db_mod._engine = None
    db_mod._session_factory = None

    with patch("ventureforge.core.database.get_settings") as mock_settings:
        mock_settings.return_value.database_url = "sqlite:///./test_coverage.db"
        engine = db_mod.get_engine()
        assert engine is not None
        # Calling again returns the same engine
        assert db_mod.get_engine() is engine

    # Cleanup
    db_mod._engine = None
    db_mod._session_factory = None


def test_database_get_engine_postgres():
    import ventureforge.core.database as db_mod

    db_mod._engine = None
    db_mod._session_factory = None

    with patch("ventureforge.core.database.get_settings") as mock_settings:
        mock_settings.return_value.database_url = "postgresql://user:pass@localhost/db"
        with patch("ventureforge.core.database.create_async_engine") as mock_create:
            mock_create.return_value = MagicMock()
            engine = db_mod.get_engine()
            mock_create.assert_called_once()
            call_args = mock_create.call_args
            assert "asyncpg" in call_args[0][0]

    db_mod._engine = None
    db_mod._session_factory = None


def test_database_get_session_factory():
    import ventureforge.core.database as db_mod

    db_mod._engine = None
    db_mod._session_factory = None

    with patch("ventureforge.core.database.get_settings") as mock_settings:
        mock_settings.return_value.database_url = "sqlite:///./test_sf.db"
        factory = db_mod.get_session_factory()
        assert factory is not None
        assert db_mod.get_session_factory() is factory

    db_mod._engine = None
    db_mod._session_factory = None


async def test_database_init_db():
    import ventureforge.core.database as db_mod

    db_mod._engine = None
    db_mod._session_factory = None

    await db_mod.init_db("sqlite+aiosqlite:///:memory:")
    assert db_mod._engine is not None

    await db_mod.close_db()
    assert db_mod._engine is None
    assert db_mod._session_factory is None


async def test_database_close_db_when_none():
    import ventureforge.core.database as db_mod

    db_mod._engine = None
    db_mod._session_factory = None
    # Should not raise
    await db_mod.close_db()


async def test_database_get_session():
    import ventureforge.core.database as db_mod

    db_mod._engine = None
    db_mod._session_factory = None
    await db_mod.init_db("sqlite+aiosqlite:///:memory:")

    async for session in db_mod.get_session():
        assert session is not None
        break

    await db_mod.close_db()


# ------------------------------------------------------------------
# EmbeddingStore
# ------------------------------------------------------------------


def test_embedding_store_unavailable():
    """EmbeddingStore should gracefully handle missing sentence-transformers."""
    with patch.dict("sys.modules", {"sentence_transformers": None}):
        # Force re-import
        import importlib
        import ventureforge.memory.embeddings as emb_mod

        importlib.reload(emb_mod)
        store = emb_mod.EmbeddingStore()
        assert store.available is False
        assert store.embed("test") == []
        assert store.similarity("a", "b") == 0.0


# ------------------------------------------------------------------
# Web fetcher
# ------------------------------------------------------------------


async def test_fetch_url_html():
    import httpx

    from ventureforge.research.web_fetcher import fetch_url

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = "<html><body><p>Hello world</p></body></html>"
    mock_response.headers = {"content-type": "text/html"}
    mock_response.raise_for_status = MagicMock()

    with patch("ventureforge.research.web_fetcher.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value = mock_client

        result = await fetch_url("https://example.com")
        assert result["status_code"] == 200
        assert "Hello world" in result["content"]
        assert "<p>" not in result["content"]


async def test_fetch_url_non_html():
    from ventureforge.research.web_fetcher import fetch_url

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = '{"key": "value"}'
    mock_response.headers = {"content-type": "application/json"}
    mock_response.raise_for_status = MagicMock()

    with patch("ventureforge.research.web_fetcher.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value = mock_client

        result = await fetch_url("https://api.example.com/data")
        assert result["content_type"] == "application/json"


async def test_fetch_url_error():
    import httpx

    from ventureforge.core.exceptions import ResearchError
    from ventureforge.research.web_fetcher import fetch_url

    with patch("ventureforge.research.web_fetcher.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(side_effect=httpx.HTTPError("Connection failed"))
        mock_client_cls.return_value = mock_client

        with pytest.raises(ResearchError):
            await fetch_url("https://fail.example.com")


# ------------------------------------------------------------------
# CrunchbaseClient
# ------------------------------------------------------------------


def test_crunchbase_not_available():
    with patch("ventureforge.research.crunchbase_client.get_settings") as mock:
        mock.return_value.crunchbase_api_key = None
        from ventureforge.research.crunchbase_client import CrunchbaseClient

        client = CrunchbaseClient()
        assert client.available is False


def test_crunchbase_available():
    with patch("ventureforge.research.crunchbase_client.get_settings") as mock:
        mock.return_value.crunchbase_api_key = "test-key"
        from ventureforge.research.crunchbase_client import CrunchbaseClient

        client = CrunchbaseClient()
        assert client.available is True


async def test_crunchbase_search_no_key():
    with patch("ventureforge.research.crunchbase_client.get_settings") as mock:
        mock.return_value.crunchbase_api_key = None
        from ventureforge.research.crunchbase_client import CrunchbaseClient

        client = CrunchbaseClient()
        results = await client.search_organizations("test")
        assert results == []


async def test_crunchbase_search_success():
    with patch("ventureforge.research.crunchbase_client.get_settings") as mock:
        mock.return_value.crunchbase_api_key = "test-key"
        from ventureforge.research.crunchbase_client import CrunchbaseClient

        client = CrunchbaseClient()

        mock_response = MagicMock()
        mock_response.json.return_value = {"entities": [{"name": "TestCorp"}]}
        mock_response.raise_for_status = MagicMock()

        with patch("ventureforge.research.crunchbase_client.httpx.AsyncClient") as mock_cls:
            mc = AsyncMock()
            mc.__aenter__ = AsyncMock(return_value=mc)
            mc.__aexit__ = AsyncMock(return_value=False)
            mc.get = AsyncMock(return_value=mock_response)
            mock_cls.return_value = mc

            results = await client.search_organizations("test")
            assert len(results) == 1
            assert results[0]["name"] == "TestCorp"


async def test_crunchbase_search_http_error():
    import httpx

    with patch("ventureforge.research.crunchbase_client.get_settings") as mock:
        mock.return_value.crunchbase_api_key = "test-key"
        from ventureforge.research.crunchbase_client import CrunchbaseClient

        client = CrunchbaseClient()

        with patch("ventureforge.research.crunchbase_client.httpx.AsyncClient") as mock_cls:
            mc = AsyncMock()
            mc.__aenter__ = AsyncMock(return_value=mc)
            mc.__aexit__ = AsyncMock(return_value=False)
            mc.get = AsyncMock(side_effect=httpx.HTTPError("timeout"))
            mock_cls.return_value = mc

            results = await client.search_organizations("test")
            assert results == []


# ------------------------------------------------------------------
# Token counter
# ------------------------------------------------------------------


def test_token_counter():
    from ventureforge.utils.token_counter import count_tokens

    count = count_tokens("Hello world this is a test")
    assert isinstance(count, int)
    assert count > 0
