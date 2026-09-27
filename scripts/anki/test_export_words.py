"""python3 -m unittest scripts/anki/test_export_words.py — the level rules (spec 006, research R1),
and what format 2 reads from each card (spec 007, contracts/formats.md)."""

import unittest

import struct

from export_words import card_word, level, parameters_in, strongest


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


class CardWord(unittest.TestCase):
    FIELDS = '将来\x1fjiāng lái\x1ffuture'

    def test_reads_stability_difficulty_decay_and_the_last_review(self):
        word = card_word(self.FIELDS, 0, 2, 900, '{"s":983.68,"d":6.708,"decay":0.264}', 1, 0, 1787064920869)
        self.assertEqual(word, {
            'word': '将来', 'level': 'anki-long-term', 'stability': 983.7, 'difficulty': 6.708,
            'decay': 0.264, 'lastReview': '2026-08-18T14:55:20Z', 'type': 2, 'lapses': 1,
            'suspended': False,
        })

    def test_a_card_without_fsrs_memory_has_its_interval_and_no_difficulty(self):
        word = card_word(self.FIELDS, 0, 2, 30, '', 0, -1, None)
        self.assertEqual((word['stability'], word['difficulty'], word['decay'], word['lastReview'], word['suspended']),
                         (30.0, None, None, None, True))

    def test_an_empty_field_is_no_word(self):
        self.assertIsNone(card_word(' \x1fx', 0, 2, 3, '', 0, 0, None))


def preset(weights, retention):
    """A deck-config blob as Anki writes it: field 6 packed floats, field 37 a float."""
    def varint(value):
        out = bytearray()
        while value >= 0x80:
            out.append(value & 0x7F | 0x80)
            value >>= 7
        return bytes(out + bytes([value]))

    packed = struct.pack(f'<{len(weights)}f', *weights)
    return varint(6 << 3 | 2) + varint(len(packed)) + packed + varint(37 << 3 | 5) + struct.pack('<f', retention)


class Parameters(unittest.TestCase):
    MINE = [0.1] * 20 + [0.2641]
    OTHER = [0.4] * 20 + [0.1494]

    def test_takes_the_preset_whose_decay_the_cards_have(self):
        found = parameters_in([('Bonus', preset(self.OTHER, 0.85)), ('Default', preset(self.MINE, 0.9))],
                              [0.264, 0.264, 0.1494])
        self.assertEqual(found['preset'], 'Default')
        self.assertEqual([round(w, 4) for w in found['weights']], self.MINE)
        self.assertAlmostEqual(found['retention'], 0.9, places=5)

    def test_none_without_fsrs_6_weights(self):
        self.assertIsNone(parameters_in([('Default', preset([0.1] * 19, 0.9))], [0.264]))


if __name__ == '__main__':
    unittest.main()
