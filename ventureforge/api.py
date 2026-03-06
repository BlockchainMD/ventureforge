"""FastAPI REST entrypoint for VentureForge."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ventureforge.builder.builder import BuilderPipeline
from ventureforge.core.database import close_db, get_session, init_db
from ventureforge.core.models import Lesson as LessonModel
from ventureforge.core.models import Opportunity, Phase, Run
from ventureforge.core.models import Round as RoundModel
from ventureforge.core.schemas import (
    BuilderInput,
    LessonResponse,
    OpportunityBrief,
    PhaseResponse,
    RoundResponse,
    RunListResponse,
    RunResponse,
    ScreenerInput,
)
from ventureforge.core.state import StateManager
from ventureforge.output.docx_exporter import export_docx
from ventureforge.output.json_exporter import export_json
from ventureforge.output.pdf_exporter import export_pdf
from ventureforge.output.renderer import DocumentRenderer
from ventureforge.screener.screener import ScreenerPipeline
from ventureforge.utils.logger import get_logger, setup_logging

logger = get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: setup and teardown."""
    setup_logging()
    await init_db()
    yield
    await close_db()


app = FastAPI(
    title="VentureForge",
    description="Agentic AI Business Screener & Builder API",
    version="0.1.0",
    lifespan=lifespan,
)


def _run_to_response(run: Run) -> RunResponse:
    return RunResponse(
        id=run.id,
        run_type=run.run_type,
        status=run.status.value,
        created_at=run.created_at,
        updated_at=run.updated_at,
        current_phase=run.current_phase,
        current_round=run.current_round,
        input_config=run.input_config,
        metadata=run.metadata_,
    )


# --- Run Endpoints ---


@app.post("/runs/screener", response_model=RunResponse, status_code=201)
async def start_screener(
    input_config: ScreenerInput,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
) -> RunResponse:
    """Start a new screener run."""
    run = Run(run_type="screener", input_config=input_config.model_dump())
    session.add(run)
    await session.commit()

    async def _run_screener() -> None:
        async for s in get_session():
            p = ScreenerPipeline(s)
            await p.run(input_config)

    background_tasks.add_task(_run_screener)
    return _run_to_response(run)


@app.post("/runs/builder", response_model=RunResponse, status_code=201)
async def start_builder(
    input_config: BuilderInput,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
) -> RunResponse:
    """Start a new builder run."""
    run = Run(run_type="builder", input_config=input_config.model_dump())
    session.add(run)
    await session.commit()

    async def _run_builder() -> None:
        async for s in get_session():
            p = BuilderPipeline(s)
            await p.run(input_config)

    background_tasks.add_task(_run_builder)
    return _run_to_response(run)


@app.get("/runs", response_model=RunListResponse)
async def list_runs(
    session: AsyncSession = Depends(get_session),
    limit: int = Query(default=50, le=100),
    offset: int = Query(default=0, ge=0),
) -> RunListResponse:
    """List all runs with status."""
    result = await session.execute(
        select(Run).where(Run.is_deleted == False).order_by(Run.created_at.desc()).offset(offset).limit(limit)
    )
    runs = list(result.scalars().all())
    count_result = await session.execute(select(Run).where(Run.is_deleted == False))
    total = len(list(count_result.scalars().all()))
    return RunListResponse(runs=[_run_to_response(r) for r in runs], total=total)


@app.get("/runs/{run_id}", response_model=RunResponse)
async def get_run(run_id: str, session: AsyncSession = Depends(get_session)) -> RunResponse:
    """Get full run state."""
    result = await session.execute(select(Run).where(Run.id == run_id))
    run = result.scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return _run_to_response(run)


@app.get("/runs/{run_id}/phases")
async def get_phases(
    run_id: str, session: AsyncSession = Depends(get_session)
) -> list[PhaseResponse]:
    """Get all phases for a run."""
    result = await session.execute(select(Phase).where(Phase.run_id == run_id))
    phases = result.scalars().all()
    return [
        PhaseResponse(
            id=p.id,
            phase_name=p.phase_name,
            status=p.status.value,
            round_count=p.round_count,
            quality_score=p.quality_score,
            started_at=p.started_at,
            completed_at=p.completed_at,
        )
        for p in phases
    ]


@app.get("/runs/{run_id}/phases/{phase_name}/rounds")
async def get_rounds(
    run_id: str, phase_name: str, session: AsyncSession = Depends(get_session)
) -> list[RoundResponse]:
    """Get all rounds for a phase."""
    result = await session.execute(
        select(RoundModel)
        .join(Phase)
        .where(Phase.run_id == run_id, Phase.phase_name == phase_name)
        .order_by(RoundModel.round_number)
    )
    rounds = result.scalars().all()
    return [
        RoundResponse(
            id=r.id,
            round_number=r.round_number,
            scores=r.scores,
            decision=r.decision,
            decision_rationale=r.decision_rationale,
            duration_seconds=r.duration_seconds,
        )
        for r in rounds
    ]


@app.post("/runs/{run_id}/pause")
async def pause_run(run_id: str, session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    """Pause a running run."""
    state = StateManager(session)
    await state.pause_run(run_id)
    await session.commit()
    return {"status": "paused"}


@app.post("/runs/{run_id}/resume")
async def resume_run(run_id: str, session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    """Resume a paused run."""
    state = StateManager(session)
    await state.resume_run(run_id)
    await session.commit()
    return {"status": "resumed"}


@app.get("/runs/{run_id}/export")
async def export_run(
    run_id: str,
    format: str = Query(default="json", pattern="^(json|pdf|docx)$"),
    session: AsyncSession = Depends(get_session),
) -> Any:
    """Export final output in requested format."""
    result = await session.execute(select(Run).where(Run.id == run_id))
    run = result.scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    # Get final data
    phases_result = await session.execute(
        select(Phase).where(Phase.run_id == run_id).order_by(Phase.phase_name)
    )
    phases = list(phases_result.scalars().all())
    data = {
        "run_id": run_id,
        "run_type": run.run_type,
        "status": run.status.value,
        "phases": {p.phase_name: p.final_output for p in phases},
    }

    renderer = DocumentRenderer()
    if run.run_type == "screener":
        markdown = renderer.render_screener_report(data)
    else:
        markdown = renderer.render_blueprint(data.get("phases", {}), "Business Blueprint")

    if format == "json":
        path = export_json(data, f"{run_id}.json")
    elif format == "pdf":
        path = export_pdf(markdown, f"{run_id}.pdf")
    elif format == "docx":
        path = export_docx(markdown, f"{run_id}.docx")
    else:
        raise HTTPException(status_code=400, detail=f"Unknown format: {format}")

    return FileResponse(str(path), filename=path.name)


@app.delete("/runs/{run_id}")
async def delete_run(run_id: str, session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    """Soft-delete a run."""
    result = await session.execute(select(Run).where(Run.id == run_id))
    run = result.scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    run.is_deleted = True
    await session.commit()
    return {"status": "deleted"}


# --- Opportunity Endpoints ---


@app.get("/opportunities", response_model=list[OpportunityBrief])
async def list_opportunities(
    session: AsyncSession = Depends(get_session),
) -> list[OpportunityBrief]:
    """List all opportunities in knowledge base."""
    result = await session.execute(select(Opportunity))
    return [
        OpportunityBrief(
            id=opp.id,
            title=opp.title,
            composite_score=opp.composite_score,
            status=opp.status.value,
            problem_space=opp.problem_space,
        )
        for opp in result.scalars().all()
    ]


# --- Lessons Endpoints ---


@app.get("/lessons", response_model=list[LessonResponse])
async def list_lessons(
    session: AsyncSession = Depends(get_session),
) -> list[LessonResponse]:
    """List all accumulated lessons."""
    result = await session.execute(select(LessonModel))
    return [
        LessonResponse(
            id=l.id,
            category=l.category,
            insight=l.insight,
            applies_to=l.applies_to,
            created_at=l.created_at,
        )
        for l in result.scalars().all()
    ]


# --- Prompt Approval ---


@app.post("/prompts/{key}/approve")
async def approve_prompt(key: str) -> dict[str, str]:
    """Approve a pending prompt version update."""
    # TODO: Implement prompt version approval
    return {"status": "approved", "key": key}


# --- SPA Static Files (must be last) ---

STATIC_DIR = Path(__file__).parent.parent / "frontend" / "dist"
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="static")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        """Serve the SPA for any non-API route."""
        file_path = STATIC_DIR / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(STATIC_DIR / "index.html"))
