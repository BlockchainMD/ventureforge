"""SolutionArchitectureSection implementation."""

from __future__ import annotations

from typing import Any

from ventureforge.builder.sections.base_section import BaseSection


class SolutionArchitectureSection(BaseSection):
    """Generates the solution architecture section."""

    @property
    def name(self) -> str:
        return "solution_architecture"

    @property
    def order(self) -> int:
        return 2

    def build_context(self, opportunity: dict[str, Any], locked: dict[str, Any]) -> dict[str, Any]:
        return {
            "opportunity": opportunity,
            "problem_statement": locked.get("problem_statement", {}),
        }
