"""Accumulated lessons from meta-agent retrospectives."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ventureforge.core.models import Lesson
from ventureforge.utils.logger import get_logger

logger = get_logger()


class LessonsStore:
    """Stores and retrieves lessons from retrospectives."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add_lesson(
        self,
        source_run_id: str,
        category: str,
        insight: str,
        applies_to: list[str] | None = None,
    ) -> Lesson:
        """Add a new lesson."""
        lesson = Lesson(
            source_run_id=source_run_id,
            category=category,
            insight=insight,
            applies_to=applies_to or [],
        )
        self._session.add(lesson)
        await self._session.flush()
        logger.info("lesson_added", category=category, insight=insight[:80])
        return lesson

    async def get_lessons_for(self, run_type: str) -> list[str]:
        """Get lesson insights applicable to a run type."""
        result = await self._session.execute(select(Lesson))
        lessons = result.scalars().all()
        applicable = [
            lesson.insight
            for lesson in lessons
            if not lesson.applies_to or run_type in lesson.applies_to
        ]
        return applicable

    async def get_lessons_by_category(self, category: str) -> list[dict[str, Any]]:
        """Get all lessons in a category."""
        result = await self._session.execute(
            select(Lesson).where(Lesson.category == category)
        )
        return [
            {
                "id": l.id,
                "insight": l.insight,
                "source_run_id": l.source_run_id,
                "applies_to": l.applies_to,
            }
            for l in result.scalars().all()
        ]

    async def get_all_lessons(self) -> list[dict[str, Any]]:
        """Get all lessons."""
        result = await self._session.execute(select(Lesson))
        return [
            {
                "id": l.id,
                "category": l.category,
                "insight": l.insight,
                "source_run_id": l.source_run_id,
                "applies_to": l.applies_to,
                "created_at": l.created_at.isoformat() if l.created_at else None,
            }
            for l in result.scalars().all()
        ]
