"""CriticAgent - adversarial critique from a skeptical VC perspective."""

from __future__ import annotations

import time
from typing import Any

from ventureforge.agents.base import AgentConfig, BaseAgent
from ventureforge.core.schemas import (
    AgentOutput,
    CritiqueOutput,
    RoundContext,
    TokenUsage,
)
from ventureforge.llm.router import LLMRouter
from ventureforge.utils.logger import get_logger

logger = get_logger()

# VC archetypes that rotate based on context to surface diverse concerns
_VC_ARCHETYPES: list[dict[str, str]] = [
    {
        "name": "Technical Founder VC",
        "perspective": (
            "You are a technical founder turned VC. You obsess over defensible "
            "technology, architectural choices, and whether the team can actually "
            "build what they claim. You are skeptical of 'AI wrapper' businesses "
            "and demand genuine technical moat."
        ),
    },
    {
        "name": "GTM-First VC",
        "perspective": (
            "You are a go-to-market focused VC. You care about distribution "
            "advantages, sales motion clarity, customer acquisition cost, and "
            "whether the founders understand their buyer deeply. Technology is "
            "table stakes; distribution wins."
        ),
    },
    {
        "name": "Financial Rigor VC",
        "perspective": (
            "You are a finance-first VC partner. You demand clear unit economics, "
            "realistic TAM sizing backed by bottoms-up analysis, defensible "
            "pricing, and a path to capital efficiency. Handwaving around revenue "
            "projections is a red flag."
        ),
    },
    {
        "name": "Contrarian Thesis VC",
        "perspective": (
            "You are a contrarian thesis-driven VC. You look for non-obvious "
            "insights, challenge consensus narratives, and ask 'what does this "
            "founder believe that most people think is wrong?' You push back on "
            "trend-following and demand unique insight."
        ),
    },
]


class CriticAgent(BaseAgent):
    """Provides adversarial critique from a skeptical Series A VC partner.

    The agent rotates through four VC archetypes based on the round number
    to ensure diverse critical perspectives across deliberation rounds:

    - **Technical Founder VC** -- deep-tech moat scrutiny
    - **GTM-First VC** -- distribution and go-to-market pressure
    - **Financial Rigor VC** -- unit economics and TAM validation
    - **Contrarian Thesis VC** -- non-obvious insight challenge

    Returns a :class:`CritiqueOutput` with structured fatal flaws,
    major concerns, minor notes, strongest elements, and a summary.
    """

    def __init__(self, llm_router: LLMRouter, config: AgentConfig) -> None:
        super().__init__(llm_router, config)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(self, context: RoundContext) -> AgentOutput:
        """Critique the current content from a VC perspective."""
        if self.dry_run:
            return self._get_dry_run_output(context)

        start = time.perf_counter()

        try:
            archetype = self._select_archetype(context)
            template_key = self._resolve_template(context)
            variables = self._build_variables(context, archetype)

            logger.info(
                "critic_start",
                agent=self.name,
                run_id=context.run_id,
                archetype=archetype["name"],
                template=template_key,
            )

            raw, usage = await self._generate_json(template_key, variables)
            critique = CritiqueOutput.model_validate(raw)
        except Exception:
            logger.exception(
                "critic_failed",
                agent=self.name,
                run_id=context.run_id,
            )
            raise

        duration = time.perf_counter() - start
        logger.info(
            "critic_complete",
            agent=self.name,
            run_id=context.run_id,
            fatal_flaws=len(critique.fatal_flaws),
            major_concerns=len(critique.major_concerns),
            duration=round(duration, 2),
        )

        return self._make_output(
            content=critique.model_dump(),
            usage=usage,
            duration=duration,
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _select_archetype(self, context: RoundContext) -> dict[str, str]:
        """Rotate VC archetype based on the round number."""
        index = context.round_number % len(_VC_ARCHETYPES)
        return _VC_ARCHETYPES[index]

    def _resolve_template(self, context: RoundContext) -> str:
        """Determine the prompt template key for the critique."""
        if context.run_type == "screener":
            return f"screener.{context.phase_name}.critic"
        return f"builder.{context.phase_name}.critic"

    def _build_variables(
        self, context: RoundContext, archetype: dict[str, str]
    ) -> dict[str, Any]:
        """Assemble variables for the critique prompt template."""
        return {
            "vc_archetype_name": archetype["name"],
            "vc_perspective": archetype["perspective"],
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
            "lessons": context.lessons,
        }

    # ------------------------------------------------------------------
    # Dry run
    # ------------------------------------------------------------------

    def _get_dry_run_output(self, context: RoundContext) -> AgentOutput:
        """Return mock critique with realistic structure."""
        critique = CritiqueOutput(
            fatal_flaws=[
                "No evidence of proprietary data advantage -- the proposed AI model "
                "can be replicated by any well-funded incumbent within 6 months.",
            ],
            major_concerns=[
                "TAM sizing relies on top-down estimates with no bottoms-up "
                "validation from actual customer conversations.",
                "The go-to-market strategy assumes enterprise sales cycles of 30 days, "
                "which is unrealistic for regulated industries.",
            ],
            minor_notes=[
                "Comparable company list omits two well-funded stealth competitors "
                "known to be operating in adjacent spaces.",
                "Financial projections assume 90% gross margins from month one, "
                "which ignores cloud compute costs for AI inference.",
            ],
            strongest_elements=[
                "The timing thesis around new regulatory requirements is well-argued "
                "and supported by concrete policy timelines.",
                "Target customer persona is specific and actionable -- the ICP is "
                "clear enough to build a prospect list today.",
            ],
            summary=(
                "The opportunity shows promising timing alignment but lacks "
                "defensibility. The biggest risk is commoditisation by incumbents "
                "who already own the customer relationship. Recommend deepening "
                "the moat hypothesis and validating TAM with bottoms-up analysis "
                "before advancing."
            ),
        )

        return self._make_output(
            content=critique.model_dump(),
            usage=TokenUsage(input_tokens=0, output_tokens=0, model="dry-run"),
            duration=0.0,
            raw_text="[dry-run] Returned mock critique with 1 fatal flaw, 2 major concerns.",
        )
