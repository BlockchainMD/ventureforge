"""Tests for checkpointer."""

from __future__ import annotations

from sqlalchemy import select

from ventureforge.core.models import Phase, PhaseStatus, Round, Run, RunStatus
from ventureforge.orchestrator.checkpointer import Checkpointer


async def test_create_phase(db_session):
    run = Run(run_type="screener", status=RunStatus.RUNNING)
    db_session.add(run)
    await db_session.flush()

    cp = Checkpointer(db_session)
    phase = await cp.create_phase(run.id, "horizon_scan")
    assert phase.phase_name == "horizon_scan"
    assert phase.status == PhaseStatus.RUNNING


async def test_save_round(db_session):
    run = Run(run_type="screener", status=RunStatus.RUNNING)
    db_session.add(run)
    await db_session.flush()

    cp = Checkpointer(db_session)
    phase = await cp.create_phase(run.id, "test_phase")

    round_record = await cp.save_round(
        phase_id=phase.id,
        round_number=1,
        agent_outputs={"gen": {"content": "test"}},
        research_citations=[],
        scores={"score": 7.5},
        critique_summary="Looks good",
        decision="advance",
        decision_rationale="Score sufficient",
        token_usage={"input": 100, "output": 200},
        duration_seconds=1.5,
    )
    assert round_record.round_number == 1
    assert round_record.decision == "advance"


async def test_save_phase_result(db_session):
    run = Run(run_type="screener", status=RunStatus.RUNNING)
    db_session.add(run)
    await db_session.flush()

    cp = Checkpointer(db_session)
    phase = await cp.create_phase(run.id, "test_phase")

    await cp.save_phase_result(phase.id, {"result": "final"}, 0.88)

    result = await db_session.execute(select(Phase).where(Phase.id == phase.id))
    updated = result.scalar_one()
    assert updated.quality_score == 0.88
    assert updated.status == PhaseStatus.COMPLETED


async def test_get_all_rounds(db_session):
    run = Run(run_type="screener", status=RunStatus.RUNNING)
    db_session.add(run)
    await db_session.flush()

    cp = Checkpointer(db_session)
    phase = await cp.create_phase(run.id, "test_phase")

    await cp.save_round(phase.id, 1, {}, [], {}, "", "loop", "", {}, 1.0)
    await cp.save_round(phase.id, 2, {}, [], {}, "", "advance", "", {}, 1.0)

    rounds = await cp.get_all_rounds(phase.id)
    assert len(rounds) == 2
    assert rounds[0].round_number == 1
    assert rounds[1].round_number == 2


async def test_get_last_round(db_session):
    run = Run(run_type="screener", status=RunStatus.RUNNING)
    db_session.add(run)
    await db_session.flush()

    cp = Checkpointer(db_session)
    phase = await cp.create_phase(run.id, "test_phase")

    await cp.save_round(phase.id, 1, {}, [], {}, "", "loop", "", {}, 1.0)
    await cp.save_round(phase.id, 2, {}, [], {}, "", "advance", "", {}, 1.0)

    last = await cp.get_last_round(phase.id)
    assert last is not None
    assert last.round_number == 2
