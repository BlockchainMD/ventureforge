"""Tests for memory modules."""

from __future__ import annotations

from ventureforge.memory.knowledge_base import KnowledgeBase
from ventureforge.memory.lessons import LessonsStore


async def test_knowledge_base_empty(db_session):
    kb = KnowledgeBase(db_session)
    opps = await kb.get_all_opportunities()
    assert opps == []


async def test_knowledge_base_explored_titles(db_session):
    kb = KnowledgeBase(db_session)
    titles = await kb.get_explored_titles()
    assert titles == []


async def test_knowledge_base_shortlisted(db_session):
    kb = KnowledgeBase(db_session)
    shortlisted = await kb.get_shortlisted()
    assert shortlisted == []


async def test_lessons_store_add_and_get(db_session):
    store = LessonsStore(db_session)
    await store.add_lesson(
        source_run_id="test-run",
        category="market_sizing",
        insight="Bottom-up beats top-down",
        applies_to=["screener"],
    )
    await db_session.flush()

    lessons = await store.get_lessons_for("screener")
    assert len(lessons) == 1
    assert "Bottom-up" in lessons[0]


async def test_lessons_by_category(db_session):
    store = LessonsStore(db_session)
    await store.add_lesson("run1", "market_sizing", "Insight 1")
    await store.add_lesson("run2", "gtm", "Insight 2")
    await db_session.flush()

    market = await store.get_lessons_by_category("market_sizing")
    assert len(market) == 1

    all_lessons = await store.get_all_lessons()
    assert len(all_lessons) == 2
