"""PDF export via reportlab."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from ventureforge.core.config import get_settings
from ventureforge.utils.logger import get_logger

logger = get_logger()


def export_pdf(markdown_content: str, filename: str, title: str = "VentureForge Report") -> Path:
    """Export Markdown content as a PDF file."""
    output_dir = Path(get_settings().output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    filepath = output_dir / filename

    doc = SimpleDocTemplate(
        str(filepath),
        pagesize=letter,
        leftMargin=inch,
        rightMargin=inch,
        topMargin=inch,
        bottomMargin=inch,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "CustomTitle", parent=styles["Title"], fontSize=24, spaceAfter=30
    )
    heading_style = ParagraphStyle(
        "CustomHeading", parent=styles["Heading2"], fontSize=16, spaceAfter=12, spaceBefore=20
    )
    body_style = ParagraphStyle(
        "CustomBody", parent=styles["Normal"], fontSize=11, leading=16, spaceAfter=8
    )

    elements: list[Any] = [Paragraph(title, title_style), Spacer(1, 20)]

    for line in markdown_content.split("\n"):
        line = line.strip()
        if not line:
            elements.append(Spacer(1, 6))
            continue

        # Escape XML special chars for reportlab
        safe = line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

        if line.startswith("## "):
            elements.append(Paragraph(safe[3:], heading_style))
        elif line.startswith("# "):
            elements.append(Paragraph(safe[2:], title_style))
        elif line.startswith("- "):
            elements.append(Paragraph(f"\u2022 {safe[2:]}", body_style))
        elif line.startswith("|"):
            # Skip markdown table syntax
            continue
        else:
            # Handle bold markers
            safe = safe.replace("**", "<b>", 1).replace("**", "</b>", 1)
            elements.append(Paragraph(safe, body_style))

    doc.build(elements)
    logger.info("pdf_exported", path=str(filepath))
    return filepath
