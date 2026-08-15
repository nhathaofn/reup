from __future__ import annotations

import mimetypes
import os
from pathlib import Path
from typing import Any, Dict, Optional

from utils.validators import sanitize_filename


class FileManager:
    """Manage downloaded files with safe names and atomic writes."""

    def __init__(self, base_path: str | os.PathLike[str] | None = None):
        self.base_path = Path(base_path or "./Downloaded").expanduser()
        self.base_path.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def file_exists(path: str | os.PathLike[str] | Path) -> bool:
        try:
            candidate = Path(path)
            return candidate.is_file() and candidate.stat().st_size > 0
        except OSError:
            return False

    @staticmethod
    def get_file_size(path: str | os.PathLike[str] | Path) -> int:
        try:
            return Path(path).stat().st_size
        except OSError:
            return 0

    def get_save_path(
        self,
        author_name: str,
        mode: str | None,
        aweme_title: str,
        aweme_id: str,
        *,
        folderstyle: bool = True,
        download_date: str | None = None,
    ) -> Path:
        if not folderstyle:
            self.base_path.mkdir(parents=True, exist_ok=True)
            return self.base_path

        author = sanitize_filename(str(author_name or "unknown"), max_length=80)
        category = sanitize_filename(str(mode or "post"), max_length=40)
        date = sanitize_filename(str(download_date or ""), max_length=20)
        title = sanitize_filename(str(aweme_title or "untitled"), max_length=80)
        identifier = sanitize_filename(str(aweme_id or "unknown"), max_length=40)
        stem = "_".join(part for part in (date, title, identifier) if part)
        save_path = self.base_path / author / category / stem
        save_path.mkdir(parents=True, exist_ok=True)
        return save_path

    async def download_file(
        self,
        url: str,
        save_path: str | os.PathLike[str] | Path,
        session: Any,
        *,
        headers: Optional[Dict[str, str]] = None,
        proxy: Optional[str] = None,
        prefer_response_content_type: bool = False,
        return_saved_path: bool = False,
    ) -> bool | Path:
        destination = Path(save_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(destination.name + ".tmp")
        request_kwargs: Dict[str, Any] = {}
        if headers:
            request_kwargs["headers"] = headers
        if proxy:
            request_kwargs["proxy"] = proxy

        try:
            async with session.get(url, **request_kwargs) as response:
                if int(getattr(response, "status", 0) or 0) not in (200, 206):
                    return False

                target = destination
                if prefer_response_content_type:
                    response_headers = getattr(response, "headers", {}) or {}
                    content_type = str(
                        response_headers.get("Content-Type", "")
                        or response_headers.get("content-type", "")
                        or getattr(response, "content_type", "")
                        or ""
                    ).split(";", 1)[0].strip().lower()
                    guessed = mimetypes.guess_extension(content_type)
                    if guessed and (
                        not target.suffix
                        or content_type.startswith("image/")
                        and target.suffix.lower() != guessed
                    ):
                        target = target.with_suffix(guessed)
                        temporary = target.with_name(target.name + ".tmp")

                total = 0
                with temporary.open("wb") as output:
                    content = getattr(response, "content", None)
                    iterator = getattr(content, "iter_chunked", None)
                    if callable(iterator):
                        async for chunk in iterator(1024 * 1024):
                            if chunk:
                                output.write(chunk)
                                total += len(chunk)
                    elif content is not None:
                        async for chunk in content:
                            if chunk:
                                output.write(chunk)
                                total += len(chunk)

                expected = getattr(response, "content_length", None)
                if expected is not None and int(expected) != total:
                    temporary.unlink(missing_ok=True)
                    return False
                if total <= 0:
                    temporary.unlink(missing_ok=True)
                    return False

                os.replace(temporary, target)
                return target if return_saved_path else True
        except Exception:
            temporary.unlink(missing_ok=True)
            return False
        finally:
            temporary.unlink(missing_ok=True)
