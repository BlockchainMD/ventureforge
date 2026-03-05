"""Tests for builder section implementations."""

from __future__ import annotations

import pytest

from ventureforge.builder.sections.base_section import BaseSection, SectionOutput


# ------------------------------------------------------------------
# BaseSection & SectionOutput
# ------------------------------------------------------------------


def test_section_output_model():
    out = SectionOutput(section_name="test", content={"key": "val"})
    assert out.section_name == "test"
    assert out.plain_text == ""


def test_section_output_with_plain_text():
    out = SectionOutput(section_name="x", content={}, plain_text="hello")
    assert out.plain_text == "hello"


class ConcreteSection(BaseSection):
    @property
    def name(self) -> str:
        return "test_section"

    @property
    def order(self) -> int:
        return 99

    def build_context(self, opportunity, locked):
        return {"opp": opportunity, "locked": locked}


def test_base_section_prompt_key():
    s = ConcreteSection()
    assert s.prompt_key == "builder.test_section.generator"


def test_base_section_validate_output():
    s = ConcreteSection()
    assert s.validate_output({"some": "data"}) is True
    assert s.validate_output({}) is False


def test_base_section_build_context():
    s = ConcreteSection()
    ctx = s.build_context({"title": "T"}, {"sec1": {}})
    assert ctx["opp"]["title"] == "T"
    assert "sec1" in ctx["locked"]


# ------------------------------------------------------------------
# Concrete section modules
# ------------------------------------------------------------------

_SECTION_CLASSES = []

def _load_sections():
    from ventureforge.builder.sections.problem_statement import ProblemStatementSection
    from ventureforge.builder.sections.market_sizing import MarketSizingSection
    from ventureforge.builder.sections.competitive_landscape import CompetitiveLandscapeSection
    from ventureforge.builder.sections.solution_architecture import SolutionArchitectureSection
    from ventureforge.builder.sections.business_model import BusinessModelSection
    from ventureforge.builder.sections.go_to_market import GoToMarketSection
    from ventureforge.builder.sections.tech_stack import TechStackSection
    from ventureforge.builder.sections.team_profile import TeamProfileSection
    from ventureforge.builder.sections.financial_projections import FinancialProjectionsSection
    from ventureforge.builder.sections.risk_register import RiskRegisterSection
    from ventureforge.builder.sections.pitch_narrative import PitchNarrativeSection

    return [
        (ProblemStatementSection, "problem_statement", 1),
        (SolutionArchitectureSection, "solution_architecture", 2),
        (MarketSizingSection, "market_sizing", 3),
        (CompetitiveLandscapeSection, "competitive_landscape", 4),
        (BusinessModelSection, "business_model", 5),
        (GoToMarketSection, "go_to_market", 6),
        (TechStackSection, "tech_stack", 7),
        (TeamProfileSection, "team_profile", 8),
        (FinancialProjectionsSection, "financial_projections", 9),
        (RiskRegisterSection, "risk_register", 10),
        (PitchNarrativeSection, "pitch_narrative", 11),
    ]


@pytest.fixture(params=_load_sections(), ids=lambda p: p[1])
def section_info(request):
    return request.param


def test_section_name(section_info):
    cls, expected_name, _ = section_info
    s = cls()
    assert s.name == expected_name


def test_section_order(section_info):
    cls, _, expected_order = section_info
    s = cls()
    assert s.order == expected_order


def test_section_prompt_key(section_info):
    cls, expected_name, _ = section_info
    s = cls()
    assert s.prompt_key == f"builder.{expected_name}.generator"


def test_section_build_context(section_info):
    cls, _, _ = section_info
    s = cls()
    opp = {"title": "Test Opp", "problem_statement": "A problem", "research_data": {}}
    locked = {"problem_statement": {"content": "locked data"}}
    ctx = s.build_context(opp, locked)
    assert isinstance(ctx, dict)
    assert len(ctx) > 0


def test_section_validate_output(section_info):
    cls, _, _ = section_info
    s = cls()
    assert s.validate_output({"key": "val"}) is True
    assert s.validate_output({}) is False
