"""Integration test: BuilderPipeline with dry_run=True."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from ventureforge.builder.builder import BuilderPipeline
from ventureforge.core.models import BlueprintSection, Run, RunStatus
from ventureforge.core.schemas import BuilderInput, OpportunityThesis
from ventureforge.orchestrator.router import BUILDER_SECTIONS


@pytest.fixture
def builder_input(sample_opportunity: dict) -> BuilderInput:
    """Create a BuilderInput from the sample_opportunity fixture."""
    thesis = OpportunityThesis.model_validate(sample_opportunity)
    return BuilderInput(
        opportunity=thesis,
        founder_context="Solo technical founder with ML background",
        capital_constraints="$500K pre-seed budget",
        target_audience="seed VC",
        depth="investor_ready",
        max_rounds_per_section=1,
        quality_threshold=0.5,
    )


class TestBuilderPipelineDryRun:
    async def test_pipeline_creates_run(
        self, db_session: AsyncSession, builder_input: BuilderInput
    ):
        """Verify the pipeline creates a run record."""
        with patch("ventureforge.orchestrator.runner.LLMRouter"):
            pipeline = BuilderPipeline(session=db_session, dry_run=True)
            result = await pipeline.run(builder_input)

        assert "run_id" in result
        assert result["run_id"] is not None

    async def test_pipeline_generates_all_sections(
        self, db_session: AsyncSession, builder_input: BuilderInput
    ):
        """Verify all 11 builder sections are generated."""
        with patch("ventureforge.orchestrator.runner.LLMRouter"):
            pipeline = BuilderPipeline(session=db_session, dry_run=True)
            result = await pipeline.run(builder_input)

        sections = result.get("sections", [])
        assert len(sections) == len(BUILDER_SECTIONS)

        section_names = {s["name"] for s in sections}
        assert section_names == set(BUILDER_SECTIONS)

    async def test_pipeline_sections_have_quality_scores(
        self, db_session: AsyncSession, builder_input: BuilderInput
    ):
        """Verify each section has a quality score."""
        with patch("ventureforge.orchestrator.runner.LLMRouter"):
            pipeline = BuilderPipeline(session=db_session, dry_run=True)
            result = await pipeline.run(builder_input)

        for section in result["sections"]:
            assert "quality_score" in section
            assert "revision_count" in section

    async def test_pipeline_locked_outputs(
        self, db_session: AsyncSession, builder_input: BuilderInput
    ):
        """Verify locked_outputs contains all sections."""
        with patch("ventureforge.orchestrator.runner.LLMRouter"):
            pipeline = BuilderPipeline(session=db_session, dry_run=True)
            result = await pipeline.run(builder_input)

        locked = result.get("locked_outputs", {})
        for section_name in BUILDER_SECTIONS:
            assert section_name in locked

    async def test_pipeline_persists_blueprint_sections(
        self, db_session: AsyncSession, builder_input: BuilderInput
    ):
        """Verify BlueprintSection records are persisted to DB."""
        with patch("ventureforge.orchestrator.runner.LLMRouter"):
            pipeline = BuilderPipeline(session=db_session, dry_run=True)
            result = await pipeline.run(builder_input)

        from sqlalchemy import select
        stmt = select(BlueprintSection).where(
            BlueprintSection.run_id == result["run_id"]
        )
        db_result = await db_session.execute(stmt)
        sections = db_result.scalars().all()
        assert len(sections) == len(BUILDER_SECTIONS)

        for section in sections:
            assert section.is_locked is True

    async def test_pipeline_run_completes(
        self, db_session: AsyncSession, builder_input: BuilderInput
    ):
        """Verify the run ends in COMPLETED status."""
        with patch("ventureforge.orchestrator.runner.LLMRouter"):
            pipeline = BuilderPipeline(session=db_session, dry_run=True)
            result = await pipeline.run(builder_input)

        from sqlalchemy import select
        stmt = select(Run).where(Run.id == result["run_id"])
        run_result = await db_session.execute(stmt)
        run = run_result.scalar_one()
        assert run.status == RunStatus.COMPLETED
        assert run.run_type == "builder"
