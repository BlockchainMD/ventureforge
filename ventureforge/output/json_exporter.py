"""Raw structured JSON export."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ventureforge.core.config import get_settings
from ventureforge.utils.logger import get_logger

logger = get_logger()


def export_json(data: dict[str, Any], filename: str) -> Path:
    """Export data as a formatted JSON file."""
    output_dir = Path(get_settings().output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    filepath = output_dir / filename
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2, default=str)

    logger.info("json_exported", path=str(filepath))
    return filepath
