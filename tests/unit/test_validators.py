"""Tests for utility modules."""

from __future__ import annotations

from ventureforge.utils.validators import is_valid_uuid, validate_score_range
from ventureforge.utils.token_counter import count_tokens


def test_valid_uuid():
    assert is_valid_uuid("550e8400-e29b-41d4-a716-446655440000")
    assert not is_valid_uuid("not-a-uuid")
    assert not is_valid_uuid("")


def test_validate_score_range():
    assert validate_score_range(5.0) == 5.0
    assert validate_score_range(-1.0) == 0.0
    assert validate_score_range(15.0) == 10.0
    assert validate_score_range(0.5, min_val=0.0, max_val=1.0) == 0.5


def test_count_tokens():
    count = count_tokens("Hello, world!")
    assert count > 0
    assert isinstance(count, int)
