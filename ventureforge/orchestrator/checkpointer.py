"""Saves and resumes run state at any round."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ventureforge.core.models import Phase, PhaseStatus, Round
from ventureforge.utils.logger import get_logger

logger = get_logger()


class Checkpointer:
    """Persists run state after every round for crash recovery."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def save_round(
        self,
        phase_id: str,
        round_number: int,
        agent_outputs: dict[str, Any],
        research_citations: list[dict[str, Any]],
        scores: dict[str, Any],
        critique_summary: str,
        decision: str,
        decision_rationale: str,
        token_usage: dict[str, Any],
        duration_seconds: float,
    ) -> Round:
        """Persist a completed round to the database."""
        round_record = Round(
            phase_id=phase_id,
            round_number=round_number,
            agent_outputs=agent_outputs,
            research_citations=research_citations,
            scores=scores,
            critique_summary=critique_summary,
            decision=decision,
            decision_rationale=decision_rationale,
            token_usage=token_usage,
            duration_seconds=duration_seconds,
        )
        self._session.add(round_record)
        await self._session.flush()

        # Update phase round count
        result = await self._session.execute(select(Phase).where(Phase.id == phase_id))
        phase = result.scalar_one_or_none()
        if phase:
            phase.round_count = round_number
            await self._session.flush()

        logger.info("round_checkpointed", phase_id=phase_id, round=round_number, decision=decision)
        return round_record

    async def save_phase_result(
        self,
        phase_id: str,
        final_output: dict[str, Any],
        quality_score: float,
    ) -> None:
        """Save the final result of a completed phase."""
        result = await self._session.execute(select(Phase).where(Phase.id == phase_id))
        phase = result.scalar_one_or_none()
        if phase:
            phase.final_output = final_output
            phase.quality_score = quality_score
            phase.status = PhaseStatus.COMPLETED
            phase.completed_at = datetime.now(UTC)
            await self._session.flush()
            logger.info("phase_completed", phase_id=phase_id, score=quality_score)

    async def create_phase(self, run_id: str, phase_name: str) -> Phase:
        """Create a new phase record."""
        phase = Phase(
            run_id=run_id,
            phase_name=phase_name,
            status=PhaseStatus.RUNNING,
            started_at=datetime.now(UTC),
        )
        self._session.add(phase)
        await self._session.flush()
        return phase

    async def get_last_round(self, phase_id: str) -> Round | None:
        """Get the last completed round for resume purposes."""
        result = await self._session.execute(
            select(Round)
            .where(Round.phase_id == phase_id)
            .order_by(Round.round_number.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_all_rounds(self, phase_id: str) -> list[Round]:
        """Get all rounds for a phase in order."""
        result = await self._session.execute(
            select(Round)
            .where(Round.phase_id == phase_id)
            .order_by(Round.round_number)
        )
        return list(result.scalars().all())

    async def commit(self) -> None:
        """Commit the current transaction."""
        await self._session.commit()
