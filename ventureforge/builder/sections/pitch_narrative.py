"""PitchNarrativeSection implementation."""

from __future__ import annotations

from typing import Any

from ventureforge.builder.sections.base_section import BaseSection


class PitchNarrativeSection(BaseSection):
    """Generates the pitch narrative section."""

    @property
    def name(self) -> str:
        return "pitch_narrative"

    @property
    def order(self) -> int:
        return 11

    def build_context(self, opportunity: dict[str, Any], locked: dict[str, Any]) -> dict[str, Any]:
        return {
            "opportunity": opportunity,
            "locked_sections": locked,
        }
