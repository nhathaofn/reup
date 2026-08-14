import os
import sys
import unittest


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from subtitle_segments import resegment_segments, transcript_diagnostics
from transcription_quality import transcription_options


class SubtitleSegmentsTest(unittest.TestCase):
    def test_long_segment_splits_on_word_gaps_without_losing_text(self):
        segment = {
            "start": 0.0,
            "end": 8.0,
            "text": "cau mot cau hai cau ba",
            "words": [
                {"start": 0.0, "end": 1.0, "text": "cau mot"},
                {"start": 1.35, "end": 2.4, "text": " cau hai"},
                {"start": 2.75, "end": 4.0, "text": " cau ba"},
            ],
        }

        cues = resegment_segments([segment], max_seconds=3.0, gap_seconds=0.24)

        self.assertEqual([cue["text"] for cue in cues], ["cau mot", "cau hai", "cau ba"])
        self.assertEqual("".join(cue["text"].replace(" ", "") for cue in cues), "caumotcauhaicauba")
        self.assertEqual(cues[0]["start"], 0.0)
        self.assertEqual(cues[-1]["end"], 4.0)

    def test_short_segment_is_preserved(self):
        segment = {"start": 1.0, "end": 2.0, "text": "Xin chao", "words": []}
        self.assertEqual(resegment_segments([segment]), [segment])

    def test_cjk_leading_spaces_mark_phrase_boundaries(self):
        segment = {
            "start": 0.0,
            "end": 9.0,
            "text": "\u8fd9\u662f\u4ec0\u4e48\u5728\u6e38\u6cf3 \u8fd9\u662f\u9752\u86d9\u5728\u6e38\u6cf3 \u8fd9\u662f\u4ec0\u4e48\u5728\u6e38\u6cf3",
            "words": [
                {"start": 0.0, "end": 0.3, "text": "\u8fd9\u662f"},
                {"start": 0.3, "end": 0.6, "text": "\u4ec0\u4e48"},
                {"start": 0.6, "end": 0.8, "text": "\u5728"},
                {"start": 0.8, "end": 1.0, "text": "\u6e38"},
                {"start": 1.0, "end": 1.3, "text": "\u6cf3"},
                {"start": 1.44, "end": 1.7, "text": " \u8fd9\u662f"},
                {"start": 1.7, "end": 2.1, "text": "\u9752\u86d9"},
                {"start": 2.1, "end": 2.3, "text": "\u5728"},
                {"start": 2.3, "end": 2.6, "text": "\u6e38"},
                {"start": 2.6, "end": 3.0, "text": "\u6cf3"},
                {"start": 3.14, "end": 3.4, "text": " \u8fd9\u662f"},
                {"start": 3.4, "end": 3.8, "text": "\u4ec0\u4e48"},
                {"start": 3.8, "end": 4.0, "text": "\u5728"},
                {"start": 4.0, "end": 4.3, "text": "\u6e38"},
                {"start": 4.3, "end": 4.6, "text": "\u6cf3"},
            ],
        }

        cues = resegment_segments([segment])

        self.assertEqual(
            [cue["text"] for cue in cues],
            ["\u8fd9\u662f\u4ec0\u4e48\u5728\u6e38\u6cf3", "\u8fd9\u662f\u9752\u86d9\u5728\u6e38\u6cf3", "\u8fd9\u662f\u4ec0\u4e48\u5728\u6e38\u6cf3"],
        )
        self.assertEqual(cues[0]["end"], 1.3)
        self.assertEqual(cues[1]["start"], 1.44)

    def test_diagnostics_flags_missing_tail(self):
        diagnostics = transcript_diagnostics(
            [{"start": 0.2, "end": 3.0, "text": "noi dung"}],
            5.0,
        )
        self.assertIn("Co khoang trong lon o cuoi tep.", diagnostics["warnings"])
        self.assertEqual(diagnostics["last_end"], 3.0)

    def test_accurate_profile_is_high_recall(self):
        options = transcription_options("accurate", " ten rieng ")
        self.assertEqual(options["beam_size"], 8)
        self.assertLess(options["vad_parameters"]["threshold"], 0.5)
        self.assertGreater(options["vad_parameters"]["speech_pad_ms"], 400)
        self.assertEqual(options["hotwords"], "ten rieng")


if __name__ == "__main__":
    unittest.main()
