"""Named faster-whisper profiles; UI exposes intent instead of fragile raw knobs."""


def transcription_options(quality="balanced", hotwords=None):
    options = {
        "vad_filter": True,
        "word_timestamps": True,
    }
    if quality == "accurate":
        options.update(
            {
                "beam_size": 8,
                "patience": 1.2,
                "no_speech_threshold": 0.7,
                "language_detection_segments": 3,
                "vad_parameters": {
                    "threshold": 0.35,
                    "min_speech_duration_ms": 0,
                    "min_silence_duration_ms": 500,
                    "speech_pad_ms": 600,
                },
            }
        )
    if hotwords and hotwords.strip():
        options["hotwords"] = hotwords.strip()
    return options
