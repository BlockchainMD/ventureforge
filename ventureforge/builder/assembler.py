"""Combines all sections into final blueprint document."""

from __future__ import annotations

import json
from typing import Any

from ventureforge.orchestrator.router import BUILDER_SECTIONS
from ventureforge.utils.logger import get_logger

logger = get_logger()


class BlueprintAssembler:
    """Assembles locked sections into a complete blueprint document."""

    def assemble(
        self,
        sections: dict[str, dict[str, Any]],
        opportunity_title: str = "",
    ) -> dict[str, Any]:
        """Assemble all sections into a structured blueprint.

        Args:
            sections: Dict mapping section_name -> section content
            opportunity_title: Title for the blueprint

        Returns:
            Complete blueprint as structured dict
        """
        blueprint: dict[str, Any] = {
            "title": opportunity_title or "Business Blueprint",
            "version": "1.0",
            "sections": [],
            "table_of_contents": [],
        }

        for i, section_name in enumerate(BUILDER_SECTIONS, 1):
            content = sections.get(section_name, {})
            section_title = section_name.replace("_", " ").title()

            blueprint["table_of_contents"].append(
                {"number": i, "title": section_title, "section_key": section_name}
            )

            blueprint["sections"].append(
                {
                    "number": i,
                    "key": section_name,
                    "title": section_title,
                    "content": content,
                }
            )

        logger.info("blueprint_assembled", sections=len(blueprint["sections"]))
        return blueprint

    def render_markdown(self, blueprint: dict[str, Any]) -> str:
        """Render blueprint as Markdown document."""
        lines = [f"# {blueprint['title']}\n"]

        # Table of contents
        lines.append("## Table of Contents\n")
        for item in blueprint["table_of_contents"]:
            lines.append(f"{item['number']}. [{item['title']}](#{item['section_key']})")
        lines.append("")

        # Sections
        for section in blueprint["sections"]:
            lines.append(f"---\n\n## {section['number']}. {section['title']}\n")
            content = section["content"]
            if isinstance(content, dict):
                lines.append(self._render_content(content))
            elif isinstance(content, str):
                lines.append(content)
            lines.append("")

        return "\n".join(lines)

    def _render_content(self, content: dict[str, Any], depth: int = 3) -> str:
        """Recursively render content dict as Markdown."""
        lines = []
        prefix = "#" * min(depth, 6)

        for key, value in content.items():
            heading = key.replace("_", " ").title()
            if isinstance(value, str):
                lines.append(f"{prefix} {heading}\n\n{value}\n")
            elif isinstance(value, list):
                lines.append(f"{prefix} {heading}\n")
                for item in value:
                    if isinstance(item, dict):
                        for k, v in item.items():
                            lines.append(f"- **{k}**: {v}")
                    else:
                        lines.append(f"- {item}")
                lines.append("")
            elif isinstance(value, dict):
                lines.append(f"{prefix} {heading}\n")
                lines.append(self._render_content(value, depth + 1))
            else:
                lines.append(f"**{heading}**: {value}\n")

        return "\n".join(lines)

    def to_json(self, blueprint: dict[str, Any]) -> str:
        """Export blueprint as formatted JSON."""
        return json.dumps(blueprint, indent=2, default=str)
