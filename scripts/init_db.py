"""Initialize the VentureForge database."""

import asyncio

from ventureforge.core.database import init_db


async def main() -> None:
    await init_db()
    print("Database initialized successfully.")


if __name__ == "__main__":
    asyncio.run(main())
