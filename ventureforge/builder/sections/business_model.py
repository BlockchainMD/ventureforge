"""BusinessModelSection implementation."""

from __future__ import annotations

from typing import Any

from ventureforge.builder.sections.base_section import BaseSection


class BusinessModelSection(BaseSection):
    """Generates the business model section."""

    @property
    def name(self) -> str:
        return "business_model"

    @property
    def order(self) -> int:
        return 5

    def build_context(self, opportunity: dict[str, Any], locked: dict[str, Any]) -> dict[str, Any]:
        return {
            "opportunity": opportunity,
            "market_sizing": locked.get("market_sizing", {}),
            "competitive_landscape": locked.get("competitive_landscape", {}),
        }
