"""Helpers for turning Whisper segments into readable, lossless subtitle cues."""

from __future__ import annotations

import re


BREAK_PUNCTUATION = ".!?。！？…"
CJK_CHARACTER = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")


def _number(value, fallback=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(fallback)


def _cue_text(words):
    raw = "".join(str(word.get("text", "")) for word in words).strip()
    return re.sub(r"[ \t]+", " ", raw)


def _cue_from_words(words):
    return {
        "start": _number(words[0].get("start")),
        "end": _number(words[-1].get("end"), words[0].get("start")),
        "text": _cue_text(words),
        "words": list(words),
    }


def _is_mostly_cjk(text):
    informative = [character for character in text if character.isalnum()]
    if not informative:
        return False
    cjk_count = sum(bool(CJK_CHARACTER.match(character)) for character in informative)
    return cjk_count / len(informative) >= 0.5


def _split_words(words, max_chars, max_seconds, gap_seconds, split_leading_space=False):
    cues = []
    current = []

    def flush():
        if current:
            cue = _cue_from_words(current)
            if cue["text"]:
                cues.append(cue)
            current.clear()

    for word in words:
        text = str(word.get("text", ""))
        if not text.strip():
            continue
        start = _number(word.get("start"))
        end = max(start, _number(word.get("end"), start))
        normalized = {**word, "start": start, "end": end, "text": text}

        # Faster Whisper preserves an otherwise invisible leading space on the
        # first word of each CJK phrase. The pauses between these phrases are
        # often too short for a silence-only splitter, but the space is a stable
        # boundary signal. Latin transcripts are excluded because nearly every
        # Latin word can begin with a space.
        leading_phrase_boundary = (
            split_leading_space and current and bool(text[:1].isspace())
        )

        if leading_phrase_boundary:
            flush()
        elif current:
            previous_end = _number(current[-1].get("end"))
            gap = max(0.0, start - previous_end)
            next_text = _cue_text([*current, normalized])
            next_duration = end - _number(current[0].get("start"))
            previous_text = str(current[-1].get("text", "")).rstrip()
            if (
                gap >= gap_seconds
                or previous_text.endswith(tuple(BREAK_PUNCTUATION))
                or len(next_text) > max_chars
                or next_duration > max_seconds
            ):
                flush()

        current.append(normalized)

    flush()
    return cues


def resegment_segments(
    segments,
    max_chars=42,
    max_seconds=7.0,
    gap_seconds=0.24,
):
    """Split long model segments without dropping or duplicating recognized words."""
    cues = []
    for segment in segments:
        start = _number(segment.get("start"))
        end = max(start, _number(segment.get("end"), start))
        text = str(segment.get("text", "")).strip()
        words = [word for word in (segment.get("words") or []) if str(word.get("text", "")).strip()]

        needs_split = end - start > max_seconds or len(text) > max_chars
        if needs_split and words:
            split = _split_words(
                words,
                max_chars,
                max_seconds,
                gap_seconds,
                split_leading_space=_is_mostly_cjk(text),
            )
            if split:
                for cue in split:
                    for key in ("avg_logprob", "no_speech_prob", "compression_ratio"):
                        if key in segment:
                            cue[key] = segment[key]
                cues.extend(split)
                continue

        if text:
            cues.append({**segment, "start": start, "end": end, "text": text})
    return cues


def transcript_diagnostics(segments, duration):
    """Return timeline diagnostics used to flag likely missing beginnings or endings."""
    duration = max(0.0, _number(duration))
    intervals = sorted(
        (
            max(0.0, _number(segment.get("start"))),
            max(0.0, _number(segment.get("end"))),
        )
        for segment in segments
        if str(segment.get("text", "")).strip()
    )
    if not intervals:
        return {
            "recognized_seconds": 0.0,
            "coverage_percent": 0.0,
            "last_end": 0.0,
            "max_gap_seconds": duration,
            "warnings": ["Khong nhan duoc noi dung nao."],
        }

    merged = []
    for start, end in intervals:
        end = max(start, end)
        if not merged or start > merged[-1][1]:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)

    recognized = sum(end - start for start, end in merged)
    gaps = [merged[0][0]]
    gaps.extend(max(0.0, merged[i][0] - merged[i - 1][1]) for i in range(1, len(merged)))
    if duration:
        gaps.append(max(0.0, duration - merged[-1][1]))

    warnings = []
    if merged[0][0] > 1.0:
        warnings.append("Co khoang trong lon o dau tep.")
    if duration and duration - merged[-1][1] > 1.0:
        warnings.append("Co khoang trong lon o cuoi tep.")

    return {
        "recognized_seconds": round(recognized, 3),
        "coverage_percent": round((recognized / duration * 100.0) if duration else 0.0, 2),
        "last_end": round(merged[-1][1], 3),
        "max_gap_seconds": round(max(gaps) if gaps else 0.0, 3),
        "warnings": warnings,
    }
