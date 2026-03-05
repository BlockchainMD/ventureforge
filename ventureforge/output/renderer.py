"""Renders structured JSON to formatted documents."""

from __future__ import annotations

from typing import Any

from ventureforge.builder.assembler import BlueprintAssembler
from ventureforge.utils.logger import get_logger

logger = get_logger()


class DocumentRenderer:
    """Renders structured data into various document formats."""

    def __init__(self) -> None:
        self._assembler = BlueprintAssembler()

    def render_screener_report(self, data: dict[str, Any]) -> str:
        """Render a screener result as a Markdown report."""
        lines = ["# VentureForge Screener Report\n"]

        thesis = data.get("thesis")
        if thesis:
            lines.append("## Top Opportunity\n")
            lines.append(f"### {thesis.get('title', 'Untitled')}\n")
            lines.append(f"**One-liner:** {thesis.get('one_liner', '')}\n")
            lines.append(f"**Problem:** {thesis.get('problem_statement', '')}\n")
            lines.append(f"**Solution:** {thesis.get('solution_concept', '')}\n")
            lines.append(f"**Why Now:** {thesis.get('why_now', '')}\n")
            lines.append(f"**Why Agentic:** {thesis.get('why_agentic', '')}\n")
            lines.append(f"**Market Signal:** {thesis.get('market_signal', '')}\n")
            lines.append(f"**Moat:** {thesis.get('moat_hypothesis', '')}\n")
            lines.append(f"**Biggest Risk:** {thesis.get('biggest_risk', '')}\n")

        opps = data.get("opportunities", [])
        if opps:
            lines.append("\n## All Candidates\n")
            lines.append("| Rank | Title | Score | Status |")
            lines.append("|------|-------|-------|--------|")
            for i, opp in enumerate(opps, 1):
                lines.append(
                    f"| {i} | {opp.get('title', '')} | "
                    f"{opp.get('composite_score', 0):.2f} | "
                    f"{opp.get('status', '')} |"
                )

        return "\n".join(lines)

    def render_blueprint(self, sections: dict[str, dict[str, Any]], title: str = "") -> str:
        """Render a builder blueprint as Markdown."""
        blueprint = self._assembler.assemble(sections, title)
        return self._assembler.render_markdown(blueprint)
