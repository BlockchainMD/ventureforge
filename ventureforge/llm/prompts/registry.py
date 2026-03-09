"""Central prompt registry with YAML loading and versioning."""

from __future__ import annotations

from pathlib import Path
from string import Template
from typing import Any

import yaml

from ventureforge.utils.logger import get_logger

logger = get_logger()

PROMPTS_DIR = Path(__file__).parent


class PromptTemplate:
    """A loaded prompt template from YAML."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.key: str = data["key"]
        self.version: int = data.get("version", 1)
        self.model_hint: str = data.get("model_hint", "deep_reasoning")
        self.system_prompt: str = data.get("system_prompt", "")
        self.user_prompt_template: str = data.get("user_prompt_template", "")
        self.output_schema: str = data.get("output_schema", "")
        self.max_tokens: int = data.get("max_tokens", 4096)
        self.temperature: float = data.get("temperature", 0.7)
        self.notes: str = data.get("notes", "")

    def render_system(self, **kwargs: Any) -> str:
        """Render system prompt with variables."""
        return Template(self.system_prompt).safe_substitute(**kwargs)

    def render_user(self, **kwargs: Any) -> str:
        """Render user prompt with variables."""
        return Template(self.user_prompt_template).safe_substitute(**kwargs)


class PromptRegistry:
    """Loads and manages all prompt templates."""

    def __init__(self) -> None:
        self._prompts: dict[str, PromptTemplate] = {}

    def load_all(self, base_dir: Path | None = None) -> None:
        """Load all YAML prompt files from the prompts directory."""
        search_dir = base_dir or PROMPTS_DIR
        for yaml_path in search_dir.rglob("*.yaml"):
            try:
                with open(yaml_path) as f:
                    data = yaml.safe_load(f)
                if data and "key" in data:
                    template = PromptTemplate(data)
                    self._prompts[template.key] = template
                    logger.debug("prompt_loaded", key=template.key, version=template.version)
            except Exception as e:
                logger.warning("prompt_load_failed", path=str(yaml_path), error=str(e))

    def get(self, key: str) -> PromptTemplate:
        """Get a prompt template by key, with role-based fallback.

        Lookup order for a key like ``screener.horizon_scan.critic``:
        1. Exact match
        2. ``shared.critic`` (role fallback)
        """
        if key in self._prompts:
            return self._prompts[key]
        # Fallback: shared.<role>
        parts = key.rsplit(".", 1)
        if len(parts) == 2:
            role = parts[1]
            fallback = f"shared.{role}"
            if fallback in self._prompts:
                return self._prompts[fallback]
        raise KeyError(f"Prompt '{key}' not found in registry. Available: {list(self._prompts.keys())}")

    def has(self, key: str) -> bool:
        """Check if a prompt key exists."""
        return key in self._prompts

    def keys(self) -> list[str]:
        """List all registered prompt keys."""
        return list(self._prompts.keys())

    def register(self, key: str, template: PromptTemplate) -> None:
        """Manually register a prompt template."""
        self._prompts[key] = template


# Singleton registry
_registry: PromptRegistry | None = None


def get_registry() -> PromptRegistry:
    """Get or create the singleton prompt registry."""
    global _registry  # noqa: PLW0603
    if _registry is None:
        _registry = PromptRegistry()
        _registry.load_all()
    return _registry
