"""Tests for PDF and DOCX exporters."""

from __future__ import annotations

from unittest.mock import patch

import pytest


def test_pdf_export(tmp_path):
    with patch("ventureforge.output.pdf_exporter.get_settings") as mock_settings:
        mock_settings.return_value.output_dir = str(tmp_path)
        from ventureforge.output.pdf_exporter import export_pdf

        path = export_pdf("# Test\n\nHello world", "test.pdf", "Test Report")
        assert path.exists()
        assert path.suffix == ".pdf"
        assert path.stat().st_size > 0


def test_docx_export(tmp_path):
    with patch("ventureforge.output.docx_exporter.get_settings") as mock_settings:
        mock_settings.return_value.output_dir = str(tmp_path)
        from ventureforge.output.docx_exporter import export_docx

        path = export_docx("# Test\n\n## Section\n\n- Item 1\n- Item 2", "test.docx")
        assert path.exists()
        assert path.suffix == ".docx"
        assert path.stat().st_size > 0
