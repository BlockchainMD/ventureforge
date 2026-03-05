"""BaseAgent abstract class for all VentureForge agents."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel

from ventureforge.core.exceptions import AgentParseError
from ventureforge.core.schemas import AgentOutput, RoundContext, TokenUsage
from ventureforge.llm.prompts.registry import PromptTemplate, get_registry
from ventureforge.llm.router import LLMRouter
from ventureforge.utils.logger import get_logger

logger = get_logger()


class AgentConfig(BaseModel):
    """Configuration for an agent."""

    name: str
    dry_run: bool = False
    max_parse_retries: int = 3


class BaseAgent(ABC):
    """Abstract base for all VentureForge agents."""

    def __init__(self, llm_router: LLMRouter, config: AgentConfig) -> None:
        self._llm = llm_router
        self._config = config
        self._registry = get_registry()

    @property
    def name(self) -> str:
        """Agent name."""
        return self._config.name

    @property
    def dry_run(self) -> bool:
        """Whether in dry-run mode."""
        return self._config.dry_run

    @abstractmethod
    async def run(self, context: RoundContext) -> AgentOutput:
        """Execute the agent's task. Must be implemented by subclasses."""
        ...

    @abstractmethod
    def _get_dry_run_output(self, context: RoundContext) -> AgentOutput:
        """Return mock output for dry-run mode."""
        ...

    def _build_prompt(self, template_key: str, variables: dict[str, Any]) -> tuple[str, str]:
        """Fetch prompt from registry and render with variables.

        Returns (system_prompt, user_prompt).
        """
        template = self._registry.get(template_key)
        system = template.render_system(**variables)
        user = template.render_user(**variables)
        return system, user

    def _get_template(self, template_key: str) -> PromptTemplate:
        """Get a prompt template by key."""
        return self._registry.get(template_key)

    async def _generate_json(
        self,
        template_key: str,
        variables: dict[str, Any],
        model_hint: str | None = None,
    ) -> tuple[dict[str, Any], TokenUsage]:
        """Generate JSON output using a prompt template."""
        template = self._get_template(template_key)
        system, user = self._build_prompt(template_key, variables)
        hint = model_hint or template.model_hint
        return await self._llm.generate_json(
            system_prompt=system,
            user_prompt=user,
            model_hint=hint,
            max_tokens=template.max_tokens,
            temperature=template.temperature,
        )

    def _parse_output(
        self, raw_data: dict[str, Any], schema: type[BaseModel], retries_left: int = 3
    ) -> BaseModel:
        """Parse a dict into a typed Pydantic model.

        Raises AgentParseError if parsing fails after retries.
        """
        try:
            return schema.model_validate(raw_data)
        except Exception as e:
            if retries_left > 0:
                logger.warning(
                    "parse_retry",
                    agent=self.name,
                    error=str(e),
                    retries_left=retries_left - 1,
                )
                # Try with relaxed validation
                return self._parse_output(raw_data, schema, retries_left - 1)
            raise AgentParseError(
                f"Agent {self.name} failed to parse output: {e}"
            ) from e

    def _make_output(
        self,
        content: dict[str, Any],
        usage: TokenUsage | None = None,
        duration: float = 0.0,
        raw_text: str = "",
    ) -> AgentOutput:
        """Create a standardized AgentOutput."""
        return AgentOutput(
            agent_name=self.name,
            content=content,
            raw_text=raw_text,
            token_usage=usage or TokenUsage(),
            duration_seconds=duration,
        )
