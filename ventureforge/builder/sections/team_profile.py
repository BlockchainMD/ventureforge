"""TeamProfileSection implementation."""

from __future__ import annotations

from typing import Any

from ventureforge.builder.sections.base_section import BaseSection


class TeamProfileSection(BaseSection):
    """Generates the team profile section."""

    @property
    def name(self) -> str:
        return "team_profile"

    @property
    def order(self) -> int:
        return 8

    def build_context(self, opportunity: dict[str, Any], locked: dict[str, Any]) -> dict[str, Any]:
        return {
            "opportunity": opportunity,
            "tech_stack": locked.get("tech_stack", {}),
            "solution_architecture": locked.get("solution_architecture", {}),
        }
