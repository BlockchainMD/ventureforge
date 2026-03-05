"""MarketSizingSection implementation."""

from __future__ import annotations

from typing import Any

from ventureforge.builder.sections.base_section import BaseSection


class MarketSizingSection(BaseSection):
    """Generates the market sizing section."""

    @property
    def name(self) -> str:
        return "market_sizing"

    @property
    def order(self) -> int:
        return 3

    def build_context(self, opportunity: dict[str, Any], locked: dict[str, Any]) -> dict[str, Any]:
        return {
            "opportunity": opportunity,
            "problem_statement": locked.get("problem_statement", {}),
            "solution_architecture": locked.get("solution_architecture", {}),
        }
