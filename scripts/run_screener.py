"""Run a screener pipeline from the command line."""

import asyncio
import json

from ventureforge.core.database import get_session_factory, init_db
from ventureforge.core.schemas import ScreenerInput
from ventureforge.screener.screener import ScreenerPipeline


async def main() -> None:
    await init_db()
    factory = get_session_factory()

    input_config = ScreenerInput(
        domain="B2B SaaS operations",
        constraints=["B2B only"],
        max_candidates=8,
    )

    async with factory() as session:
        pipeline = ScreenerPipeline(session, dry_run=True)
        result = await pipeline.run(input_config)

    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    asyncio.run(main())
