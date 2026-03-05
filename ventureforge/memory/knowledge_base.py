"""Searchable store of all past runs and opportunities."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ventureforge.core.models import Opportunity, OpportunityStatus
from ventureforge.utils.logger import get_logger

logger = get_logger()


class KnowledgeBase:
    """Searchable store of all completed screener runs and opportunities."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_all_opportunities(self) -> list[dict[str, Any]]:
        """Get all opportunities ever generated."""
        result = await self._session.execute(select(Opportunity))
        opps = result.scalars().all()
        return [
            {
                "id": opp.id,
                "title": opp.title,
                "problem_space": opp.problem_space,
                "composite_score": opp.composite_score,
                "status": opp.status.value,
                "target_customer": opp.target_customer,
                "ai_moat_description": opp.ai_moat_description,
            }
            for opp in opps
        ]

    async def get_explored_titles(self) -> list[str]:
        """Get titles of all previously explored opportunities."""
        result = await self._session.execute(select(Opportunity.title))
        return [row[0] for row in result.all()]

    async def get_shortlisted(self) -> list[dict[str, Any]]:
        """Get all shortlisted or selected opportunities."""
        result = await self._session.execute(
            select(Opportunity).where(
                Opportunity.status.in_([OpportunityStatus.SHORTLISTED, OpportunityStatus.SELECTED])
            )
        )
        return [
            {"id": opp.id, "title": opp.title, "composite_score": opp.composite_score}
            for opp in result.scalars().all()
        ]

    async def find_similar(self, problem_space: str, threshold: float = 0.7) -> list[dict[str, Any]]:
        """Find opportunities with similar problem spaces.

        Uses simple text matching. For semantic search, use embeddings module.
        """
        keywords = set(problem_space.lower().split())
        all_opps = await self.get_all_opportunities()

        similar = []
        for opp in all_opps:
            opp_keywords = set(opp["problem_space"].lower().split())
            overlap = len(keywords & opp_keywords)
            total = len(keywords | opp_keywords) or 1
            similarity = overlap / total
            if similarity >= threshold:
                opp["similarity"] = similarity
                similar.append(opp)

        return sorted(similar, key=lambda x: x.get("similarity", 0), reverse=True)
