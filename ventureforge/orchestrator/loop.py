"""Deliberation loop controller - the beating heart of VentureForge."""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ventureforge.agents.base import BaseAgent
from ventureforge.core.schemas import (
    Decision,
    PhaseConfig,
    PhaseResult,
    RoundContext,
    RoundScores,
    TokenUsage,
)
from ventureforge.core.state import StateManager
from ventureforge.orchestrator.checkpointer import Checkpointer
from ventureforge.utils.logger import get_logger

logger = get_logger()


class DeliberationLoop:
    """Runs the multi-round deliberation loop for a phase.

    Each round:
    1. Runs agents in sequence
    2. Scores the output
    3. Decides: loop again, advance, or escalate
    4. Persists the round before proceeding
    """

    def __init__(
        self,
        phase_config: PhaseConfig,
        agents: dict[str, BaseAgent],
        session: AsyncSession,
        state_manager: StateManager,
    ) -> None:
        self._config = phase_config
        self._agents = agents
        self._session = session
        self._state = state_manager
        self._checkpointer = Checkpointer(session)

    async def run(
        self,
        run_id: str,
        initial_context: dict[str, Any],
        locked_outputs: dict[str, Any] | None = None,
        lessons: list[str] | None = None,
    ) -> PhaseResult:
        """Run the full deliberation loop for a phase."""
        phase = await self._checkpointer.create_phase(run_id, self._config.phase_name)

        context = initial_context.copy()
        previous_rounds: list[dict[str, Any]] = []
        total_tokens = TokenUsage()
        final_output: dict[str, Any] = {}
        final_score = 0.0
        final_decision = "loop"

        for round_num in range(1, self._config.max_rounds + 1):
            logger.info(
                "round_start",
                run_id=run_id,
                phase=self._config.phase_name,
                round=round_num,
            )

            round_ctx = RoundContext(
                run_id=run_id,
                run_type=context.get("run_type", "screener"),
                phase_name=self._config.phase_name,
                round_number=round_num,
                input_config=context.get("input_config", {}),
                previous_rounds=previous_rounds,
                locked_outputs=locked_outputs or {},
                lessons=lessons or [],
                current_content=context.get("current_content", {}),
            )

            round_result = await self._run_round(round_ctx)

            # Accumulate tokens
            for output in round_result["agent_outputs"].values():
                if isinstance(output, dict) and "token_usage" in output:
                    tu = output["token_usage"]
                    total_tokens.input_tokens += tu.get("input_tokens", 0)
                    total_tokens.output_tokens += tu.get("output_tokens", 0)

            # Persist round
            await self._checkpointer.save_round(
                phase_id=phase.id,
                round_number=round_num,
                agent_outputs=round_result["agent_outputs"],
                research_citations=round_result.get("research_citations", []),
                scores=round_result.get("scores", {}),
                critique_summary=round_result.get("critique_summary", ""),
                decision=round_result["decision"],
                decision_rationale=round_result.get("decision_rationale", ""),
                token_usage=total_tokens.model_dump(),
                duration_seconds=round_result.get("duration_seconds", 0),
            )
            await self._checkpointer.commit()

            # Update run state
            await self._state.update_phase(run_id, self._config.phase_name, round_num)

            # Track for next round context
            previous_rounds.append(round_result)
            final_output = round_result.get("synthesized_output", round_result["agent_outputs"])
            final_score = round_result.get("composite_score", 0.0)
            final_decision = round_result["decision"]

            # Update current content for next round
            if "synthesized_output" in round_result:
                context["current_content"] = round_result["synthesized_output"]

            # Decision
            if round_result["decision"] == "advance":
                logger.info(
                    "phase_advancing",
                    phase=self._config.phase_name,
                    round=round_num,
                    score=final_score,
                )
                break
            elif round_result["decision"] == "escalate":
                logger.warning(
                    "phase_escalated",
                    phase=self._config.phase_name,
                    round=round_num,
                )
                break

        # Save phase result
        await self._checkpointer.save_phase_result(
            phase_id=phase.id,
            final_output=final_output if isinstance(final_output, dict) else {},
            quality_score=final_score,
        )
        await self._checkpointer.commit()

        return PhaseResult(
            phase_name=self._config.phase_name,
            final_output=final_output if isinstance(final_output, dict) else {},
            quality_score=final_score,
            rounds_executed=min(round_num, self._config.max_rounds),
            decision=final_decision,
            total_tokens=total_tokens,
        )

    async def _run_round(self, context: RoundContext) -> dict[str, Any]:
        """Execute one full agent sequence within a round."""
        start = time.monotonic()
        agent_outputs: dict[str, Any] = {}
        research_citations: list[dict[str, Any]] = []
        critique_summary = ""
        scores: dict[str, Any] = {}
        synthesized_output: dict[str, Any] = {}

        for agent_name in self._config.agent_sequence:
            agent = self._agents.get(agent_name)
            if agent is None:
                logger.warning("agent_not_found", agent=agent_name)
                continue

            try:
                # Inject previous agent outputs into context for this round
                ctx = context.model_copy(update={"current_content": synthesized_output or agent_outputs})
                output = await agent.run(ctx)
                agent_outputs[agent_name] = output.model_dump()

                # Track specific outputs
                if agent_name == "researcher" and output.content.get("insights"):
                    research_citations = [
                        {"claim": i.get("claim", ""), "source_url": i.get("source_url", "")}
                        for i in output.content.get("insights", [])
                    ]
                    context = context.model_copy(
                        update={
                            "research_bundle": output.content,
                        }
                    )
                elif agent_name == "critic":
                    critique_summary = output.content.get("summary", "")
                elif agent_name == "synthesizer":
                    synthesized_output = output.content
                elif agent_name == "scorer":
                    scores = output.content.get("scores", {})

            except Exception as e:
                logger.error("agent_error", agent=agent_name, error=str(e))
                agent_outputs[agent_name] = {"error": str(e)}

        duration = time.monotonic() - start

        # Determine decision from scorer output
        decision = "loop"
        decision_rationale = ""
        composite_score = 0.0

        scorer_output = agent_outputs.get("scorer", {})
        if isinstance(scorer_output, dict):
            content = scorer_output.get("content", scorer_output)
            decision = content.get("decision", "loop")
            decision_rationale = content.get("decision_rationale", "")
            composite_score = content.get("composite_score", 0.0)

        return {
            "agent_outputs": agent_outputs,
            "research_citations": research_citations,
            "scores": scores,
            "critique_summary": critique_summary,
            "decision": decision,
            "decision_rationale": decision_rationale,
            "composite_score": composite_score,
            "synthesized_output": synthesized_output,
            "duration_seconds": duration,
        }

    def _make_decision(self, scores: RoundScores) -> Decision:
        """Decide: loop, advance, or escalate based on scores."""
        if scores.composite_score >= self._config.quality_threshold:
            return Decision(
                action="advance",
                rationale=f"Score {scores.composite_score:.2f} >= threshold {self._config.quality_threshold}",
                scores=scores,
            )
        return Decision(
            action="loop",
            rationale=f"Score {scores.composite_score:.2f} < threshold {self._config.quality_threshold}",
            scores=scores,
        )
