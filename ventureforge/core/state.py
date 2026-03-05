"""Run state machine and transition logic."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ventureforge.core.exceptions import (
    RunNotFoundError,
    RunNotResumableError,
    StateTransitionError,
)
from ventureforge.core.models import (
    PhaseStatus,
    Run,
    RunStatus,
    StateTransitionLog,
)

# Valid state transitions
VALID_TRANSITIONS: dict[RunStatus, set[RunStatus]] = {
    RunStatus.PENDING: {RunStatus.RUNNING},
    RunStatus.RUNNING: {RunStatus.PAUSED, RunStatus.COMPLETED, RunStatus.FAILED},
    RunStatus.PAUSED: {RunStatus.RUNNING, RunStatus.FAILED},
    RunStatus.FAILED: set(),
    RunStatus.COMPLETED: set(),
}


class StateManager:
    """Manages run state transitions with audit logging."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_run(self, run_id: str) -> Run:
        """Fetch a run by ID."""
        result = await self.session.execute(select(Run).where(Run.id == run_id))
        run = result.scalar_one_or_none()
        if run is None:
            raise RunNotFoundError(f"Run {run_id} not found")
        return run

    async def transition(self, run_id: str, target: RunStatus, reason: str = "") -> Run:
        """Transition a run to a new status with validation and audit logging."""
        run = await self.get_run(run_id)
        current = run.status

        if target not in VALID_TRANSITIONS.get(current, set()):
            raise StateTransitionError(current.value, target.value)

        log = StateTransitionLog(
            run_id=run_id,
            from_status=current.value,
            to_status=target.value,
            reason=reason,
            timestamp=datetime.now(UTC),
        )
        self.session.add(log)

        run.status = target
        run.updated_at = datetime.now(UTC)
        await self.session.flush()
        return run

    async def start_run(self, run_id: str) -> Run:
        """Transition run from PENDING to RUNNING."""
        return await self.transition(run_id, RunStatus.RUNNING, "Run started")

    async def pause_run(self, run_id: str, reason: str = "User requested pause") -> Run:
        """Transition run from RUNNING to PAUSED."""
        return await self.transition(run_id, RunStatus.PAUSED, reason)

    async def resume_run(self, run_id: str) -> Run:
        """Transition run from PAUSED to RUNNING."""
        run = await self.get_run(run_id)
        if run.status != RunStatus.PAUSED:
            raise RunNotResumableError(f"Run {run_id} is {run.status.value}, not PAUSED")
        return await self.transition(run_id, RunStatus.RUNNING, "Run resumed")

    async def complete_run(self, run_id: str) -> Run:
        """Transition run from RUNNING to COMPLETED."""
        return await self.transition(run_id, RunStatus.COMPLETED, "Run completed successfully")

    async def fail_run(self, run_id: str, reason: str = "Unknown error") -> Run:
        """Transition run to FAILED."""
        return await self.transition(run_id, RunStatus.FAILED, reason)

    async def update_phase(
        self, run_id: str, phase_name: str, round_number: int
    ) -> None:
        """Update the current phase and round on the run record."""
        run = await self.get_run(run_id)
        run.current_phase = phase_name
        run.current_round = round_number
        run.updated_at = datetime.now(UTC)
        await self.session.flush()

    async def set_phase_status(
        self, phase_id: str, status: PhaseStatus
    ) -> None:
        """Update a phase's status."""
        from ventureforge.core.models import Phase

        result = await self.session.execute(select(Phase).where(Phase.id == phase_id))
        phase = result.scalar_one_or_none()
        if phase is not None:
            phase.status = status
            if status == PhaseStatus.RUNNING and phase.started_at is None:
                phase.started_at = datetime.now(UTC)
            elif status in (PhaseStatus.COMPLETED, PhaseStatus.FAILED):
                phase.completed_at = datetime.now(UTC)
            await self.session.flush()
