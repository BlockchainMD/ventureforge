"""Crunchbase API client for funding data (optional)."""

from __future__ import annotations

from typing import Any

import httpx

from ventureforge.core.config import get_settings
from ventureforge.utils.logger import get_logger
from ventureforge.utils.retry import research_retry

logger = get_logger()

CRUNCHBASE_BASE_URL = "https://api.crunchbase.com/api/v4"


class CrunchbaseClient:
    """Optional Crunchbase API wrapper for funding/competitor data."""

    def __init__(self) -> None:
        self._api_key = get_settings().crunchbase_api_key

    @property
    def available(self) -> bool:
        """Check if Crunchbase API key is configured."""
        return bool(self._api_key)

    @research_retry
    async def search_organizations(
        self, query: str, limit: int = 10
    ) -> list[dict[str, Any]]:
        """Search for organizations by name or keyword."""
        if not self.available:
            return []

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(
                    f"{CRUNCHBASE_BASE_URL}/autocompletes",
                    params={
                        "query": query,
                        "collection_ids": "organizations",
                        "limit": limit,
                        "user_key": self._api_key,
                    },
                )
                response.raise_for_status()
                data = response.json()
                return data.get("entities", [])
        except httpx.HTTPError as e:
            logger.warning("crunchbase_search_failed", query=query, error=str(e))
            return []
