"""Input validation helpers."""

from __future__ import annotations

import uuid


def is_valid_uuid(value: str) -> bool:
    """Check if a string is a valid UUID."""
    try:
        uuid.UUID(value)
        return True
    except (ValueError, AttributeError):
        return False


def validate_score_range(score: float, min_val: float = 0.0, max_val: float = 10.0) -> float:
    """Clamp a score to valid range."""
    return max(min_val, min(max_val, score))
