"""SynthesizerAgent - integrates critique and research into refined output."""

from __future__ import annotations

import time
from typing import Any

from ventureforge.agents.base import AgentConfig, BaseAgent
from ventureforge.core.schemas import AgentOutput, RoundContext, TokenUsage
from ventureforge.llm.router import LLMRouter
from ventureforge.utils.logger import get_logger

logger = get_logger()


class SynthesizerAgent(BaseAgent):
    """Integrates generator output with critique feedback and research data.

    The synthesizer acts as the *revision engine* in the deliberation loop.
    It receives:

    - The generator's draft output (from ``current_content``)
    - The critic's structured feedback (from ``previous_rounds``)
    - Any research data (from ``research_bundle``)

    and produces an improved version that addresses the critique while
    preserving the strongest elements of the original.
    """

    def __init__(self, llm_router: LLMRouter, config: AgentConfig) -> None:
        super().__init__(llm_router, config)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(self, context: RoundContext) -> AgentOutput:
        """Synthesize critique and research into a refined draft."""
        if self.dry_run:
            return self._get_dry_run_output(context)

        start = time.perf_counter()

        try:
            template_key = self._resolve_template(context)
            variables = self._build_variables(context)

            logger.info(
                "synthesizer_start",
                agent=self.name,
                run_id=context.run_id,
                template=template_key,
                phase=context.phase_name,
            )

            result, usage = await self._generate_json(template_key, variables)
        except Exception:
            logger.exception(
                "synthesizer_failed",
                agent=self.name,
                run_id=context.run_id,
            )
            raise

        duration = time.perf_counter() - start
        logger.info(
            "synthesizer_complete",
            agent=self.name,
            run_id=context.run_id,
            duration=round(duration, 2),
        )

        return self._make_output(content=result, usage=usage, duration=duration)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _resolve_template(self, context: RoundContext) -> str:
        """Determine the prompt template key for synthesis."""
        if context.run_type == "screener":
            return f"screener.{context.phase_name}.synthesizer"
        return f"builder.{context.phase_name}.synthesizer"

    def _build_variables(self, context: RoundContext) -> dict[str, Any]:
        """Assemble variables for the synthesis prompt template."""
        # Extract the most recent critique from previous rounds
        critique = self._extract_latest_critique(context)

        return {
            "current_content": context.current_content,
            "critique": critique,
            "research_bundle": (
                context.research_bundle.model_dump()
                if context.research_bundle
                else {}
            ),
            "locked_outputs": context.locked_outputs,
            "previous_rounds": context.previous_rounds,
            "input_config": context.input_config,
            "round_number": context.round_number,
            "lessons": context.lessons,
        }

    def _extract_latest_critique(self, context: RoundContext) -> dict[str, Any]:
        """Pull the most recent critic output from previous rounds."""
        for round_data in reversed(context.previous_rounds):
            agent_outputs = round_data.get("agent_outputs", {})
            if "critic" in agent_outputs:
                return agent_outputs["critic"].get("content", {})
        return {}

    # ------------------------------------------------------------------
    # Dry run
    # ------------------------------------------------------------------

    def _get_dry_run_output(self, context: RoundContext) -> AgentOutput:
        """Return the generator output with minor improvements noted."""
        # Start from existing content and annotate improvements
        improved_content = dict(context.current_content)
        improved_content["_synthesis_notes"] = {
            "improvements_applied": [
                "Strengthened moat hypothesis with additional evidence points.",
                "Revised TAM estimate with bottoms-up analysis methodology.",
                "Clarified go-to-market timeline based on critic feedback.",
            ],
            "critique_items_addressed": 3,
            "critique_items_deferred": 0,
            "research_insights_integrated": 2,
        }

        return self._make_output(
            content=improved_content,
            usage=TokenUsage(input_tokens=0, output_tokens=0, model="dry-run"),
            duration=0.0,
            raw_text="[dry-run] Returned generator output with synthesis improvements.",
        )
