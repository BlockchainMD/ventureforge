"""TechStackSection implementation."""

from __future__ import annotations

from typing import Any

from ventureforge.builder.sections.base_section import BaseSection


class TechStackSection(BaseSection):
    """Generates the tech stack section."""

    @property
    def name(self) -> str:
        return "tech_stack"

    @property
    def order(self) -> int:
        return 7

    def build_context(self, opportunity: dict[str, Any], locked: dict[str, Any]) -> dict[str, Any]:
        return {
            "opportunity": opportunity,
            "solution_architecture": locked.get("solution_architecture", {}),
        }
