"""python3 -m unittest scripts/anki/test_export_words.py — the level rules (spec 006, research R1)."""

import unittest

from export_words import level, strongest


class Levels(unittest.TestCase):
    def test_by_stability_in_days(self):
        self.assertEqual([level(2, s) for s in (0.5, 6.9, 7, 20.9, 21, 364.9, 365, 2000)], [
            'anki-learning', 'anki-learning', 'anki-young', 'anki-young',
            'anki-mature', 'anki-mature', 'anki-long-term', 'anki-long-term',
        ])

    def test_a_card_being_relearnt_is_learning_whatever_its_stability(self):
        self.assertEqual(level(3, 400), 'anki-learning')
        self.assertEqual(level(1, 30), 'anki-learning')

    def test_a_word_on_two_notes_takes_the_stronger_card(self):
        words = strongest([
            {'word': '朋友', 'stability': 5.0},
            {'word': '朋友', 'stability': 90.0},
            {'word': '将来', 'stability': 1.0},
        ])
        self.assertEqual({w['word']: w['stability'] for w in words}, {'朋友': 90.0, '将来': 1.0})


if __name__ == '__main__':
    unittest.main()
