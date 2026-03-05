"""MetaAgent - post-run retrospective and prompt improvement."""

from __future__ import annotations

import time
from typing import Any

from ventureforge.agents.base import AgentConfig, BaseAgent
from ventureforge.core.schemas import AgentOutput, RoundContext, TokenUsage
from ventureforge.llm.router import LLMRouter
from ventureforge.utils.logger import get_logger

logger = get_logger()


class MetaAgent(BaseAgent):
    """Performs post-run retrospective analysis and proposes improvements.

    The MetaAgent runs **after** a full deliberation run completes.  It
    analyses the entire sequence of rounds to:

    - Identify recurring patterns in critique feedback
    - Detect quality score plateaus or regressions
    - Propose :class:`Lesson` records for future runs
    - Suggest concrete prompt improvements for underperforming agents
    - Flag phases that consistently require many rounds

    The output includes a structured retrospective summary, proposed
    lessons, and prompt improvement suggestions.
    """

    def __init__(self, llm_router: LLMRouter, config: AgentConfig) -> None:
        super().__init__(llm_router, config)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(self, context: RoundContext) -> AgentOutput:
        """Analyse the full run and produce a retrospective."""
        if self.dry_run:
            return self._get_dry_run_output(context)

        start = time.perf_counter()

        try:
            template_key = "meta.retrospective"
            variables = self._build_variables(context)

            logger.info(
                "meta_agent_start",
                agent=self.name,
                run_id=context.run_id,
                round_count=len(context.previous_rounds),
            )

            result, usage = await self._generate_json(template_key, variables)
        except Exception:
            logger.exception(
                "meta_agent_failed",
                agent=self.name,
                run_id=context.run_id,
            )
            raise

        duration = time.perf_counter() - start

        lesson_count = len(result.get("proposed_lessons", []))
        prompt_improvement_count = len(result.get("prompt_improvements", []))
        logger.info(
            "meta_agent_complete",
            agent=self.name,
            run_id=context.run_id,
            proposed_lessons=lesson_count,
            prompt_improvements=prompt_improvement_count,
            duration=round(duration, 2),
        )

        return self._make_output(content=result, usage=usage, duration=duration)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _build_variables(self, context: RoundContext) -> dict[str, Any]:
        """Assemble the full run history for retrospective analysis."""
        return {
            "run_id": context.run_id,
            "run_type": context.run_type,
            "all_rounds": context.previous_rounds,
            "locked_outputs": context.locked_outputs,
            "input_config": context.input_config,
            "existing_lessons": context.lessons,
            "final_content": context.current_content,
        }

    # ------------------------------------------------------------------
    # Dry run
    # ------------------------------------------------------------------

    def _get_dry_run_output(self, context: RoundContext) -> AgentOutput:
        """Return a mock retrospective summary."""
        content: dict[str, Any] = {
            "retrospective_summary": (
                "The run completed in a reasonable number of rounds. "
                "The critic consistently flagged TAM validation as a weakness, "
                "which the synthesizer addressed by round 3. The scorer showed "
                "steady improvement from 6.2 to 7.5 across rounds. No phases "
                "required escalation."
            ),
            "patterns_identified": [
                {
                    "pattern": "TAM validation was the most frequently cited concern across all rounds.",
                    "frequency": 3,
                    "resolution": "Addressed in round 3 via bottoms-up analysis methodology.",
                },
                {
                    "pattern": "Moat hypothesis improved iteratively but could benefit from earlier research.",
                    "frequency": 2,
                    "resolution": "Partially resolved; recommend earlier research agent involvement.",
                },
            ],
            "proposed_lessons": [
                {
                    "category": "process",
                    "insight": "Running the researcher agent before the first critic round reduces critique-loop iterations by ~1 round.",
                    "applies_to": ["screener", "builder"],
                },
                {
                    "category": "quality",
                    "insight": "Bottoms-up TAM analysis should be a required component of the generator's initial output to avoid repeated critique cycles.",
                    "applies_to": ["screener"],
                },
            ],
            "prompt_improvements": [
                {
                    "agent": "generator",
                    "template": "screener.horizon_scan.generator",
                    "suggestion": "Add explicit instruction to include bottoms-up TAM estimate for each candidate.",
                    "expected_impact": "Reduce average rounds in scoring phase by 1.",
                },
                {
                    "agent": "critic",
                    "template": "screener.horizon_scan.critic",
                    "suggestion": "Include guidance to acknowledge when TAM is already bottoms-up validated rather than re-flagging.",
                    "expected_impact": "Reduce false-positive critique items by ~20%.",
                },
            ],
            "quality_trajectory": {
                "initial_score": 6.2,
                "final_score": 7.5,
                "rounds_to_threshold": 3,
                "score_by_round": [6.2, 6.8, 7.5],
            },
        }

        return self._make_output(
            content=content,
            usage=TokenUsage(input_tokens=0, output_tokens=0, model="dry-run"),
            duration=0.0,
            raw_text="[dry-run] Returned mock retrospective with 2 lessons and 2 prompt improvements.",
        )
