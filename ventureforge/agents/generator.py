"""GeneratorAgent - generates candidate ideas (screener) or section drafts (builder)."""

from __future__ import annotations

import time
from typing import Any

from ventureforge.agents.base import AgentConfig, BaseAgent
from ventureforge.core.schemas import AgentOutput, RoundContext, TokenUsage
from ventureforge.llm.router import LLMRouter
from ventureforge.utils.logger import get_logger

logger = get_logger()

# Default candidate count range for screener horizon scan
_MIN_CANDIDATES = 20
_MAX_CANDIDATES = 30


class GeneratorAgent(BaseAgent):
    """Generates candidate opportunity ideas (screener) or section drafts (builder).

    In *screener* mode (phase ``horizon_scan``), the agent uses the
    ``screener.horizon_scan.generator`` prompt template and produces
    20-30 raw candidate opportunities.

    In *builder* mode, the agent uses a template whose key matches the
    current section name (e.g. ``builder.<section>.generator``) and
    produces a structured section draft.
    """

    def __init__(self, llm_router: LLMRouter, config: AgentConfig) -> None:
        super().__init__(llm_router, config)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(self, context: RoundContext) -> AgentOutput:
        """Generate candidates or a section draft depending on run type."""
        if self.dry_run:
            return self._get_dry_run_output(context)

        start = time.perf_counter()

        try:
            if context.run_type == "screener":
                result, usage = await self._generate_screener(context)
            else:
                result, usage = await self._generate_builder(context)
        except Exception:
            logger.exception(
                "generator_run_failed",
                agent=self.name,
                run_id=context.run_id,
                phase=context.phase_name,
            )
            raise

        duration = time.perf_counter() - start
        logger.info(
            "generator_complete",
            agent=self.name,
            run_id=context.run_id,
            duration=round(duration, 2),
        )
        return self._make_output(content=result, usage=usage, duration=duration)

    # ------------------------------------------------------------------
    # Screener generation
    # ------------------------------------------------------------------

    async def _generate_screener(
        self, context: RoundContext
    ) -> tuple[dict[str, Any], TokenUsage]:
        """Generate candidate opportunities for the screener pipeline."""
        template_key = "screener.horizon_scan.generator"
        variables = self._screener_variables(context)

        logger.info(
            "generator_screener_start",
            agent=self.name,
            template=template_key,
            run_id=context.run_id,
        )

        result, usage = await self._generate_json(template_key, variables)

        # Validate we got a reasonable number of candidates
        candidates = result.get("candidates", [])
        if len(candidates) < _MIN_CANDIDATES:
            logger.warning(
                "generator_low_candidate_count",
                agent=self.name,
                count=len(candidates),
                expected_min=_MIN_CANDIDATES,
            )

        return result, usage

    def _screener_variables(self, context: RoundContext) -> dict[str, Any]:
        """Build template variables for screener generation."""
        input_cfg = context.input_config
        return {
            "domain": input_cfg.get("domain", "general technology"),
            "constraints": input_cfg.get("constraints", []),
            "anti_patterns": input_cfg.get("anti_patterns", []),
            "target_funding_stage": input_cfg.get(
                "target_funding_stage", "pre-seed to Series A"
            ),
            "geography": input_cfg.get("geography", "US-first"),
            "exclude_ids": input_cfg.get("exclude_opportunity_ids", []),
            "min_candidates": _MIN_CANDIDATES,
            "max_candidates": _MAX_CANDIDATES,
            "previous_rounds": context.previous_rounds,
            "lessons": context.lessons,
        }

    # ------------------------------------------------------------------
    # Builder generation
    # ------------------------------------------------------------------

    async def _generate_builder(
        self, context: RoundContext
    ) -> tuple[dict[str, Any], TokenUsage]:
        """Generate a section draft for the builder pipeline."""
        section_name = context.phase_name
        template_key = f"builder.{section_name}.generator"
        variables = self._builder_variables(context)

        logger.info(
            "generator_builder_start",
            agent=self.name,
            template=template_key,
            section=section_name,
            run_id=context.run_id,
        )

        result, usage = await self._generate_json(template_key, variables)
        return result, usage

    def _builder_variables(self, context: RoundContext) -> dict[str, Any]:
        """Build template variables for builder section generation."""
        return {
            "opportunity": context.input_config.get("opportunity", {}),
            "founder_context": context.input_config.get("founder_context", ""),
            "capital_constraints": context.input_config.get("capital_constraints", ""),
            "target_audience": context.input_config.get("target_audience", "seed VC"),
            "depth": context.input_config.get("depth", "investor_ready"),
            "locked_sections": context.locked_outputs,
            "previous_rounds": context.previous_rounds,
            "current_content": context.current_content,
            "research_bundle": (
                context.research_bundle.model_dump()
                if context.research_bundle
                else {}
            ),
            "lessons": context.lessons,
        }

    # ------------------------------------------------------------------
    # Dry run
    # ------------------------------------------------------------------

    def _get_dry_run_output(self, context: RoundContext) -> AgentOutput:
        """Return realistic mock data for testing."""
        candidates = [
            {
                "title": "AI-Powered Compliance Copilot for Fintech Startups",
                "problem_space": "Regulatory compliance automation",
                "target_customer": "Fintech founders and compliance officers",
                "why_agentic": "Autonomous monitoring, rule interpretation, and filing",
                "timing_signal": "New SEC digital-asset rules taking effect Q2 2026",
                "estimated_severity": 8,
                "evidence": "3 of top-5 YC fintech cohort cited compliance cost as #1 blocker",
            },
            {
                "title": "Agentic RFP Response Engine for Mid-Market SaaS",
                "problem_space": "Sales proposal automation",
                "target_customer": "Sales teams at 50-500 person B2B SaaS companies",
                "why_agentic": "End-to-end draft, review, and submit cycle with human-in-loop",
                "timing_signal": "Enterprise buyers increasingly mandate structured RFPs",
                "estimated_severity": 7,
                "evidence": "Average RFP takes 30 person-hours; win rates under 20%",
            },
            {
                "title": "Autonomous Clinical Trial Matching Platform",
                "problem_space": "Healthcare patient-trial matching",
                "target_customer": "Clinical research organisations and hospital networks",
                "why_agentic": "Continuous EHR scanning, eligibility parsing, outreach",
                "timing_signal": "FDA push for decentralised trials and diverse enrolment",
                "estimated_severity": 9,
                "evidence": "80% of trials miss enrolment timelines; $8B annual industry cost",
            },
            {
                "title": "AI Supply-Chain Exception Handler",
                "problem_space": "Supply chain risk management",
                "target_customer": "Operations leaders at D2C and e-commerce brands",
                "why_agentic": "Real-time disruption detection, rerouting, vendor negotiation",
                "timing_signal": "Post-pandemic supply chain volatility remains elevated",
                "estimated_severity": 7,
                "evidence": "Average brand loses 5-10% revenue to stockouts and delays",
            },
            {
                "title": "Agentic Code Migration Factory",
                "problem_space": "Legacy codebase modernisation",
                "target_customer": "Engineering VPs at enterprises with COBOL/Java6 debt",
                "why_agentic": "Automated refactor, test generation, incremental deployment",
                "timing_signal": "COBOL developer shortage reaching crisis; mainframe costs rising",
                "estimated_severity": 8,
                "evidence": "US banks spend $15B+ annually maintaining legacy COBOL systems",
            },
        ]

        content = {"candidates": candidates}
        return self._make_output(
            content=content,
            usage=TokenUsage(input_tokens=0, output_tokens=0, model="dry-run"),
            duration=0.0,
            raw_text="[dry-run] Generated 5 sample candidate opportunities.",
        )
