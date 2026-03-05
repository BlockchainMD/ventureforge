"""Main orchestration engine - coordinates the full screener/builder pipeline."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ventureforge.agents.base import AgentConfig, BaseAgent
from ventureforge.core.models import Run, RunStatus
from ventureforge.core.schemas import PhaseConfig, PhaseResult
from ventureforge.core.state import StateManager
from ventureforge.llm.router import LLMRouter
from ventureforge.orchestrator.loop import DeliberationLoop
from ventureforge.utils.logger import get_logger

logger = get_logger()


class OrchestratorRunner:
    """Top-level orchestration engine that drives screener and builder pipelines."""

    def __init__(self, session: AsyncSession, dry_run: bool = False) -> None:
        self._session = session
        self._dry_run = dry_run
        self._state = StateManager(session)
        self._llm = LLMRouter()
        self._agents: dict[str, BaseAgent] = {}
        self._init_agents()

    def _init_agents(self) -> None:
        """Initialize all agents."""
        from ventureforge.agents.consistency_checker import ConsistencyCheckerAgent
        from ventureforge.agents.critic import CriticAgent
        from ventureforge.agents.gap_analyst import GapAnalystAgent
        from ventureforge.agents.generator import GeneratorAgent
        from ventureforge.agents.researcher import ResearcherAgent
        from ventureforge.agents.scorer import ScorerAgent
        from ventureforge.agents.synthesizer import SynthesizerAgent

        agent_classes: dict[str, type[BaseAgent]] = {
            "generator": GeneratorAgent,
            "researcher": ResearcherAgent,
            "critic": CriticAgent,
            "synthesizer": SynthesizerAgent,
            "scorer": ScorerAgent,
            "gap_analyst": GapAnalystAgent,
            "consistency_checker": ConsistencyCheckerAgent,
        }

        for name, cls in agent_classes.items():
            config = AgentConfig(name=name, dry_run=self._dry_run)
            self._agents[name] = cls(llm_router=self._llm, config=config)

    async def run_phase(
        self,
        run_id: str,
        phase_config: PhaseConfig,
        initial_context: dict[str, Any],
        locked_outputs: dict[str, Any] | None = None,
        lessons: list[str] | None = None,
    ) -> PhaseResult:
        """Execute a single phase (no run lifecycle management)."""
        logger.info("phase_start", run_id=run_id, phase=phase_config.phase_name)

        loop = DeliberationLoop(
            phase_config=phase_config,
            agents=self._agents,
            session=self._session,
            state_manager=self._state,
        )

        result = await loop.run(
            run_id=run_id,
            initial_context=initial_context,
            locked_outputs=locked_outputs or {},
            lessons=lessons or [],
        )

        logger.info(
            "phase_complete",
            phase=phase_config.phase_name,
            score=result.quality_score,
            rounds=result.rounds_executed,
        )
        return result

    async def run_phases(
        self,
        run_id: str,
        phases: list[PhaseConfig],
        initial_context: dict[str, Any],
    ) -> list[PhaseResult]:
        """Execute a sequence of phases with full run lifecycle management."""
        await self._state.start_run(run_id)

        results: list[PhaseResult] = []
        locked_outputs: dict[str, Any] = {}
        lessons: list[str] = []

        try:
            for phase_config in phases:
                context = initial_context.copy()
                if results:
                    context["previous_phase_output"] = results[-1].final_output

                result = await self.run_phase(
                    run_id=run_id,
                    phase_config=phase_config,
                    initial_context=context,
                    locked_outputs=locked_outputs,
                    lessons=lessons,
                )

                results.append(result)
                locked_outputs[phase_config.phase_name] = result.final_output

            await self._state.complete_run(run_id)

        except Exception as e:
            logger.error("run_failed", run_id=run_id, error=str(e))
            await self._state.fail_run(run_id, str(e))
            raise

        return results

    async def create_run(
        self, run_type: str, input_config: dict[str, Any]
    ) -> Run:
        """Create a new run record."""
        run = Run(
            run_type=run_type,
            status=RunStatus.PENDING,
            input_config=input_config,
        )
        self._session.add(run)
        await self._session.flush()
        await self._session.commit()
        return run
