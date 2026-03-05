"""ProblemStatementSection implementation."""

from __future__ import annotations

from typing import Any

from ventureforge.builder.sections.base_section import BaseSection


class ProblemStatementSection(BaseSection):
    """Generates the problem statement section."""

    @property
    def name(self) -> str:
        return "problem_statement"

    @property
    def order(self) -> int:
        return 1

    def build_context(self, opportunity: dict[str, Any], locked: dict[str, Any]) -> dict[str, Any]:
        return {
            "title": opportunity.get("title", ""),
            "problem_statement": opportunity.get("problem_statement", ""),
            "research_data": opportunity.get("research_data", {}),
        }
