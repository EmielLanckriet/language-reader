"""python3 -m unittest scripts/termux/test_translate.py — the one check on placing the LLM's English."""

import unittest

from translate import place


class Placing(unittest.TestCase):
    def test_a_merged_line_costs_that_line_not_every_line_after_it(self):
        # What Qwen3-1.7B Q4 did with the tariff video (ADR-0023): it merged lines 2 and 3 and kept
        # counting, so the count matched and, by number, every later line was one off.
        lines = ['朋友们', '那他去年轰轰烈烈', '发起的', '全球关税战', '都白整了吗']
        answers = [
            (1, '朋友们', 'Friends'),
            (2, '那他去年轰轰烈烈发起的', 'he launched a big campaign last year'),
            (3, '全球关税战', 'the global trade war'),
            (4, '都白整了吗', 'was it all for nothing?'),
            (5, '/no_think', '...'),
        ]
        self.assertEqual(
            place(lines, answers),
            ['Friends', None, None, 'the global trade war', 'was it all for nothing?'],
        )

    def test_the_number_breaks_a_tie_between_lines_with_the_same_chinese(self):
        lines = ['美国', '关税', '美国']
        answers = [(1, '美国', 'America'), (2, '关税', 'tariffs'), (3, '美国。', 'the US')]
        self.assertEqual(place(lines, answers), ['America', 'tariffs', 'the US'])


if __name__ == '__main__':
    unittest.main()
