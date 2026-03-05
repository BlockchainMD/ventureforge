"""Tests for PromptRegistry."""

from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
import yaml

from ventureforge.llm.prompts.registry import PromptRegistry, PromptTemplate


@pytest.fixture
def registry() -> PromptRegistry:
    return PromptRegistry()


@pytest.fixture
def sample_template() -> PromptTemplate:
    return PromptTemplate({
        "key": "test.sample",
        "version": 1,
        "model_hint": "fast_extraction",
        "system_prompt": "You are a $role.",
        "user_prompt_template": "Analyze $topic.",
        "max_tokens": 2048,
        "temperature": 0.5,
    })


class TestPromptRegistry:
    def test_register_and_get(self, registry: PromptRegistry, sample_template: PromptTemplate):
        registry.register("test.sample", sample_template)
        retrieved = registry.get("test.sample")
        assert retrieved.key == "test.sample"
        assert retrieved.model_hint == "fast_extraction"

    def test_has(self, registry: PromptRegistry, sample_template: PromptTemplate):
        assert registry.has("test.sample") is False
        registry.register("test.sample", sample_template)
        assert registry.has("test.sample") is True

    def test_keys(self, registry: PromptRegistry, sample_template: PromptTemplate):
        assert registry.keys() == []
        registry.register("test.sample", sample_template)
        registry.register("test.other", sample_template)
        assert sorted(registry.keys()) == ["test.other", "test.sample"]

    def test_get_missing_raises_key_error(self, registry: PromptRegistry):
        with pytest.raises(KeyError, match="not found"):
            registry.get("nonexistent")

    def test_load_all_from_directory(self):
        with TemporaryDirectory() as tmpdir:
            # Create a YAML prompt file
            prompt_data = {
                "key": "test.loaded",
                "version": 1,
                "system_prompt": "System prompt",
                "user_prompt_template": "User prompt",
            }
            yaml_path = Path(tmpdir) / "test_prompt.yaml"
            with open(yaml_path, "w") as f:
                yaml.dump(prompt_data, f)

            registry = PromptRegistry()
            registry.load_all(Path(tmpdir))

            assert registry.has("test.loaded")
            tmpl = registry.get("test.loaded")
            assert tmpl.system_prompt == "System prompt"

    def test_load_all_ignores_invalid_yaml(self):
        with TemporaryDirectory() as tmpdir:
            # Create a YAML file without 'key'
            bad_path = Path(tmpdir) / "bad.yaml"
            with open(bad_path, "w") as f:
                f.write("not_a_key: value\n")

            registry = PromptRegistry()
            registry.load_all(Path(tmpdir))
            assert registry.keys() == []


class TestPromptTemplate:
    def test_render_system(self, sample_template: PromptTemplate):
        result = sample_template.render_system(role="analyst")
        assert result == "You are a analyst."

    def test_render_user(self, sample_template: PromptTemplate):
        result = sample_template.render_user(topic="fintech")
        assert result == "Analyze fintech."

    def test_safe_substitute_missing_var(self, sample_template: PromptTemplate):
        # safe_substitute leaves unknown vars as-is
        result = sample_template.render_system()
        assert "$role" in result

    def test_defaults(self):
        tmpl = PromptTemplate({"key": "minimal"})
        assert tmpl.version == 1
        assert tmpl.model_hint == "deep_reasoning"
        assert tmpl.max_tokens == 4096
        assert tmpl.temperature == 0.7
