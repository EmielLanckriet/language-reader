"""python3 -m unittest scripts/termux/test_translate.py — the one check on placing the LLM's English."""

import concurrent.futures
import threading
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

    def test_the_clean_track_the_app_shows_is_translated(self):
        # Jun - Stickynote Chinese: zh-Hans carries a pinyin line under each line, zh is clean, and
        # the app imports zh (src/lib/media/subtitles.ts, chooseChineseTrack).
        job = tempfile.mkdtemp()
        tracks = {
            'media.zh-Hans.vtt': '点餐都不行。\ndiǎncān dōu bùxíng.',
            'media.zh.vtt': '点餐都不行。',
        }
        for name, cue in tracks.items():
            with open(os.path.join(job, name), 'w', encoding='utf-8') as file:
                file.write(f'WEBVTT\n\n00:00:02.800 --> 00:00:04.000\n{cue}\n')
        self.assertEqual(source(job), (os.path.join(job, 'media.zh.vtt'), False))


class ModelBudget(unittest.TestCase):
    def test_running_model_is_killed_when_memory_falls(self):
        child = mock.Mock()
        child.communicate.side_effect = [translate.subprocess.TimeoutExpired('llama', 2), ('', '')]
        child.poll.return_value = None
        with mock.patch.object(translate.subprocess, 'Popen', return_value=child), \
             mock.patch.object(translate, 'available_kb', return_value=100_000), \
             mock.patch.object(translate, 'reader_busy', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'protect phone'):
                translate.run_model(['fake-model'])
        child.kill.assert_called_once()


    def test_different_jobs_cannot_run_models_together(self):
        entered = threading.Event()
        release = threading.Event()
        calls = []

        def run(*args, **kwargs):
            calls.append(args)
            entered.set()
            release.wait(2)
            return 'ok'

        with tempfile.TemporaryDirectory() as root, \
             mock.patch.object(translate, 'MODEL_LOCK', os.path.join(root, 'model.lock'), create=True), \
             mock.patch.object(translate, 'wait_for_memory'), \
             mock.patch.object(translate, 'wait_for_reader'), \
             mock.patch.object(translate, 'STUB', False), \
             mock.patch.object(translate, 'run_model', run), \
             concurrent.futures.ThreadPoolExecutor(2) as pool:
            first = pool.submit(translate.ask, ['你好'])
            self.assertTrue(entered.wait(1))
            second = pool.submit(translate.ask, ['世界'])
            try:
                time.sleep(0.1)
                self.assertEqual(len(calls), 1)
            finally:
                release.set()
            first.result(timeout=3)
            second.result(timeout=3)
            self.assertEqual(len(calls), 2)


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
