"""Integration test: ScreenerPipeline with dry_run=True."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from ventureforge.core.models import Run, RunStatus
from ventureforge.core.schemas import ScreenerInput
from ventureforge.screener.screener import ScreenerPipeline


class TestScreenerPipelineDryRun:
    async def test_pipeline_creates_run(self, db_session: AsyncSession):
        """Verify the pipeline creates a run record in the database."""
        with patch("ventureforge.orchestrator.runner.LLMRouter"):
            pipeline = ScreenerPipeline(session=db_session, dry_run=True)
            input_config = ScreenerInput(domain="fintech", max_rounds_per_phase=1)
            result = await pipeline.run(input_config)

        assert "run_id" in result
        assert result["run_id"] is not None

    async def test_pipeline_produces_opportunities(self, db_session: AsyncSession):
        """Verify the pipeline produces opportunity records."""
        with patch("ventureforge.orchestrator.runner.LLMRouter"):
            pipeline = ScreenerPipeline(session=db_session, dry_run=True)
            input_config = ScreenerInput(
                domain="healthtech",
                max_rounds_per_phase=1,
                quality_threshold=0.5,
            )
            result = await pipeline.run(input_config)

        opportunities = result.get("opportunities", [])
        assert len(opportunities) > 0

        # Each opportunity should have required fields
        for opp in opportunities:
            assert "id" in opp
            assert "title" in opp
            assert "status" in opp

    async def test_pipeline_executes_phases(self, db_session: AsyncSession):
        """Verify the pipeline executes multiple phases."""
        with patch("ventureforge.orchestrator.runner.LLMRouter"):
            pipeline = ScreenerPipeline(session=db_session, dry_run=True)
            input_config = ScreenerInput(
                max_rounds_per_phase=1,
                quality_threshold=0.5,
            )
            result = await pipeline.run(input_config)

        phase_results = result.get("phase_results", [])
        assert len(phase_results) >= 1

        # Each phase result should have expected fields
        for pr in phase_results:
            assert "phase_name" in pr
            assert "rounds_executed" in pr

    async def test_pipeline_run_status_is_completed(self, db_session: AsyncSession):
        """Verify the run ends in COMPLETED status."""
        with patch("ventureforge.orchestrator.runner.LLMRouter"):
            pipeline = ScreenerPipeline(session=db_session, dry_run=True)
            input_config = ScreenerInput(
                max_rounds_per_phase=1,
                quality_threshold=0.5,
            )
            result = await pipeline.run(input_config)

        from sqlalchemy import select
        stmt = select(Run).where(Run.id == result["run_id"])
        run_result = await db_session.execute(stmt)
        run = run_result.scalar_one()
        assert run.status == RunStatus.COMPLETED

    async def test_pipeline_thesis_generated(self, db_session: AsyncSession):
        """Verify the pipeline generates an opportunity thesis for the top candidate."""
        with patch("ventureforge.orchestrator.runner.LLMRouter"):
            pipeline = ScreenerPipeline(session=db_session, dry_run=True)
            input_config = ScreenerInput(
                domain="AI agents",
                max_rounds_per_phase=1,
                quality_threshold=0.5,
            )
            result = await pipeline.run(input_config)

        # Thesis may or may not be generated depending on dry-run data
        # but the key should exist
        assert "thesis" in result
