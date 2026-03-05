"""Direct URL fetch and HTML extraction."""

from __future__ import annotations

import re
from typing import Any

import httpx

from ventureforge.core.exceptions import ResearchError
from ventureforge.utils.logger import get_logger
from ventureforge.utils.retry import research_retry

logger = get_logger()


@research_retry
async def fetch_url(url: str, timeout: float = 15.0) -> dict[str, Any]:
    """Fetch a URL and extract text content."""
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(url, headers={"User-Agent": "VentureForge/0.1.0"})
            response.raise_for_status()

            content_type = response.headers.get("content-type", "")
            text = response.text

            # Basic HTML tag stripping
            if "html" in content_type:
                text = _strip_html(text)

            return {
                "url": url,
                "status_code": response.status_code,
                "content": text[:10000],  # Limit content size
                "content_type": content_type,
            }
    except httpx.HTTPError as e:
        raise ResearchError(f"Failed to fetch {url}: {e}") from e


def _strip_html(html: str) -> str:
    """Strip HTML tags and extract readable text."""
    # Remove script and style blocks
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
    # Remove tags
    text = re.sub(r"<[^>]+>", " ", text)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text
