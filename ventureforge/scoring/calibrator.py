"""Adjusts rubrics based on feedback signals."""

from __future__ import annotations

from ventureforge.scoring.rubrics import Rubric, ScoringDimension
from ventureforge.utils.logger import get_logger

logger = get_logger()


class RubricCalibrator:
    """Proposes rubric weight adjustments based on user feedback."""

    def propose_adjustment(
        self,
        rubric: Rubric,
        feedback: str,
        dimension_name: str,
        direction: str = "increase",
        amount: float = 0.05,
    ) -> Rubric:
        """Propose a rubric adjustment and return the modified rubric.

        Does not persist - returns a copy for review.
        """
        new_dims: list[ScoringDimension] = []
        target_found = False

        for dim in rubric.dimensions:
            if dim.name == dimension_name:
                target_found = True
                delta = amount if direction == "increase" else -amount
                new_weight = max(0.05, min(0.60, dim.weight + delta))
                new_dims.append(dim.model_copy(update={"weight": new_weight}))
            else:
                new_dims.append(dim.model_copy())

        if not target_found:
            logger.warning("calibration_dimension_not_found", dimension=dimension_name)
            return rubric

        # Renormalize weights to sum to 1.0
        total = sum(d.weight for d in new_dims)
        if total > 0:
            new_dims = [d.model_copy(update={"weight": d.weight / total}) for d in new_dims]

        logger.info(
            "rubric_calibration_proposed",
            phase=rubric.phase,
            dimension=dimension_name,
            direction=direction,
            feedback=feedback[:100],
        )

        return rubric.model_copy(update={"dimensions": new_dims})
