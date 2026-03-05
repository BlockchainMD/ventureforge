"""ConsistencyCheckerAgent - builder-only cross-section coherence validation."""

from __future__ import annotations

import time
from typing import Any

from ventureforge.agents.base import AgentConfig, BaseAgent
from ventureforge.core.schemas import (
    AgentOutput,
    ConsistencyConflict,
    ConsistencyReport,
    RoundContext,
    TokenUsage,
)
from ventureforge.llm.router import LLMRouter
from ventureforge.utils.logger import get_logger

logger = get_logger()


class ConsistencyCheckerAgent(BaseAgent):
    """Validates cross-section coherence in the builder pipeline.

    This agent is used exclusively in the **builder** pipeline.  It
    compares the current section draft against all previously locked
    sections to detect:

    - Contradictory claims (e.g., different TAM numbers in market
      analysis vs. financial model)
    - Inconsistent assumptions (e.g., B2B pricing in one section but
      B2C acquisition strategy in another)
    - Terminology drift (e.g., different names for the same concept)
    - Logical dependencies that are violated

    Returns a :class:`ConsistencyReport` with conflict details.
    """

    def __init__(self, llm_router: LLMRouter, config: AgentConfig) -> None:
        super().__init__(llm_router, config)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(self, context: RoundContext) -> AgentOutput:
        """Check current section against locked sections for consistency."""
        if self.dry_run:
            return self._get_dry_run_output(context)

        # Skip if no locked sections to compare against
        if not context.locked_outputs:
            logger.info(
                "consistency_checker_skip",
                agent=self.name,
                run_id=context.run_id,
                reason="no_locked_sections",
            )
            report = ConsistencyReport(
                is_consistent=True,
                conflicts=[],
                notes="No locked sections to compare against. Skipping consistency check.",
            )
            return self._make_output(content=report.model_dump(), duration=0.0)

        start = time.perf_counter()

        try:
            template_key = f"builder.{context.phase_name}.consistency_checker"
            variables = self._build_variables(context)

            logger.info(
                "consistency_checker_start",
                agent=self.name,
                run_id=context.run_id,
                current_section=context.phase_name,
                locked_section_count=len(context.locked_outputs),
            )

            raw, usage = await self._generate_json(template_key, variables)
            report = self._parse_report(raw)
        except Exception:
            logger.exception(
                "consistency_checker_failed",
                agent=self.name,
                run_id=context.run_id,
            )
            raise

        duration = time.perf_counter() - start
        logger.info(
            "consistency_checker_complete",
            agent=self.name,
            run_id=context.run_id,
            is_consistent=report.is_consistent,
            conflict_count=len(report.conflicts),
            duration=round(duration, 2),
        )

        return self._make_output(
            content=report.model_dump(),
            usage=usage,
            duration=duration,
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _build_variables(self, context: RoundContext) -> dict[str, Any]:
        """Assemble variables for the consistency check prompt."""
        return {
            "current_section_name": context.phase_name,
            "current_section_content": context.current_content,
            "locked_sections": context.locked_outputs,
            "input_config": context.input_config,
            "round_number": context.round_number,
        }

    def _parse_report(self, raw: dict[str, Any]) -> ConsistencyReport:
        """Parse raw LLM output into a ConsistencyReport."""
        conflicts_raw = raw.get("conflicts", [])
        conflicts = [
            ConsistencyConflict.model_validate(c) for c in conflicts_raw
        ]
        return ConsistencyReport(
            is_consistent=raw.get("is_consistent", len(conflicts) == 0),
            conflicts=conflicts,
            notes=raw.get("notes", ""),
        )

    # ------------------------------------------------------------------
    # Dry run
    # ------------------------------------------------------------------

    def _get_dry_run_output(self, context: RoundContext) -> AgentOutput:
        """Return a clean consistency report."""
        report = ConsistencyReport(
            is_consistent=True,
            conflicts=[],
            notes="All sections aligned.",
        )

        return self._make_output(
            content=report.model_dump(),
            usage=TokenUsage(input_tokens=0, output_tokens=0, model="dry-run"),
            duration=0.0,
            raw_text="[dry-run] ConsistencyReport: is_consistent=True, conflicts=[].",
        )
