"""python3 -m unittest scripts/termux/test_transcribe.py — the one check on cutting whisper's output."""

import unittest

from transcribe import lines


def token(text, start, end):
    return {'text': text, 'offsets': {'from': start, 'to': end}}


class Cutting(unittest.TestCase):
    def test_one_long_punctuated_segment_becomes_a_line_per_clause_at_its_own_time(self):
        # What base returned for Chef Wang's first 30 s with the prompt: one segment for all of it.
        segment = {
            'offsets': {'from': 0, 'to': 5690},
            'tokens': [
                token('[_BEG_]', 0, 0),
                token('哈', 120, 120), token('喽', 360, 480), token('大家好', 480, 840), token(',', 840, 1080),
                token('我是', 1080, 1320), token('王刚', 1320, 1600), token(',', 1600, 1630),
                token('番茄', 4250, 4700), token('炒鸡蛋', 4700, 5600), token('。', 5600, 5690),
            ],
        }
        self.assertEqual(
            lines([segment]),
            [(120, 1080, '哈喽大家好'), (1080, 1630, '我是王刚'), (4250, 5690, '番茄炒鸡蛋。')],
        )

    def test_unpunctuated_speech_is_still_cut_into_readable_lines(self):
        segment = {
            'offsets': {'from': 0, 'to': 9000},
            'tokens': [token('然后我们把锅烧热', i * 1000, i * 1000 + 900) for i in range(9)],
        }
        self.assertTrue(all(len(text) <= 24 + 8 for _, _, text in lines([segment])))
        self.assertGreater(len(lines([segment])), 1)


if __name__ == '__main__':
    unittest.main()
