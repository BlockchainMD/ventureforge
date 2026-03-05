"""FinancialProjectionsSection implementation."""

from __future__ import annotations

from typing import Any

from ventureforge.builder.sections.base_section import BaseSection


class FinancialProjectionsSection(BaseSection):
    """Generates the financial projections section."""

    @property
    def name(self) -> str:
        return "financial_projections"

    @property
    def order(self) -> int:
        return 9

    def build_context(self, opportunity: dict[str, Any], locked: dict[str, Any]) -> dict[str, Any]:
        return {
            "opportunity": opportunity,
            "business_model": locked.get("business_model", {}),
            "go_to_market": locked.get("go_to_market", {}),
        }
