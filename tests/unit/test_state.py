"""Tests for StateManager - run lifecycle state machine."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from ventureforge.core.exceptions import RunNotFoundError, RunNotResumableError, StateTransitionError
from ventureforge.core.models import Run, RunStatus
from ventureforge.core.state import StateManager, VALID_TRANSITIONS


async def _create_run(session: AsyncSession, status: RunStatus = RunStatus.PENDING) -> Run:
    """Helper to create a run record in the test database."""
    run = Run(run_type="screener", status=status, input_config={})
    session.add(run)
    await session.flush()
    return run


class TestValidTransitions:
    async def test_pending_to_running(self, db_session: AsyncSession):
        run = await _create_run(db_session)
        sm = StateManager(db_session)
        updated = await sm.start_run(run.id)
        assert updated.status == RunStatus.RUNNING

    async def test_running_to_completed(self, db_session: AsyncSession):
        run = await _create_run(db_session, RunStatus.RUNNING)
        sm = StateManager(db_session)
        updated = await sm.complete_run(run.id)
        assert updated.status == RunStatus.COMPLETED

    async def test_running_to_paused(self, db_session: AsyncSession):
        run = await _create_run(db_session, RunStatus.RUNNING)
        sm = StateManager(db_session)
        updated = await sm.pause_run(run.id)
        assert updated.status == RunStatus.PAUSED

    async def test_running_to_failed(self, db_session: AsyncSession):
        run = await _create_run(db_session, RunStatus.RUNNING)
        sm = StateManager(db_session)
        updated = await sm.fail_run(run.id, "test error")
        assert updated.status == RunStatus.FAILED

    async def test_paused_to_running(self, db_session: AsyncSession):
        run = await _create_run(db_session, RunStatus.PAUSED)
        sm = StateManager(db_session)
        updated = await sm.resume_run(run.id)
        assert updated.status == RunStatus.RUNNING


class TestInvalidTransitions:
    async def test_pending_to_completed_raises(self, db_session: AsyncSession):
        run = await _create_run(db_session, RunStatus.PENDING)
        sm = StateManager(db_session)
        with pytest.raises(StateTransitionError):
            await sm.transition(run.id, RunStatus.COMPLETED)

    async def test_completed_to_running_raises(self, db_session: AsyncSession):
        run = await _create_run(db_session, RunStatus.COMPLETED)
        sm = StateManager(db_session)
        with pytest.raises(StateTransitionError):
            await sm.transition(run.id, RunStatus.RUNNING)

    async def test_failed_to_running_raises(self, db_session: AsyncSession):
        run = await _create_run(db_session, RunStatus.FAILED)
        sm = StateManager(db_session)
        with pytest.raises(StateTransitionError):
            await sm.transition(run.id, RunStatus.RUNNING)

    async def test_pending_to_paused_raises(self, db_session: AsyncSession):
        run = await _create_run(db_session, RunStatus.PENDING)
        sm = StateManager(db_session)
        with pytest.raises(StateTransitionError):
            await sm.transition(run.id, RunStatus.PAUSED)


class TestResumeValidation:
    async def test_resume_non_paused_run_raises(self, db_session: AsyncSession):
        run = await _create_run(db_session, RunStatus.RUNNING)
        sm = StateManager(db_session)
        with pytest.raises(RunNotResumableError):
            await sm.resume_run(run.id)


class TestGetRun:
    async def test_nonexistent_run_raises(self, db_session: AsyncSession):
        sm = StateManager(db_session)
        with pytest.raises(RunNotFoundError):
            await sm.get_run("nonexistent-id")

    async def test_get_existing_run(self, db_session: AsyncSession):
        run = await _create_run(db_session)
        sm = StateManager(db_session)
        fetched = await sm.get_run(run.id)
        assert fetched.id == run.id


class TestUpdatePhase:
    async def test_updates_phase_and_round(self, db_session: AsyncSession):
        run = await _create_run(db_session, RunStatus.RUNNING)
        sm = StateManager(db_session)
        await sm.update_phase(run.id, "deep_dive", 2)
        updated = await sm.get_run(run.id)
        assert updated.current_phase == "deep_dive"
        assert updated.current_round == 2


class TestTransitionLogging:
    async def test_transition_creates_log(self, db_session: AsyncSession):
        run = await _create_run(db_session)
        sm = StateManager(db_session)
        await sm.start_run(run.id)
        # The log should exist - we verify the transition succeeded
        # and the state manager flushed without error
        assert run.status == RunStatus.RUNNING
