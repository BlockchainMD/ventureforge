"""CompetitiveLandscapeSection implementation."""

from __future__ import annotations

from typing import Any

from ventureforge.builder.sections.base_section import BaseSection


class CompetitiveLandscapeSection(BaseSection):
    """Generates the competitive landscape section."""

    @property
    def name(self) -> str:
        return "competitive_landscape"

    @property
    def order(self) -> int:
        return 4

    def build_context(self, opportunity: dict[str, Any], locked: dict[str, Any]) -> dict[str, Any]:
        return {
            "opportunity": opportunity,
            "market_sizing": locked.get("market_sizing", {}),
        }
