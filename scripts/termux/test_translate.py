"""python3 -m unittest scripts/termux/test_translate.py — the one check on placing the LLM's English."""

import json
import os
import tempfile
import time
import unittest
from unittest import mock

import translate
from translate import place, source


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


class Source(unittest.TestCase):
    def test_a_transcript_reader_sent_is_complete(self):
        # Spec 008: Reader writes the transcript; the service stores it as media.zh.vtt, and no
        # transcribing.json or status.json is there to say it is still growing.
        job = tempfile.mkdtemp()
        with open(os.path.join(job, 'media.zh.vtt'), 'w', encoding='utf-8') as file:
            file.write('WEBVTT\n\n00:00:00.200 --> 00:00:01.000\n上海\n')
        self.assertEqual(source(job), (os.path.join(job, 'media.zh.vtt'), False))


class Clauses(unittest.TestCase):
    LINES = ['同时呢各个主要经济体', '都面临着经济增速受限', '保护主义抬头等等', '下一个就是2025年', '不得不提的一个词', 'AI']

    def test_a_clause_ends_where_the_model_put_a_mark_after_a_line(self):
        # What Qwen3-1.7B wrote for these lines, 是 added: that costs no boundary but its own.
        punctuated = '同时呢，各个主要经济体都面临着经济增速受限，保护主义抬头等等，下一个就是2025年，不得不提的一个词是AI。'
        self.assertEqual(translate.ends_from(self.LINES, punctuated), {1, 2, 3, 5})
        self.assertEqual(translate.groups(self.LINES, {1, 2, 3, 5}), [[0, 1], [2, 2], [3, 3], [4, 5]])

    def test_a_group_with_no_mark_is_still_cut_at_the_length_limit(self):
        long = ['一二三四五六七八九十'] * 6
        self.assertEqual(translate.groups(long, set()), [[0, 3], [4, 5]])

    def test_one_english_cue_spans_the_lines_of_a_clause(self):
        job = tempfile.mkdtemp()
        with open(os.path.join(job, 'media.zh.vtt'), 'w', encoding='utf-8') as file:
            file.write('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n今天天气\n\n'
                       '00:00:02.000 --> 00:00:03.500\n非常好\n\n00:00:03.500 --> 00:00:05.000\n我们去公园吧\n')
        with mock.patch.object(translate, 'STUB', True), \
                mock.patch.object(translate, 'sentence_ends', lambda lines: {1, 2}), \
                mock.patch.object(translate, 'wait_for_reader', lambda: None):
            translate.main(job)
        with open(os.path.join(job, 'media.en.vtt'), encoding='utf-8') as file:
            english = file.read()
        self.assertEqual(english, 'WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nEN: 今天天气非常好\n\n'
                                  '00:00:03.500 --> 00:00:05.000\nEN: 我们去公园吧\n\n')
        with open(os.path.join(job, 'translate.json')) as file:
            self.assertEqual(json.load(file), {'through': 3, 'total': 3, 'done': True})


class WaitingForReader(unittest.TestCase):
    def test_waits_while_reader_is_busy_and_not_once_it_stops(self):
        busy = os.path.join(tempfile.mkdtemp(), 'busy')
        open(busy, 'w').close()
        slept = []

        def sleep(seconds):
            # Reader stops sending: the file ages past the limit.
            slept.append(seconds)
            os.utime(busy, (0, 0))

        with mock.patch.object(translate, 'BUSY', busy), mock.patch.object(translate.time, 'sleep', sleep):
            translate.wait_for_reader()
            self.assertEqual(len(slept), 1)
            translate.wait_for_reader()
            self.assertEqual(len(slept), 1)


if __name__ == '__main__':
    unittest.main()
