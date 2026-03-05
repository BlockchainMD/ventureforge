"""Tests for GeminiClient."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ventureforge.core.exceptions import LLMError, LLMRateLimitError
from ventureforge.core.schemas import TokenUsage


@pytest.fixture
def gemini_client():
    with patch("ventureforge.llm.gemini_client.get_settings") as mock:
        mock.return_value.gemini_api_key = "test-key"
        from ventureforge.llm.gemini_client import GeminiClient
        return GeminiClient()


@pytest.fixture
def gemini_no_key():
    with patch("ventureforge.llm.gemini_client.get_settings") as mock:
        mock.return_value.gemini_api_key = ""
        from ventureforge.llm.gemini_client import GeminiClient
        return GeminiClient()


def test_available_with_key(gemini_client):
    assert gemini_client.available is True


def test_not_available_without_key(gemini_no_key):
    assert gemini_no_key.available is False


async def test_generate_success(gemini_client):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "candidates": [
            {"content": {"parts": [{"text": "Hello world"}]}}
        ],
        "usageMetadata": {
            "promptTokenCount": 10,
            "candidatesTokenCount": 5,
        },
    }

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch("ventureforge.llm.gemini_client.httpx.AsyncClient", return_value=mock_client):
        text, usage = await gemini_client.generate("sys prompt", "user prompt")
        assert text == "Hello world"
        assert usage.input_tokens == 10
        assert usage.output_tokens == 5


async def test_generate_rate_limit(gemini_client):
    mock_response = MagicMock()
    mock_response.status_code = 429
    mock_response.text = "Too many requests"

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch("ventureforge.llm.gemini_client.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(LLMRateLimitError):
            await gemini_client.generate("sys", "user")


async def test_generate_api_error(gemini_client):
    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_response.text = "Internal server error"

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch("ventureforge.llm.gemini_client.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(LLMError):
            await gemini_client.generate("sys", "user")


async def test_generate_no_candidates(gemini_client):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"candidates": []}

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch("ventureforge.llm.gemini_client.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(LLMError, match="no candidates"):
            await gemini_client.generate("sys", "user")


async def test_generate_json_success(gemini_client):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "candidates": [
            {"content": {"parts": [{"text": '{"key": "value"}'}]}}
        ],
        "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5},
    }

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch("ventureforge.llm.gemini_client.httpx.AsyncClient", return_value=mock_client):
        data, usage = await gemini_client.generate_json("sys", "user")
        assert data == {"key": "value"}


async def test_generate_json_strips_fences(gemini_client):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "candidates": [
            {"content": {"parts": [{"text": '```json\n{"key": "value"}\n```'}]}}
        ],
        "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5},
    }

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch("ventureforge.llm.gemini_client.httpx.AsyncClient", return_value=mock_client):
        data, usage = await gemini_client.generate_json("sys", "user")
        assert data == {"key": "value"}


async def test_generate_json_invalid_json(gemini_client):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "candidates": [
            {"content": {"parts": [{"text": "not json at all"}]}}
        ],
        "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5},
    }

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch("ventureforge.llm.gemini_client.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(LLMError, match="Failed to parse JSON"):
            await gemini_client.generate_json("sys", "user")
