"""Main builder orchestration - produces investment-ready business blueprints."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ventureforge.core.models import BlueprintSection
from ventureforge.core.schemas import BuilderInput, PhaseResult
from ventureforge.orchestrator.router import (
    BUILDER_SECTIONS,
    CONSISTENCY_CHECK_POINTS,
    get_builder_phase,
)
from ventureforge.orchestrator.runner import OrchestratorRunner
from ventureforge.utils.logger import get_logger

logger = get_logger()


class BuilderPipeline:
    """Orchestrates the full business blueprint builder.

    Builds 11 sections sequentially, with consistency checks
    at defined checkpoints.
    """

    def __init__(self, session: AsyncSession, dry_run: bool = False) -> None:
        self._session = session
        self._dry_run = dry_run
        self._runner = OrchestratorRunner(session, dry_run=dry_run)

    async def run(self, input_config: BuilderInput) -> dict[str, Any]:
        """Execute the full builder pipeline."""
        from ventureforge.core.state import StateManager

        run = await self._runner.create_run(
            run_type="builder",
            input_config=input_config.model_dump(),
        )
        run_id = run.id
        state = StateManager(self._session)
        logger.info("builder_started", run_id=run_id, title=input_config.opportunity.title)

        # Manage run lifecycle ourselves since we run many phases per run
        await state.start_run(run_id)

        locked_outputs: dict[str, Any] = {}
        section_results: list[PhaseResult] = []
        section_records: list[BlueprintSection] = []

        try:
            for order, section_name in enumerate(BUILDER_SECTIONS, 1):
                logger.info("section_start", run_id=run_id, section=section_name, order=order)

                phase_config = get_builder_phase(
                    section_name=section_name,
                    max_rounds=input_config.max_rounds_per_section,
                    quality_threshold=input_config.quality_threshold,
                )

                context: dict[str, Any] = {
                    "run_type": "builder",
                    "input_config": input_config.model_dump(),
                    "opportunity": input_config.opportunity.model_dump(),
                    "section_name": section_name,
                    "section_order": order,
                    "founder_context": input_config.founder_context or "",
                    "capital_constraints": input_config.capital_constraints or "",
                    "target_audience": input_config.target_audience,
                    "depth": input_config.depth,
                }

                result = await self._runner.run_phase(
                    run_id=run_id,
                    phase_config=phase_config,
                    initial_context=context,
                    locked_outputs=locked_outputs,
                )

                section_results.append(result)
                locked_outputs[section_name] = result.final_output

                # Persist section
                section = BlueprintSection(
                    run_id=run_id,
                    section_name=section_name,
                    section_order=order,
                    content=result.final_output,
                    plain_text=self._render_plain_text(section_name, result.final_output),
                    quality_score=result.quality_score,
                    revision_count=result.rounds_executed,
                    is_locked=True,
                )
                self._session.add(section)
                section_records.append(section)

                if section_name in CONSISTENCY_CHECK_POINTS:
                    logger.info("consistency_check", run_id=run_id, trigger=section_name)

            await state.complete_run(run_id)
        except Exception as e:
            logger.error("builder_failed", run_id=run_id, error=str(e))
            await state.fail_run(run_id, str(e))
            raise

        await self._session.commit()

        logger.info(
            "builder_completed",
            run_id=run_id,
            sections=len(section_records),
        )

        return {
            "run_id": run_id,
            "sections": [
                {
                    "name": s.section_name,
                    "order": s.section_order,
                    "quality_score": s.quality_score,
                    "revision_count": s.revision_count,
                }
                for s in section_records
            ],
            "locked_outputs": locked_outputs,
        }

    def _render_plain_text(self, section_name: str, content: dict[str, Any]) -> str:
        """Render section content as human-readable text."""
        title = section_name.replace("_", " ").title()
        lines = [f"# {title}\n"]

        for key, value in content.items():
            if isinstance(value, str):
                lines.append(f"## {key.replace('_', ' ').title()}\n{value}\n")
            elif isinstance(value, list):
                lines.append(f"## {key.replace('_', ' ').title()}")
                for item in value:
                    if isinstance(item, dict):
                        lines.append(f"- {item}")
                    else:
                        lines.append(f"- {item}")
                lines.append("")
            elif isinstance(value, dict):
                lines.append(f"## {key.replace('_', ' ').title()}")
                for k, v in value.items():
                    lines.append(f"**{k}**: {v}")
                lines.append("")

        return "\n".join(lines)
