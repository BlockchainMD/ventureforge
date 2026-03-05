# Agent Guide

## Overview

All agents in VentureForge extend `BaseAgent` from `ventureforge/agents/base.py`. Agents are stateless processors that receive a `RoundContext` and return an `AgentOutput`.

## Existing Agents

| Agent | Role | Model | Used In |
|-------|------|-------|---------|
| GeneratorAgent | Produces initial content/ideas | claude-opus-4-6 | Both |
| ResearcherAgent | Gathers web data | claude-sonnet-4-6 | Both |
| CriticAgent | Adversarial critique | claude-opus-4-6 | Both |
| SynthesizerAgent | Integrates feedback | claude-opus-4-6 | Both |
| ScorerAgent | Evaluates quality | claude-sonnet-4-6 | Both |
| GapAnalystAgent | White space detection | claude-opus-4-6 | Screener |
| ConsistencyCheckerAgent | Cross-section coherence | claude-opus-4-6 | Builder |
| MetaAgent | Post-run retrospective | claude-opus-4-6 | Both |

## Adding a New Agent

### 1. Create the agent file

```python
# ventureforge/agents/my_agent.py
from __future__ import annotations
import time
from typing import Any
from ventureforge.agents.base import AgentConfig, BaseAgent
from ventureforge.core.schemas import AgentOutput, RoundContext
from ventureforge.utils.logger import get_logger

logger = get_logger()

class MyAgent(BaseAgent):
    """Description of what this agent does."""

    async def run(self, context: RoundContext) -> AgentOutput:
        if self.dry_run:
            return self._get_dry_run_output(context)

        start = time.monotonic()

        # Use self._generate_json() for LLM calls with prompts from registry
        data, usage = await self._generate_json(
            "my_agent.prompt_key",
            {"var1": context.input_config.get("var1", "")},
        )

        duration = time.monotonic() - start
        return self._make_output(content=data, usage=usage, duration=duration)

    def _get_dry_run_output(self, context: RoundContext) -> AgentOutput:
        return self._make_output(
            content={"result": "mock data"},
            duration=0.01,
        )
```

### 2. Create the prompt YAML

```yaml
# ventureforge/llm/prompts/screener/my_prompt.yaml (or builder/)
key: "my_agent.prompt_key"
version: 1
model_hint: "deep_reasoning"
system_prompt: |
  You are a specialized agent that...
user_prompt_template: |
  Context: ${var1}
  Produce output as JSON...
output_schema: "MyOutputSchema"
max_tokens: 3000
temperature: 0.5
```

### 3. Register the agent in the orchestrator

Edit `ventureforge/orchestrator/runner.py`:

```python
from ventureforge.agents.my_agent import MyAgent

# In _init_agents():
agent_classes["my_agent"] = MyAgent
```

### 4. Add to a phase's agent sequence

Edit `ventureforge/orchestrator/router.py`:

```python
SCREENER_AGENT_SEQUENCE = [..., "my_agent"]
```

### 5. Write tests

Create `tests/unit/test_agents/test_my_agent.py` with:
- Test dry_run output
- Test run with mocked LLM

## Adding a New Phase

### Screener Phase

1. Add a `PhaseConfig` to `SCREENER_PHASES` in `orchestrator/router.py`
2. Create a rubric in `scoring/rubrics.py`
3. Add helper functions in `screener/` if needed

### Builder Section

1. Add section name to `BUILDER_SECTIONS` in `orchestrator/router.py`
2. Create section class in `builder/sections/`
3. Create prompt YAML in `llm/prompts/builder/`
4. Optionally add to `CONSISTENCY_CHECK_POINTS`

## Agent Contract

Every agent must:
- Return typed `AgentOutput` objects (never raw strings)
- Log token usage via `_make_output(usage=...)`
- Handle rate limit errors (handled by retry decorators)
- Support `dry_run=True` mode
- Be stateless - all state flows through `RoundContext`
