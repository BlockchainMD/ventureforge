"""BaseSection abstract class for builder sections."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel


class SectionOutput(BaseModel):
    """Base output for any section."""

    section_name: str
    content: dict[str, Any]
    plain_text: str = ""


class BaseSection(ABC):
    """Abstract base for builder section handlers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Section name identifier."""
        ...

    @property
    @abstractmethod
    def order(self) -> int:
        """Build order (1-11)."""
        ...

    @property
    def prompt_key(self) -> str:
        """Prompt registry key for this section."""
        return f"builder.{self.name}.generator"

    @abstractmethod
    def build_context(self, opportunity: dict[str, Any], locked: dict[str, Any]) -> dict[str, Any]:
        """Build template variables for this section's prompt."""
        ...

    def validate_output(self, content: dict[str, Any]) -> bool:
        """Validate section output. Override for section-specific validation."""
        return bool(content)
