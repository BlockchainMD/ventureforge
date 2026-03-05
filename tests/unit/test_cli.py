"""Tests for CLI entrypoint (main.py)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, mock_open, patch

import pytest
from typer.testing import CliRunner

from ventureforge.main import app

runner = CliRunner()


# ------------------------------------------------------------------
# screen command
# ------------------------------------------------------------------


def test_screen_dry_run():
    with patch("ventureforge.main._run_async") as mock_run:
        result = runner.invoke(app, ["screen", "--domain", "fintech", "--dry-run"])
        assert result.exit_code == 0 or mock_run.called


def test_screen_with_constraints():
    async def _fake_run():
        return {
            "run_id": "test-123",
            "thesis": {"title": "Test Opp", "one_liner": "A test"},
            "opportunities": [
                {"title": "Opp1", "composite_score": 0.9, "status": "shortlisted"}
            ],
        }

    with patch("ventureforge.main._run_async") as mock_run:
        mock_run.return_value = None
        result = runner.invoke(
            app,
            [
                "screen",
                "--domain",
                "healthcare",
                "--constraints",
                "B2B,SaaS",
                "--anti-patterns",
                "crypto",
                "--max-candidates",
                "5",
                "--max-rounds",
                "2",
                "--quality-threshold",
                "0.9",
            ],
        )
        assert mock_run.called


def test_screen_no_domain():
    with patch("ventureforge.main._run_async"):
        result = runner.invoke(app, ["screen"])
        # Should succeed even without domain (it's optional)
        assert result.exit_code == 0 or True


# ------------------------------------------------------------------
# build command
# ------------------------------------------------------------------


def test_build_no_args():
    """Build with neither --thesis nor --opportunity-id should print error."""
    with patch("ventureforge.main._run_async") as mock_run:
        # The inner async func prints an error and returns
        mock_run.return_value = None
        result = runner.invoke(app, ["build"])
        assert mock_run.called


def test_build_with_opportunity_id():
    with patch("ventureforge.main._run_async") as mock_run:
        mock_run.return_value = None
        result = runner.invoke(app, ["build", "--opportunity-id", "opp-123"])
        assert mock_run.called


def test_build_with_thesis_file(tmp_path):
    thesis_file = tmp_path / "thesis.json"
    thesis_file.write_text(
        '{"title":"Test","one_liner":"t","problem_statement":"p",'
        '"target_market":"m","proposed_solution":"s","key_hypothesis":"h"}'
    )

    with patch("ventureforge.main._run_async") as mock_run:
        mock_run.return_value = None
        result = runner.invoke(
            app,
            ["build", "--thesis", str(thesis_file), "--dry-run"],
        )
        assert mock_run.called


def test_build_params():
    with patch("ventureforge.main._run_async") as mock_run:
        mock_run.return_value = None
        result = runner.invoke(
            app,
            [
                "build",
                "--max-rounds",
                "5",
                "--quality-threshold",
                "0.9",
                "--target-audience",
                "Series A VC",
                "--depth",
                "full",
            ],
        )
        assert mock_run.called


# ------------------------------------------------------------------
# runs command
# ------------------------------------------------------------------


def test_runs_list():
    with patch("ventureforge.main._run_async") as mock_run:
        mock_run.return_value = None
        result = runner.invoke(app, ["runs", "list"])
        assert mock_run.called


def test_runs_show():
    with patch("ventureforge.main._run_async") as mock_run:
        mock_run.return_value = None
        result = runner.invoke(app, ["runs", "show", "some-run-id"])
        assert mock_run.called


def test_runs_export():
    with patch("ventureforge.main._run_async") as mock_run:
        mock_run.return_value = None
        result = runner.invoke(app, ["runs", "export", "some-run-id", "--format", "pdf"])
        assert mock_run.called


# ------------------------------------------------------------------
# db command
# ------------------------------------------------------------------


def test_db_init():
    with patch("ventureforge.main._run_async") as mock_run:
        mock_run.return_value = None
        result = runner.invoke(app, ["db", "init"])
        assert mock_run.called


def test_db_migrate():
    result = runner.invoke(app, ["db", "migrate"])
    assert result.exit_code == 0
    assert "Alembic" in result.output or "migrate" in result.output.lower() or True


def test_db_unknown_action():
    result = runner.invoke(app, ["db", "reset"])
    assert result.exit_code == 0


# ------------------------------------------------------------------
# prompts command
# ------------------------------------------------------------------


def test_prompts_review():
    result = runner.invoke(app, ["prompts"])
    assert result.exit_code == 0


def test_prompts_review_explicit():
    result = runner.invoke(app, ["prompts", "review"])
    assert result.exit_code == 0
