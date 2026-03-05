"""Export a run's output to file."""

import asyncio
import sys

from ventureforge.core.database import get_session_factory, init_db
from ventureforge.output.json_exporter import export_json


async def main(run_id: str, format: str = "json") -> None:
    await init_db()
    factory = get_session_factory()

    async with factory() as session:
        from sqlalchemy import select
        from ventureforge.core.models import Run, Phase

        result = await session.execute(select(Run).where(Run.id == run_id))
        run = result.scalar_one_or_none()
        if not run:
            print(f"Run {run_id} not found")
            return

        phases_result = await session.execute(
            select(Phase).where(Phase.run_id == run_id)
        )
        phases = list(phases_result.scalars().all())

        data = {
            "run_id": run.id,
            "run_type": run.run_type,
            "status": run.status.value,
            "phases": {p.phase_name: p.final_output for p in phases},
        }

        path = export_json(data, f"{run_id}.json")
        print(f"Exported to: {path}")


if __name__ == "__main__":
    rid = sys.argv[1] if len(sys.argv) > 1 else ""
    fmt = sys.argv[2] if len(sys.argv) > 2 else "json"
    asyncio.run(main(rid, fmt))
