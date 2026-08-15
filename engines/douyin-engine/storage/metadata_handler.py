from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Dict


class MetadataHandler:
    """Write metadata and an append-only download manifest."""

    _manifest_locks: dict[str, asyncio.Lock] = {}

    async def save_metadata(self, payload: Any, output_path: str | Path) -> bool:
        destination = Path(output_path)
        temporary = destination.with_name(destination.name + ".tmp")
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            with temporary.open("w", encoding="utf-8", newline="\n") as output:
                json.dump(payload, output, ensure_ascii=False, indent=2)
                output.write("\n")
            temporary.replace(destination)
            return True
        except Exception:
            temporary.unlink(missing_ok=True)
            return False

    async def append_download_manifest(
        self, base_path: str | Path, record: Dict[str, Any]
    ) -> bool:
        root = Path(base_path)
        manifest = root / "download_manifest.jsonl"
        key = str(manifest.resolve())
        lock = self._manifest_locks.setdefault(key, asyncio.Lock())
        try:
            root.mkdir(parents=True, exist_ok=True)
            line = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
            async with lock:
                with manifest.open("a", encoding="utf-8", newline="\n") as output:
                    output.write(line + "\n")
            return True
        except Exception:
            return False
