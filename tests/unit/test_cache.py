"""Tests for research cache."""

from __future__ import annotations

from ventureforge.research.cache import ResearchCache


def test_cache_set_and_get():
    cache = ResearchCache(ttl_hours=1)
    cache.set("test query", {"result": "data"})
    assert cache.get("test query") == {"result": "data"}


def test_cache_miss():
    cache = ResearchCache(ttl_hours=1)
    assert cache.get("nonexistent") is None


def test_cache_different_depth():
    cache = ResearchCache(ttl_hours=1)
    cache.set("query", "basic_data", search_depth="basic")
    cache.set("query", "advanced_data", search_depth="advanced")
    assert cache.get("query", "basic") == "basic_data"
    assert cache.get("query", "advanced") == "advanced_data"


def test_cache_clear():
    cache = ResearchCache(ttl_hours=1)
    cache.set("q1", "d1")
    cache.set("q2", "d2")
    assert cache.size == 2
    cache.clear()
    assert cache.size == 0


def test_cache_stats():
    cache = ResearchCache(ttl_hours=1)
    cache.set("q1", "d1")
    stats = cache.stats()
    assert stats["total_entries"] == 1
    assert stats["active_entries"] == 1
