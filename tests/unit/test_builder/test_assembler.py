"""Tests for BlueprintAssembler."""

from __future__ import annotations

import json

import pytest

from ventureforge.builder.assembler import BlueprintAssembler
from ventureforge.orchestrator.router import BUILDER_SECTIONS


@pytest.fixture
def assembler() -> BlueprintAssembler:
    return BlueprintAssembler()


@pytest.fixture
def sample_sections() -> dict:
    return {
        section: {"overview": f"Content for {section}", "details": ["item1", "item2"]}
        for section in BUILDER_SECTIONS
    }


class TestAssemble:
    def test_assembles_all_sections(self, assembler: BlueprintAssembler, sample_sections: dict):
        blueprint = assembler.assemble(sample_sections, opportunity_title="Test Blueprint")
        assert blueprint["title"] == "Test Blueprint"
        assert len(blueprint["sections"]) == len(BUILDER_SECTIONS)
        assert len(blueprint["table_of_contents"]) == len(BUILDER_SECTIONS)

    def test_default_title(self, assembler: BlueprintAssembler):
        blueprint = assembler.assemble({})
        assert blueprint["title"] == "Business Blueprint"

    def test_sections_ordered_correctly(self, assembler: BlueprintAssembler, sample_sections: dict):
        blueprint = assembler.assemble(sample_sections)
        for i, section in enumerate(blueprint["sections"]):
            assert section["number"] == i + 1
            assert section["key"] == BUILDER_SECTIONS[i]

    def test_missing_sections_have_empty_content(self, assembler: BlueprintAssembler):
        blueprint = assembler.assemble({"problem_statement": {"text": "hello"}})
        # problem_statement should have content, others should be empty dicts
        ps = next(s for s in blueprint["sections"] if s["key"] == "problem_statement")
        assert ps["content"] == {"text": "hello"}
        other = next(s for s in blueprint["sections"] if s["key"] == "market_sizing")
        assert other["content"] == {}

    def test_table_of_contents_has_section_keys(self, assembler: BlueprintAssembler, sample_sections: dict):
        blueprint = assembler.assemble(sample_sections)
        for item in blueprint["table_of_contents"]:
            assert "section_key" in item
            assert "title" in item
            assert "number" in item


class TestRenderMarkdown:
    def test_render_contains_title(self, assembler: BlueprintAssembler, sample_sections: dict):
        blueprint = assembler.assemble(sample_sections, opportunity_title="My Blueprint")
        md = assembler.render_markdown(blueprint)
        assert "# My Blueprint" in md

    def test_render_contains_toc(self, assembler: BlueprintAssembler, sample_sections: dict):
        blueprint = assembler.assemble(sample_sections)
        md = assembler.render_markdown(blueprint)
        assert "Table of Contents" in md

    def test_render_contains_all_sections(self, assembler: BlueprintAssembler, sample_sections: dict):
        blueprint = assembler.assemble(sample_sections)
        md = assembler.render_markdown(blueprint)
        for section_name in BUILDER_SECTIONS:
            title = section_name.replace("_", " ").title()
            assert title in md

    def test_render_handles_string_content(self, assembler: BlueprintAssembler):
        blueprint = {
            "title": "Test",
            "table_of_contents": [],
            "sections": [
                {"number": 1, "key": "test", "title": "Test", "content": "plain text"}
            ],
        }
        md = assembler.render_markdown(blueprint)
        assert "plain text" in md


class TestToJson:
    def test_returns_valid_json(self, assembler: BlueprintAssembler, sample_sections: dict):
        blueprint = assembler.assemble(sample_sections, opportunity_title="JSON Test")
        json_str = assembler.to_json(blueprint)
        parsed = json.loads(json_str)
        assert parsed["title"] == "JSON Test"

    def test_json_is_indented(self, assembler: BlueprintAssembler):
        blueprint = assembler.assemble({})
        json_str = assembler.to_json(blueprint)
        assert "\n" in json_str  # indented JSON has newlines
