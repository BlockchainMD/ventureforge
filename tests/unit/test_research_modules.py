"""Tests for research modules: tavily_client, synthesizer, engine."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ventureforge.core.schemas import ResearchBundle, ResearchInsight, TokenUsage


# ------------------------------------------------------------------
# TavilyClient
# ------------------------------------------------------------------


def test_search_result_to_dict():
    from ventureforge.research.tavily_client import SearchResult

    sr = SearchResult(query="test", results=[{"title": "r1"}])
    d = sr.to_dict()
    assert d["query"] == "test"
    assert len(d["results"]) == 1


async def test_tavily_search_cached():
    from ventureforge.research.cache import ResearchCache
    from ventureforge.research.tavily_client import TavilyClient

    cache = ResearchCache()
    cache.set("cached query", [{"title": "cached"}], "advanced")

    with patch("ventureforge.research.tavily_client.get_settings") as mock:
        mock.return_value.tavily_api_key = "test"
        client = TavilyClient(cache=cache)

    result = await client.search("cached query")
    assert result.results[0]["title"] == "cached"


async def test_tavily_search_live():
    from ventureforge.research.tavily_client import TavilyClient

    with patch("ventureforge.research.tavily_client.get_settings") as mock:
        mock.return_value.tavily_api_key = "test-key"
        client = TavilyClient()

    mock_tavily = AsyncMock()
    mock_tavily.search = AsyncMock(
        return_value={
            "results": [
                {
                    "title": "Result 1",
                    "url": "https://example.com",
                    "content": "Some content",
                    "score": 0.9,
                    "published_date": "2025-01-01",
                }
            ]
        }
    )
    client._client = mock_tavily

    result = await client.search("test query", include_domains=["example.com"])
    assert len(result.results) == 1
    assert result.results[0]["title"] == "Result 1"
    assert result.results[0]["score"] == 0.9


async def test_tavily_search_error():
    from ventureforge.core.exceptions import ResearchError
    from ventureforge.research.tavily_client import TavilyClient

    with patch("ventureforge.research.tavily_client.get_settings") as mock:
        mock.return_value.tavily_api_key = "test-key"
        client = TavilyClient()

    mock_tavily = AsyncMock()
    mock_tavily.search = AsyncMock(side_effect=Exception("API down"))
    client._client = mock_tavily

    with pytest.raises(ResearchError, match="Tavily search failed"):
        await client.search("failing query")


async def test_tavily_search_batch():
    from ventureforge.research.tavily_client import SearchResult, TavilyClient

    with patch("ventureforge.research.tavily_client.get_settings") as mock:
        mock.return_value.tavily_api_key = "test"
        mock.return_value.max_concurrent_research_threads = 2
        client = TavilyClient()

    async def _fake_search(query, **kwargs):
        return SearchResult(query=query, results=[{"title": f"Result for {query}"}])

    client.search = _fake_search

    results = await client.search_batch(["q1", "q2", "q3"], max_concurrent=2)
    assert len(results) == 3
    assert results[0].results[0]["title"] == "Result for q1"


async def test_tavily_search_batch_with_error():
    from ventureforge.research.tavily_client import TavilyClient

    with patch("ventureforge.research.tavily_client.get_settings") as mock:
        mock.return_value.tavily_api_key = "test"
        mock.return_value.max_concurrent_research_threads = 2
        client = TavilyClient()

    call_count = 0

    async def _flaky_search(query, **kwargs):
        nonlocal call_count
        call_count += 1
        if "fail" in query:
            raise Exception("API error")
        from ventureforge.research.tavily_client import SearchResult
        return SearchResult(query=query, results=[{"title": "ok"}])

    client.search = _flaky_search

    results = await client.search_batch(["good", "fail_query"])
    assert len(results) == 2
    assert results[0].results[0]["title"] == "ok"
    assert results[1].results == []  # Failed query returns empty


async def test_tavily_search_exclude_domains():
    from ventureforge.research.tavily_client import TavilyClient

    with patch("ventureforge.research.tavily_client.get_settings") as mock:
        mock.return_value.tavily_api_key = "test-key"
        client = TavilyClient()

    mock_tavily = AsyncMock()
    mock_tavily.search = AsyncMock(return_value={"results": []})
    client._client = mock_tavily

    result = await client.search("test", exclude_domains=["spam.com"])
    assert result.results == []
    call_kwargs = mock_tavily.search.call_args[1]
    assert call_kwargs["exclude_domains"] == ["spam.com"]


# ------------------------------------------------------------------
# ResearchSynthesizer
# ------------------------------------------------------------------


async def test_synthesizer_empty_results():
    from ventureforge.research.synthesizer import ResearchSynthesizer

    router = MagicMock()
    synth = ResearchSynthesizer(router)
    bundle = await synth.synthesize("test query", [])
    assert bundle.query == "test query"
    assert bundle.insights == []


async def test_synthesizer_success():
    from ventureforge.research.synthesizer import ResearchSynthesizer

    router = MagicMock()
    router.generate_json = AsyncMock(
        return_value=(
            {
                "insights": [
                    {
                        "claim": "Market is $10B",
                        "confidence": "high",
                        "source_url": "https://example.com",
                        "category": "market_size",
                        "contradicts": [],
                    }
                ]
            },
            TokenUsage(),
        )
    )

    synth = ResearchSynthesizer(router)
    raw = [{"url": "https://example.com", "title": "Report", "content": "Market data"}]
    bundle = await synth.synthesize("market size query", raw)
    assert len(bundle.insights) == 1
    assert bundle.insights[0].claim == "Market is $10B"


async def test_synthesizer_llm_error():
    from ventureforge.research.synthesizer import ResearchSynthesizer

    router = MagicMock()
    router.generate_json = AsyncMock(side_effect=Exception("LLM error"))

    synth = ResearchSynthesizer(router)
    raw = [{"url": "https://x.com", "title": "T", "content": "C"}]
    bundle = await synth.synthesize("query", raw)
    # Should return empty insights on error, not raise
    assert bundle.insights == []
    assert bundle.raw_results == raw


async def test_synthesizer_bad_insight_skipped():
    from ventureforge.research.synthesizer import ResearchSynthesizer

    router = MagicMock()
    router.generate_json = AsyncMock(
        return_value=(
            {
                "insights": [
                    {"claim": "Valid insight", "confidence": "high",
                     "source_url": "https://x.com", "category": "market_size"},
                    # This might cause issues depending on validation
                    {"bad_field": True},
                ]
            },
            TokenUsage(),
        )
    )

    synth = ResearchSynthesizer(router)
    raw = [{"url": "https://x.com", "title": "T", "content": "C"}]
    bundle = await synth.synthesize("query", raw)
    # At least the valid insight should be there
    assert len(bundle.insights) >= 1


# ------------------------------------------------------------------
# ResearchEngine
# ------------------------------------------------------------------


async def test_engine_research_topic():
    from ventureforge.research.engine import ResearchEngine
    from ventureforge.research.tavily_client import SearchResult

    router = MagicMock()
    router.generate_json = AsyncMock(
        return_value=({"insights": []}, TokenUsage())
    )

    with patch("ventureforge.research.engine.get_settings") as mock_settings:
        mock_settings.return_value.tavily_api_key = "test"
        mock_settings.return_value.crunchbase_api_key = None
        mock_settings.return_value.max_concurrent_research_threads = 2
        engine = ResearchEngine(router)

    engine._tavily.search_batch = AsyncMock(
        return_value=[
            SearchResult("q1", [{"title": "r1", "url": "u1", "content": "c1"}]),
            SearchResult("q2", [{"title": "r2", "url": "u2", "content": "c2"}]),
        ]
    )

    bundle = await engine.research_topic(["q1", "q2"])
    assert isinstance(bundle, ResearchBundle)


async def test_engine_research_opportunity():
    from ventureforge.research.engine import ResearchEngine

    router = MagicMock()

    with patch("ventureforge.research.engine.get_settings") as mock_settings:
        mock_settings.return_value.tavily_api_key = "test"
        mock_settings.return_value.crunchbase_api_key = None
        mock_settings.return_value.max_concurrent_research_threads = 2
        engine = ResearchEngine(router)

    mock_bundle = ResearchBundle(query="test", insights=[], raw_results=[])
    engine.research_topic = AsyncMock(return_value=mock_bundle)

    result = await engine.research_opportunity("TestCo", "compliance automation")
    assert isinstance(result, ResearchBundle)
    # Should have generated 5 queries
    engine.research_topic.assert_called_once()
    queries = engine.research_topic.call_args[0][0]
    assert len(queries) == 5


async def test_engine_research_batch():
    from ventureforge.research.engine import ResearchEngine

    router = MagicMock()

    with patch("ventureforge.research.engine.get_settings") as mock_settings:
        mock_settings.return_value.tavily_api_key = "test"
        mock_settings.return_value.crunchbase_api_key = None
        mock_settings.return_value.max_concurrent_research_threads = 2
        engine = ResearchEngine(router)

    mock_bundle = ResearchBundle(query="test", insights=[], raw_results=[])
    engine.research_opportunity = AsyncMock(return_value=mock_bundle)

    opps = [
        {"title": "Opp1", "problem_space": "fintech"},
        {"title": "Opp2", "problem_space": "healthtech"},
    ]
    results = await engine.research_opportunities_batch(opps)
    assert "Opp1" in results
    assert "Opp2" in results


async def test_engine_research_batch_with_error():
    from ventureforge.research.engine import ResearchEngine

    router = MagicMock()

    with patch("ventureforge.research.engine.get_settings") as mock_settings:
        mock_settings.return_value.tavily_api_key = "test"
        mock_settings.return_value.crunchbase_api_key = None
        mock_settings.return_value.max_concurrent_research_threads = 2
        engine = ResearchEngine(router)

    async def _flaky_research(title, problem_space):
        if title == "Fail":
            raise Exception("Research failed")
        return ResearchBundle(query=title, insights=[], raw_results=[])

    engine.research_opportunity = _flaky_research

    opps = [
        {"title": "Good", "problem_space": "saas"},
        {"title": "Fail", "problem_space": "bad"},
    ]
    results = await engine.research_opportunities_batch(opps)
    assert "Good" in results
    assert "Fail" in results
    assert results["Fail"].insights == []


def test_engine_cache_stats():
    from ventureforge.research.engine import ResearchEngine

    router = MagicMock()
    with patch("ventureforge.research.engine.get_settings") as mock_settings:
        mock_settings.return_value.tavily_api_key = "test"
        mock_settings.return_value.crunchbase_api_key = None
        engine = ResearchEngine(router)

    stats = engine.cache_stats
    assert isinstance(stats, dict)
