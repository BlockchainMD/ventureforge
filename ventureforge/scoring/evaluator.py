"""Applies rubrics to agent outputs for scoring."""

from __future__ import annotations

import json
from typing import Any

from ventureforge.core.schemas import DimensionScore, RoundScores
from ventureforge.llm.router import LLMRouter
from ventureforge.scoring.rubrics import Rubric, get_rubric
from ventureforge.utils.logger import get_logger

logger = get_logger()


class Evaluator:
    """Evaluates agent outputs against scoring rubrics."""

    def __init__(self, llm_router: LLMRouter) -> None:
        self._llm = llm_router

    async def evaluate(
        self,
        phase: str,
        output: dict[str, Any],
        context: dict[str, Any] | None = None,
        rubric: Rubric | None = None,
    ) -> RoundScores:
        """Score an output against its phase rubric."""
        rubric = rubric or get_rubric(phase)
        return await self._score_with_llm(rubric, output, context or {})

    async def _score_with_llm(
        self,
        rubric: Rubric,
        output: dict[str, Any],
        context: dict[str, Any],
    ) -> RoundScores:
        """Use LLM to score output against rubric dimensions."""
        dimensions_desc = "\n".join(
            f"- {d.name} (weight {d.weight}): {d.description}"
            for d in rubric.dimensions
        )
        scoring_guides = "\n".join(
            f"{d.name}: " + ", ".join(f"{k}={v}" for k, v in d.scoring_guide.items())
            for d in rubric.dimensions
            if d.scoring_guide
        )

        system_prompt = (
            "You are a rigorous evaluator. Score the given output on each dimension.\n"
            "For each dimension, extract specific evidence from the output, reference the "
            "scoring guide, and assign a score 0-10 with explicit justification.\n"
            "Return JSON: {\"scores\": [{\"dimension\": name, \"score\": N, \"evidence\": "
            "\"...\", \"justification\": \"...\"}], \"composite_score\": N, "
            "\"decision\": \"loop|advance|escalate\", \"decision_rationale\": \"...\"}"
        )

        user_prompt = (
            f"Phase: {rubric.phase}\n"
            f"Advancement threshold: {rubric.advancement_threshold}\n\n"
            f"Scoring dimensions:\n{dimensions_desc}\n\n"
            f"Scoring guides:\n{scoring_guides}\n\n"
            f"Output to evaluate:\n{json.dumps(output, indent=2)[:6000]}"
        )

        try:
            data, usage = await self._llm.generate_json(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                model_hint="fast_extraction",
                max_tokens=2000,
                temperature=0.3,
            )
            return self._parse_scores(data, rubric)
        except Exception as e:
            logger.warning("evaluation_failed", phase=rubric.phase, error=str(e))
            return self._default_scores(rubric)

    def _parse_scores(self, data: dict[str, Any], rubric: Rubric) -> RoundScores:
        """Parse LLM scoring response into RoundScores."""
        dimension_scores: list[DimensionScore] = []
        weights = {d.name: d.weight for d in rubric.dimensions}

        for item in data.get("scores", []):
            dim_name = item.get("dimension", "")
            dimension_scores.append(
                DimensionScore(
                    dimension=dim_name,
                    score=min(10.0, max(0.0, float(item.get("score", 0)))),
                    weight=weights.get(dim_name, 0.0),
                    evidence=item.get("evidence", ""),
                    justification=item.get("justification", ""),
                )
            )

        composite = data.get("composite_score", 0.0)
        if not composite and dimension_scores:
            total_weight = sum(ds.weight for ds in dimension_scores) or 1.0
            composite = sum(ds.score * ds.weight for ds in dimension_scores) / total_weight

        # Normalize to 0-1 scale
        composite_normalized = composite / 10.0

        decision = data.get("decision", "loop")
        if decision not in ("loop", "advance", "escalate"):
            decision = "advance" if composite_normalized >= rubric.advancement_threshold else "loop"

        return RoundScores(
            dimension_scores=dimension_scores,
            composite_score=composite_normalized,
            decision=decision,
            decision_rationale=data.get("decision_rationale", ""),
        )

    def _default_scores(self, rubric: Rubric) -> RoundScores:
        """Return default scores when evaluation fails."""
        return RoundScores(
            dimension_scores=[
                DimensionScore(
                    dimension=d.name,
                    score=5.0,
                    weight=d.weight,
                    evidence="Evaluation failed",
                    justification="Default score due to evaluation error",
                )
                for d in rubric.dimensions
            ],
            composite_score=0.5,
            decision="loop",
            decision_rationale="Evaluation failed, defaulting to loop",
        )


def evaluate_dry_run(phase: str) -> RoundScores:
    """Return mock scores for dry-run mode."""
    rubric = get_rubric(phase)
    return RoundScores(
        dimension_scores=[
            DimensionScore(
                dimension=d.name,
                score=7.5,
                weight=d.weight,
                evidence="Dry run - mock evaluation",
                justification="Dry run mode - automatic pass",
            )
            for d in rubric.dimensions
        ],
        composite_score=0.85,
        decision="advance",
        decision_rationale="Dry run mode - automatic advancement",
    )
