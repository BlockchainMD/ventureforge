"""Main screener orchestration."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ventureforge.core.models import Opportunity, OpportunityStatus
from ventureforge.core.schemas import OpportunityThesis, PhaseResult, ScreenerInput
from ventureforge.orchestrator.router import get_screener_phases
from ventureforge.orchestrator.runner import OrchestratorRunner
from ventureforge.utils.logger import get_logger

logger = get_logger()


class ScreenerPipeline:
    """Orchestrates the full business screening pipeline.

    Phases:
    1. Horizon Scan - generate 20-30 candidates, shortlist to 8
    2. Deep Dive - research each shortlisted candidate
    3. Gap Analysis - white space and moat scoring
    4. Final Ranking - produce ranked list with opportunity thesis
    """

    def __init__(self, session: AsyncSession, dry_run: bool = False) -> None:
        self._session = session
        self._dry_run = dry_run
        self._runner = OrchestratorRunner(session, dry_run=dry_run)

    async def run(self, input_config: ScreenerInput) -> dict[str, Any]:
        """Execute the full screener pipeline."""
        # Create run
        run = await self._runner.create_run(
            run_type="screener",
            input_config=input_config.model_dump(),
        )
        run_id = run.id
        logger.info("screener_started", run_id=run_id, domain=input_config.domain)

        # Get phase configs
        phases = get_screener_phases(
            max_rounds=input_config.max_rounds_per_phase,
            quality_threshold=input_config.quality_threshold,
        )

        # Build initial context
        context: dict[str, Any] = {
            "run_type": "screener",
            "input_config": input_config.model_dump(),
            "domain": input_config.domain or "open exploration",
            "constraints": input_config.constraints,
            "anti_patterns": input_config.anti_patterns,
            "candidate_count": 25,
            "max_candidates": input_config.max_candidates,
        }

        # Run all phases
        results = await self._runner.run_phases(run_id, phases, context)

        # Extract opportunities from results
        opportunities = self._extract_opportunities(run_id, results)

        # Persist opportunities
        for opp in opportunities:
            self._session.add(opp)
        await self._session.commit()

        # Build final thesis for top candidate
        thesis = self._build_thesis(results)

        logger.info(
            "screener_completed",
            run_id=run_id,
            opportunity_count=len(opportunities),
        )

        return {
            "run_id": run_id,
            "opportunities": [
                {
                    "id": opp.id,
                    "title": opp.title,
                    "composite_score": opp.composite_score,
                    "status": opp.status.value,
                    "problem_space": opp.problem_space,
                }
                for opp in opportunities
            ],
            "thesis": thesis.model_dump() if thesis else None,
            "phase_results": [r.model_dump() for r in results],
        }

    def _find_candidates(self, output: dict[str, Any]) -> list[dict[str, Any]]:
        """Recursively search for candidate lists in output."""
        if "candidates" in output and isinstance(output["candidates"], list):
            return output["candidates"]
        # Search in nested dicts (agent outputs may nest content)
        for _key, val in output.items():
            if isinstance(val, dict):
                found = self._find_candidates(val)
                if found:
                    return found
            elif isinstance(val, list) and val and isinstance(val[0], dict):
                if "title" in val[0] and "problem_space" in val[0]:
                    return val
        return []

    def _extract_opportunities(
        self, run_id: str, results: list[PhaseResult]
    ) -> list[Opportunity]:
        """Extract opportunity records from phase results."""
        opportunities: list[Opportunity] = []

        for result in results:
            output = result.final_output
            candidates = self._find_candidates(output)

            for i, candidate in enumerate(candidates):
                opp = Opportunity(
                    run_id=run_id,
                    title=candidate.get("title", f"Opportunity {i + 1}"),
                    phase_introduced=result.phase_name,
                    problem_space=candidate.get("problem_space", ""),
                    target_customer=candidate.get("target_customer", ""),
                    ai_moat_description=candidate.get("why_agentic", ""),
                    scores=candidate.get("scores", {}),
                    composite_score=candidate.get("composite_score", 0.0),
                    research_data=candidate.get("research_data", {}),
                    status=OpportunityStatus.CANDIDATE,
                )

                # Mark top candidates as shortlisted
                if i < 8 and opp.composite_score >= 6.5:
                    opp.status = OpportunityStatus.SHORTLISTED

                opportunities.append(opp)

        # Mark the best as selected
        if opportunities:
            best = max(opportunities, key=lambda o: o.composite_score)
            best.status = OpportunityStatus.SELECTED

        return opportunities

    def _build_thesis(self, results: list[PhaseResult]) -> OpportunityThesis | None:
        """Build an opportunity thesis from the final ranking."""
        if not results:
            return None

        final = results[-1].final_output
        thesis_data = final.get("thesis")
        if thesis_data:
            try:
                return OpportunityThesis.model_validate(thesis_data)
            except Exception:
                pass

        # Build from available data
        candidates = self._find_candidates(final)
        if not candidates:
            for r in reversed(results):
                candidates = self._find_candidates(r.final_output)
                if candidates:
                    break

        if not candidates:
            return None

        best = candidates[0] if candidates else {}
        return OpportunityThesis(
            title=best.get("title", "Untitled Opportunity"),
            one_liner=best.get("one_liner", ""),
            problem_statement=best.get("problem_space", ""),
            solution_concept=best.get("solution_concept", ""),
            why_now=best.get("timing_signal", ""),
            why_agentic=best.get("why_agentic", ""),
            market_signal=best.get("market_signal", ""),
            moat_hypothesis=best.get("moat_hypothesis", ""),
            biggest_risk=best.get("biggest_risk", ""),
            comparable_companies=best.get("comparable_companies", []),
            recommended_first_customer=best.get("recommended_first_customer", ""),
        )
