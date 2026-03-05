"""Tests for output exporters."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from ventureforge.output.json_exporter import export_json
from ventureforge.output.renderer import DocumentRenderer


def test_json_export(tmp_path):
    data = {"run_id": "test-123", "type": "screener"}
    with patch("ventureforge.output.json_exporter.get_settings") as mock_settings:
        mock_settings.return_value.output_dir = str(tmp_path)
        path = export_json(data, "test.json")
    assert path.exists()
    with open(path) as f:
        loaded = json.load(f)
    assert loaded["run_id"] == "test-123"


def test_renderer_screener_report():
    renderer = DocumentRenderer()
    data = {
        "thesis": {
            "title": "Test Opportunity",
            "one_liner": "A great idea",
            "problem_statement": "Problem exists",
            "market_signal": "$10B TAM",
        },
        "opportunities": [
            {"title": "Opp 1", "composite_score": 0.85, "status": "selected"},
        ],
    }
    md = renderer.render_screener_report(data)
    assert "Test Opportunity" in md
    assert "Opp 1" in md


def test_renderer_blueprint():
    renderer = DocumentRenderer()
    sections = {
        "problem_statement": {"core_problem": "Test problem"},
        "solution_architecture": {"approach": "Test solution"},
    }
    md = renderer.render_blueprint(sections, "Test Blueprint")
    assert "Test Blueprint" in md
    assert "Problem Statement" in md
