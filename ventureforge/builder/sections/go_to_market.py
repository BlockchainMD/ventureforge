"""GoToMarketSection implementation."""

from __future__ import annotations

from typing import Any

from ventureforge.builder.sections.base_section import BaseSection


class GoToMarketSection(BaseSection):
    """Generates the go-to-market section."""

    @property
    def name(self) -> str:
        return "go_to_market"

    @property
    def order(self) -> int:
        return 6

    def build_context(self, opportunity: dict[str, Any], locked: dict[str, Any]) -> dict[str, Any]:
        return {
            "opportunity": opportunity,
            "business_model": locked.get("business_model", {}),
            "competitive_landscape": locked.get("competitive_landscape", {}),
        }
