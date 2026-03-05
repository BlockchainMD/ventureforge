"""ScorerAgent - evaluates output quality and makes loop/advance/escalate decisions."""

from __future__ import annotations

import time
from typing import Any

from ventureforge.agents.base import AgentConfig, BaseAgent
from ventureforge.core.schemas import (
    AgentOutput,
    DimensionScore,
    RoundContext,
    RoundScores,
    TokenUsage,
)
from ventureforge.llm.router import LLMRouter
from ventureforge.utils.logger import get_logger

logger = get_logger()


class ScorerAgent(BaseAgent):
    """Evaluates current output quality against rubrics and decides next action.

    The scorer examines the current content (post-synthesis if available)
    and scores it across multiple quality dimensions using the configured
    rubric.  Based on the composite score and the phase's quality
    threshold, it returns one of three decisions:

    - **advance** -- quality meets or exceeds the threshold
    - **loop** -- quality is below threshold; another deliberation round needed
    - **escalate** -- fundamental issues detected that require human review
    """

    def __init__(self, llm_router: LLMRouter, config: AgentConfig) -> None:
        super().__init__(llm_router, config)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(self, context: RoundContext) -> AgentOutput:
        """Score the current output and decide on loop/advance/escalate."""
        if self.dry_run:
            return self._get_dry_run_output(context)

        start = time.perf_counter()

        try:
            template_key = self._resolve_template(context)
            variables = self._build_variables(context)

            logger.info(
                "scorer_start",
                agent=self.name,
                run_id=context.run_id,
                template=template_key,
                phase=context.phase_name,
            )

            raw, usage = await self._generate_json(template_key, variables)
            scores = RoundScores.model_validate(raw)
        except Exception:
            logger.exception(
                "scorer_failed",
                agent=self.name,
                run_id=context.run_id,
            )
            raise

        duration = time.perf_counter() - start
        logger.info(
            "scorer_complete",
            agent=self.name,
            run_id=context.run_id,
            composite_score=scores.composite_score,
            decision=scores.decision,
            duration=round(duration, 2),
        )

        return self._make_output(
            content=scores.model_dump(),
            usage=usage,
            duration=duration,
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _resolve_template(self, context: RoundContext) -> str:
        """Determine the prompt template key for scoring."""
        if context.run_type == "screener":
            return f"screener.{context.phase_name}.scorer"
        return f"builder.{context.phase_name}.scorer"

    def _build_variables(self, context: RoundContext) -> dict[str, Any]:
        """Assemble variables for the scoring prompt template."""
        quality_threshold = context.input_config.get("quality_threshold", 0.82)

        return {
            "current_content": context.current_content,
            "previous_rounds": context.previous_rounds,
            "locked_outputs": context.locked_outputs,
            "research_bundle": (
                context.research_bundle.model_dump()
                if context.research_bundle
                else {}
            ),
            "input_config": context.input_config,
            "round_number": context.round_number,
            "quality_threshold": quality_threshold,
            "lessons": context.lessons,
        }

    # ------------------------------------------------------------------
    # Dry run
    # ------------------------------------------------------------------

    def _get_dry_run_output(self, context: RoundContext) -> AgentOutput:
        """Return mock scores of 7.5 and decision 'advance'."""
        dimension_scores = [
            DimensionScore(
                dimension="problem_clarity",
                score=7.5,
                weight=0.20,
                evidence="Problem statement is specific and addresses a real pain point.",
                justification="Clear articulation of the compliance burden for fintech startups.",
            ),
            DimensionScore(
                dimension="market_opportunity",
                score=7.5,
                weight=0.20,
                evidence="Market size estimates are grounded in analyst reports.",
                justification="TAM/SAM/SOM framework applied with reasonable assumptions.",
            ),
            DimensionScore(
                dimension="defensibility",
                score=7.5,
                weight=0.20,
                evidence="Moat hypothesis relies on data network effects.",
                justification="Reasonable but needs further validation with domain experts.",
            ),
            DimensionScore(
                dimension="timing",
                score=7.5,
                weight=0.20,
                evidence="Regulatory catalysts create a clear window of opportunity.",
                justification="New SEC rules and EU AI Act provide concrete timing anchors.",
            ),
            DimensionScore(
                dimension="execution_feasibility",
                score=7.5,
                weight=0.20,
                evidence="Technical approach is well-defined with realistic milestones.",
                justification="MVP scope is achievable within stated timeline and budget.",
            ),
        ]

        scores = RoundScores(
            dimension_scores=dimension_scores,
            composite_score=7.5,
            decision="advance",
            decision_rationale=(
                "Composite score of 7.5 meets the quality threshold. "
                "All dimensions score above minimum. Advancing to next phase."
            ),
        )

        return self._make_output(
            content=scores.model_dump(),
            usage=TokenUsage(input_tokens=0, output_tokens=0, model="dry-run"),
            duration=0.0,
            raw_text="[dry-run] Returned scores of 7.5 with decision 'advance'.",
        )
