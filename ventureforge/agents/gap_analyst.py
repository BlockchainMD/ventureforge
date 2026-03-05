"""GapAnalystAgent - screener-only white space and moat detection."""

from __future__ import annotations

import time
from typing import Any

from ventureforge.agents.base import AgentConfig, BaseAgent
from ventureforge.core.schemas import AgentOutput, RoundContext, TokenUsage
from ventureforge.llm.router import LLMRouter
from ventureforge.utils.logger import get_logger

logger = get_logger()


class GapAnalystAgent(BaseAgent):
    """Analyzes candidate opportunities for genuine white space.

    This agent is used exclusively in the **screener** pipeline.  For each
    candidate it evaluates three dimensions:

    - **AI moat** -- does the opportunity have a defensible, genuine
      advantage from agentic AI rather than being a thin wrapper?
    - **Incumbent weakness** -- are existing players structurally unable
      or unwilling to address this problem effectively?
    - **Timing catalysts** -- are there concrete, time-bound events
      (regulatory, technological, market) that create a window now?

    The output is a gap analysis dict keyed by candidate title with
    structured assessments for each dimension.
    """

    def __init__(self, llm_router: LLMRouter, config: AgentConfig) -> None:
        super().__init__(llm_router, config)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(self, context: RoundContext) -> AgentOutput:
        """Analyze candidates for white space, moat, and timing."""
        if self.dry_run:
            return self._get_dry_run_output(context)

        start = time.perf_counter()

        try:
            template_key = f"screener.{context.phase_name}.gap_analyst"
            variables = self._build_variables(context)

            logger.info(
                "gap_analyst_start",
                agent=self.name,
                run_id=context.run_id,
                candidate_count=len(
                    context.current_content.get("candidates", [])
                ),
            )

            result, usage = await self._generate_json(template_key, variables)
        except Exception:
            logger.exception(
                "gap_analyst_failed",
                agent=self.name,
                run_id=context.run_id,
            )
            raise

        duration = time.perf_counter() - start
        logger.info(
            "gap_analyst_complete",
            agent=self.name,
            run_id=context.run_id,
            duration=round(duration, 2),
        )

        return self._make_output(content=result, usage=usage, duration=duration)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _build_variables(self, context: RoundContext) -> dict[str, Any]:
        """Assemble variables for the gap analysis prompt template."""
        return {
            "candidates": context.current_content.get("candidates", []),
            "research_bundle": (
                context.research_bundle.model_dump()
                if context.research_bundle
                else {}
            ),
            "domain": context.input_config.get("domain", "general technology"),
            "constraints": context.input_config.get("constraints", []),
            "anti_patterns": context.input_config.get("anti_patterns", []),
            "previous_rounds": context.previous_rounds,
            "lessons": context.lessons,
        }

    # ------------------------------------------------------------------
    # Dry run
    # ------------------------------------------------------------------

    def _get_dry_run_output(self, context: RoundContext) -> AgentOutput:
        """Return mock gap analysis for each candidate."""
        candidates = context.current_content.get("candidates", [])

        # Build analysis for existing candidates or use defaults
        gap_analyses: list[dict[str, Any]] = []
        sample_titles = [c.get("title", f"Candidate {i}") for i, c in enumerate(candidates)]
        if not sample_titles:
            sample_titles = [
                "AI Compliance Copilot",
                "Agentic RFP Engine",
                "Clinical Trial Matcher",
            ]

        for title in sample_titles:
            gap_analyses.append(
                {
                    "candidate_title": title,
                    "ai_moat": {
                        "score": 7,
                        "assessment": (
                            "Moderate moat through proprietary data flywheel. "
                            "Initial model is reproducible, but accumulated "
                            "domain-specific training data creates compounding advantage."
                        ),
                        "risk": "Early-stage moat is thin; requires rapid data accumulation.",
                    },
                    "incumbent_weakness": {
                        "score": 8,
                        "assessment": (
                            "Legacy players are locked into manual workflows and "
                            "multi-year enterprise contracts. Structural inertia "
                            "prevents rapid pivot to AI-native approach."
                        ),
                        "key_incumbents": ["Legacy Corp A", "Established Tool B"],
                    },
                    "timing_catalysts": {
                        "score": 8,
                        "assessment": (
                            "Regulatory deadline in Q3 2026 creates hard forcing "
                            "function. Concurrent cost pressure from economic "
                            "conditions amplifies urgency."
                        ),
                        "catalysts": [
                            "New regulatory requirements effective Q3 2026",
                            "AI model cost decreasing 40% YoY enabling profitable unit economics",
                        ],
                    },
                    "white_space_verdict": "Strong -- genuine gap exists with defensible timing window.",
                }
            )

        content = {"gap_analyses": gap_analyses}

        return self._make_output(
            content=content,
            usage=TokenUsage(input_tokens=0, output_tokens=0, model="dry-run"),
            duration=0.0,
            raw_text=f"[dry-run] Returned gap analysis for {len(gap_analyses)} candidates.",
        )
