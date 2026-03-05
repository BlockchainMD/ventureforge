"""CLI entrypoint for VentureForge."""

from __future__ import annotations

import asyncio
import json

import typer
from rich.console import Console
from rich.table import Table

from ventureforge.utils.logger import setup_logging

app = typer.Typer(name="ventureforge", help="Agentic AI Business Screener & Builder")
console = Console()


def _run_async(coro):
    """Helper to run async code from sync CLI."""
    return asyncio.run(coro)


@app.command()
def screen(
    domain: str | None = typer.Option(None, help="Domain to explore"),
    max_candidates: int = typer.Option(8, help="Max shortlisted candidates"),
    max_rounds: int = typer.Option(4, help="Max rounds per phase"),
    quality_threshold: float = typer.Option(0.82, help="Quality threshold to advance"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Run without API calls"),
    constraints: str | None = typer.Option(None, help="Comma-separated constraints"),
    anti_patterns: str | None = typer.Option(None, help="Comma-separated anti-patterns"),
) -> None:
    """Screen the market for agentic AI business opportunities."""
    setup_logging()

    async def _run() -> None:
        from ventureforge.core.database import get_session_factory, init_db
        from ventureforge.core.schemas import ScreenerInput
        from ventureforge.screener.screener import ScreenerPipeline

        await init_db()
        factory = get_session_factory()

        input_config = ScreenerInput(
            domain=domain,
            constraints=constraints.split(",") if constraints else [],
            anti_patterns=anti_patterns.split(",") if anti_patterns else [],
            max_candidates=max_candidates,
            max_rounds_per_phase=max_rounds,
            quality_threshold=quality_threshold,
        )

        async with factory() as session:
            pipeline = ScreenerPipeline(session, dry_run=dry_run)
            result = await pipeline.run(input_config)

        # Display results
        console.print("\n[bold green]Screener Complete![/bold green]\n")
        console.print(f"Run ID: {result['run_id']}")

        thesis = result.get("thesis")
        if thesis:
            console.print(f"\n[bold]Top Opportunity:[/bold] {thesis.get('title', 'N/A')}")
            console.print(f"[dim]{thesis.get('one_liner', '')}[/dim]\n")

        opps = result.get("opportunities", [])
        if opps:
            table = Table(title="Ranked Opportunities")
            table.add_column("Rank", style="cyan")
            table.add_column("Title", style="white")
            table.add_column("Score", style="green")
            table.add_column("Status", style="yellow")

            for i, opp in enumerate(opps, 1):
                table.add_row(
                    str(i),
                    opp.get("title", ""),
                    f"{opp.get('composite_score', 0):.2f}",
                    opp.get("status", ""),
                )
            console.print(table)

    _run_async(_run())


@app.command()
def build(
    opportunity_id: str | None = typer.Option(None, help="Opportunity ID from screener"),
    thesis: str | None = typer.Option(None, help="Path to thesis JSON file"),
    max_rounds: int = typer.Option(3, help="Max rounds per section"),
    quality_threshold: float = typer.Option(0.85, help="Quality threshold"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Run without API calls"),
    target_audience: str = typer.Option("seed VC", help="Target audience"),
    depth: str = typer.Option("investor_ready", help="Depth: mvp, full, investor_ready"),
) -> None:
    """Build a complete business blueprint."""
    setup_logging()

    async def _run() -> None:
        from ventureforge.builder.builder import BuilderPipeline
        from ventureforge.core.database import get_session_factory, init_db
        from ventureforge.core.schemas import BuilderInput, OpportunityThesis

        await init_db()
        factory = get_session_factory()

        # Load thesis
        if thesis:
            with open(thesis) as f:
                thesis_data = json.load(f)
            opp = OpportunityThesis.model_validate(thesis_data)
        elif opportunity_id:
            # TODO: Load from database
            console.print("[red]Loading from DB not yet implemented. Use --thesis.[/red]")
            return
        else:
            console.print("[red]Provide --opportunity-id or --thesis[/red]")
            return

        input_config = BuilderInput(
            opportunity=opp,
            target_audience=target_audience,
            depth=depth,
            max_rounds_per_section=max_rounds,
            quality_threshold=quality_threshold,
        )

        async with factory() as session:
            pipeline = BuilderPipeline(session, dry_run=dry_run)
            result = await pipeline.run(input_config)

        console.print("\n[bold green]Builder Complete![/bold green]\n")
        console.print(f"Run ID: {result['run_id']}")

        sections = result.get("sections", [])
        table = Table(title="Blueprint Sections")
        table.add_column("#", style="cyan")
        table.add_column("Section", style="white")
        table.add_column("Score", style="green")
        table.add_column("Revisions", style="yellow")

        for s in sections:
            table.add_row(
                str(s["order"]),
                s["name"].replace("_", " ").title(),
                f"{s['quality_score']:.2f}",
                str(s["revision_count"]),
            )
        console.print(table)

    _run_async(_run())


@app.command("runs")
def runs_cmd(
    action: str = typer.Argument(help="list, show, or export"),
    run_id: str | None = typer.Argument(None, help="Run ID (for show/export)"),
    format: str = typer.Option("json", help="Export format: json, pdf, docx"),
) -> None:
    """Manage runs: list, show, export."""
    setup_logging()

    async def _run() -> None:
        from ventureforge.core.database import get_session_factory, init_db
        from ventureforge.core.models import Run

        await init_db()
        factory = get_session_factory()

        async with factory() as session:
            if action == "list":
                from sqlalchemy import select

                result = await session.execute(
                    select(Run).where(Run.is_deleted == False).order_by(Run.created_at.desc())
                )
                runs = list(result.scalars().all())

                table = Table(title="VentureForge Runs")
                table.add_column("ID", style="cyan")
                table.add_column("Type", style="white")
                table.add_column("Status", style="green")
                table.add_column("Phase", style="yellow")

                for r in runs:
                    table.add_row(
                        r.id[:8] + "...",
                        r.run_type,
                        r.status.value,
                        r.current_phase or "-",
                    )
                console.print(table)

            elif action == "show" and run_id:
                from sqlalchemy import select

                result = await session.execute(select(Run).where(Run.id == run_id))
                run = result.scalar_one_or_none()
                if run:
                    console.print(f"[bold]Run {run.id}[/bold]")
                    console.print(f"Type: {run.run_type}")
                    console.print(f"Status: {run.status.value}")
                    console.print(f"Phase: {run.current_phase}")
                    console.print(f"Round: {run.current_round}")
                    console.print(f"Created: {run.created_at}")
                else:
                    console.print(f"[red]Run {run_id} not found[/red]")

            elif action == "export" and run_id:
                from ventureforge.output.json_exporter import export_json

                result = await session.execute(
                    select(Run).where(Run.id == run_id)
                )
                run = result.scalar_one_or_none()
                if run:
                    path = export_json(
                        {"run_id": run.id, "type": run.run_type, "config": run.input_config},
                        f"{run_id}.{format}",
                    )
                    console.print(f"Exported to: {path}")
                else:
                    console.print(f"[red]Run {run_id} not found[/red]")

    _run_async(_run())


@app.command("db")
def db_cmd(
    action: str = typer.Argument(help="init or migrate"),
) -> None:
    """Database management: init, migrate."""
    setup_logging()

    if action == "init":

        async def _init() -> None:
            from ventureforge.core.database import init_db

            await init_db()
            console.print("[green]Database initialized.[/green]")

        _run_async(_init())
    elif action == "migrate":
        console.print("[yellow]Migrations via Alembic not yet configured.[/yellow]")
    else:
        console.print(f"[red]Unknown action: {action}[/red]")


@app.command("prompts")
def prompts_cmd(
    action: str = typer.Argument(default="review", help="review"),
) -> None:
    """Manage prompts: review pending changes."""
    from ventureforge.llm.prompts.registry import get_registry

    registry = get_registry()
    keys = registry.keys()

    table = Table(title="Registered Prompts")
    table.add_column("Key", style="cyan")
    for key in sorted(keys):
        table.add_row(key)
    console.print(table)


if __name__ == "__main__":
    app()
