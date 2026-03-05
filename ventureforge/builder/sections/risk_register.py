"""RiskRegisterSection implementation."""

from __future__ import annotations

from typing import Any

from ventureforge.builder.sections.base_section import BaseSection


class RiskRegisterSection(BaseSection):
    """Generates the risk register section."""

    @property
    def name(self) -> str:
        return "risk_register"

    @property
    def order(self) -> int:
        return 10

    def build_context(self, opportunity: dict[str, Any], locked: dict[str, Any]) -> dict[str, Any]:
        return {
            "opportunity": opportunity,
            "locked_sections": locked,
        }
