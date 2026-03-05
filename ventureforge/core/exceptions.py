"""Custom exception hierarchy for VentureForge."""

from __future__ import annotations


class VentureForgeError(Exception):
    """Base exception for all VentureForge errors."""


class ConfigError(VentureForgeError):
    """Configuration or environment variable errors."""


class StateTransitionError(VentureForgeError):
    """Invalid state machine transition."""

    def __init__(self, current: str, target: str) -> None:
        self.current = current
        self.target = target
        super().__init__(f"Invalid transition: {current} -> {target}")


class AgentError(VentureForgeError):
    """Errors raised during agent execution."""


class AgentParseError(AgentError):
    """Failed to parse LLM output into typed model."""


class LLMError(VentureForgeError):
    """Errors communicating with LLM providers."""


class LLMRateLimitError(LLMError):
    """Rate limit exceeded on LLM API."""


class ResearchError(VentureForgeError):
    """Errors during web research."""


class ScoringError(VentureForgeError):
    """Errors during output scoring/evaluation."""


class OrchestratorError(VentureForgeError):
    """Errors in orchestration or deliberation loop."""


class PhaseMaxRoundsError(OrchestratorError):
    """Phase exhausted max rounds without meeting quality threshold."""


class RunNotFoundError(VentureForgeError):
    """Requested run ID does not exist."""


class RunNotResumableError(VentureForgeError):
    """Run is not in a resumable state."""


class ExportError(VentureForgeError):
    """Errors during document export."""
