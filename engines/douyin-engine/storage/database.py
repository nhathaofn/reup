from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Dict, Optional

import aiosqlite


class Database:
    """Small async SQLite repository used by the downloader."""

    def __init__(self, db_path: str = "dy_downloader.db"):
        self.db_path = str(Path(db_path).expanduser())
        self._conn: Optional[aiosqlite.Connection] = None
        self._connect_lock = asyncio.Lock()

    async def _get_conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            async with self._connect_lock:
                if self._conn is None:
                    Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
                    self._conn = await aiosqlite.connect(self.db_path)
                    self._conn.row_factory = aiosqlite.Row
        return self._conn

    async def initialize(self) -> None:
        conn = await self._get_conn()
        await conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS aweme (
                aweme_id TEXT PRIMARY KEY,
                aweme_type TEXT,
                title TEXT,
                author_id TEXT,
                author_name TEXT,
                create_time INTEGER,
                file_path TEXT,
                metadata TEXT,
                downloaded_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT NOT NULL,
                url_type TEXT,
                total_count INTEGER DEFAULT 0,
                success_count INTEGER DEFAULT 0,
                config TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS transcript_jobs (
                aweme_id TEXT PRIMARY KEY,
                video_path TEXT,
                transcript_dir TEXT,
                text_path TEXT,
                json_path TEXT,
                model TEXT,
                status TEXT,
                skip_reason TEXT,
                error_message TEXT,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        await conn.commit()

    async def add_aweme(self, payload: Dict[str, Any]) -> None:
        conn = await self._get_conn()
        await conn.execute(
            """
            INSERT INTO aweme (
                aweme_id, aweme_type, title, author_id, author_name,
                create_time, file_path, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(aweme_id) DO UPDATE SET
                aweme_type=excluded.aweme_type,
                title=excluded.title,
                author_id=excluded.author_id,
                author_name=excluded.author_name,
                create_time=excluded.create_time,
                file_path=excluded.file_path,
                metadata=excluded.metadata,
                downloaded_at=CURRENT_TIMESTAMP
            """,
            (
                payload.get("aweme_id"),
                payload.get("aweme_type"),
                payload.get("title"),
                payload.get("author_id"),
                payload.get("author_name"),
                payload.get("create_time"),
                payload.get("file_path"),
                payload.get("metadata"),
            ),
        )
        await conn.commit()

    async def is_downloaded(self, aweme_id: str) -> bool:
        conn = await self._get_conn()
        async with conn.execute(
            "SELECT 1 FROM aweme WHERE aweme_id = ? LIMIT 1", (str(aweme_id),)
        ) as cursor:
            return await cursor.fetchone() is not None

    async def get_aweme_count_by_author(self, author_id: str) -> int:
        conn = await self._get_conn()
        async with conn.execute(
            "SELECT COUNT(*) AS count FROM aweme WHERE author_id = ?", (str(author_id),)
        ) as cursor:
            row = await cursor.fetchone()
        return int(row["count"] if row else 0)

    async def get_latest_aweme_time(self, author_id: str) -> Optional[int]:
        conn = await self._get_conn()
        async with conn.execute(
            "SELECT MAX(create_time) AS latest FROM aweme WHERE author_id = ?",
            (str(author_id),),
        ) as cursor:
            row = await cursor.fetchone()
        value = row["latest"] if row else None
        return int(value) if value is not None else None

    async def add_history(self, payload: Dict[str, Any]) -> None:
        conn = await self._get_conn()
        await conn.execute(
            """
            INSERT INTO history (url, url_type, total_count, success_count, config)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                payload.get("url"),
                payload.get("url_type"),
                payload.get("total_count", 0),
                payload.get("success_count", 0),
                payload.get("config"),
            ),
        )
        await conn.commit()

    async def upsert_transcript_job(self, payload: Dict[str, Any]) -> None:
        conn = await self._get_conn()
        await conn.execute(
            """
            INSERT INTO transcript_jobs (
                aweme_id, video_path, transcript_dir, text_path, json_path,
                model, status, skip_reason, error_message, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(aweme_id) DO UPDATE SET
                video_path=excluded.video_path,
                transcript_dir=excluded.transcript_dir,
                text_path=excluded.text_path,
                json_path=excluded.json_path,
                model=excluded.model,
                status=excluded.status,
                skip_reason=excluded.skip_reason,
                error_message=excluded.error_message,
                updated_at=CURRENT_TIMESTAMP
            """,
            (
                payload.get("aweme_id"),
                payload.get("video_path"),
                payload.get("transcript_dir"),
                payload.get("text_path"),
                payload.get("json_path"),
                payload.get("model"),
                payload.get("status"),
                payload.get("skip_reason"),
                payload.get("error_message"),
            ),
        )
        await conn.commit()

    async def get_transcript_job(self, aweme_id: str) -> Optional[Dict[str, Any]]:
        conn = await self._get_conn()
        async with conn.execute(
            "SELECT * FROM transcript_jobs WHERE aweme_id = ?", (str(aweme_id),)
        ) as cursor:
            row = await cursor.fetchone()
        return dict(row) if row is not None else None

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None
