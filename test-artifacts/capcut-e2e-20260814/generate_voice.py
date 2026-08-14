import asyncio
from pathlib import Path
import sys

import edge_tts


ROOT = Path(__file__).resolve().parent

JOBS = [
    ("voice-vi.srt", "voice-vi", "vi-VN-HoaiMyNeural"),
    ("voice-en.srt", "voice-en", "en-US-JennyNeural"),
]


def read_cues(path: Path):
    blocks = path.read_text(encoding="utf-8").strip().split("\n\n")
    for block in blocks:
        lines = block.splitlines()
        yield int(lines[0]), " ".join(lines[2:]).strip()


async def main():
    for srt_name, folder_name, voice in JOBS:
        out_dir = ROOT / folder_name
        out_dir.mkdir(exist_ok=True)
        for index, text in read_cues(ROOT / srt_name):
            output = out_dir / f"{index:03d}.mp3"
            for attempt in range(3):
                try:
                    communicate = edge_tts.Communicate(text, voice)
                    await communicate.save(str(output))
                    if output.stat().st_size > 1024:
                        break
                except Exception as exc:
                    if attempt == 2:
                        print(f"failed {output.name}: {exc}", file=sys.stderr)
                        raise
                await asyncio.sleep(0.5)
            print(f"created {output.name}: {text}")


if __name__ == "__main__":
    asyncio.run(main())
