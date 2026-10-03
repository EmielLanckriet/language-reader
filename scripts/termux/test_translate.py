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


class ChosenSource(unittest.TestCase):
    def job(self, tracks):
        import json
        job = tempfile.mkdtemp()
        for file, text in tracks.items():
            with open(os.path.join(job, file), 'w', encoding='utf-8') as out:
                out.write(f'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n{text}\n')
        manifest = [{'file': f, 'lang': f.split('.')[1], 'name': '', 'kind': 'human'} for f in tracks]
        with open(os.path.join(job, 'tracks.json'), 'w', encoding='utf-8') as out:
            json.dump(manifest, out)
        return job

    def test_nothing_is_translated_until_the_reader_chooses(self):
        job = self.job({'track.zh.vtt': '点餐都不行。', 'track.en.vtt': 'Ordering food was impossible.'})
        self.assertEqual(source(job), (None, False))
        with open(os.path.join(job, 'choice.json'), 'w', encoding='utf-8') as out:
            out.write('{"chinese": "track.zh.vtt", "english": "machine"}')
        self.assertEqual(source(job), (os.path.join(job, 'track.zh.vtt'), False))

    def test_the_default_is_translated_when_nothing_is_asked(self):
        job = self.job({'track.zh-Hans.vtt': '点餐都不行。\ndiǎncān dōu bùxíng.', 'track.zh.vtt': '点餐都不行。'})
        self.assertEqual(source(job), (os.path.join(job, 'track.zh.vtt'), False))


class UncoveredLines(unittest.TestCase):
    def test_only_lines_the_chosen_english_leaves_are_translated(self):
        import json, subprocess, sys
        job = tempfile.mkdtemp()
        chinese = ''.join(f'00:00:0{i}.000 --> 00:00:0{i + 1}.000\n第{i}行\n\n' for i in range(3))
        english = ('00:00:00.000 --> 00:00:01.000\nLine zero\n\n'
                   '00:00:02.100 --> 00:00:03.000\nLine two\n\n')
        files = {'track.zh.vtt': 'WEBVTT\n\n' + chinese, 'track.en.vtt': 'WEBVTT\n\n' + english}
        for name, text in files.items():
            with open(os.path.join(job, name), 'w', encoding='utf-8') as out:
                out.write(text)
        with open(os.path.join(job, 'tracks.json'), 'w') as out:
            json.dump([{'file': f, 'lang': f.split('.')[1], 'name': '', 'kind': 'human'} for f in files], out)
        with open(os.path.join(job, 'choice.json'), 'w') as out:
            json.dump({'chinese': 'track.zh.vtt', 'english': 'track.en.vtt'}, out)
        env = dict(os.environ, TRANSLATE_STUB='1', READER_BUSY=os.path.join(job, 'no-busy'),
                   READER_MODEL_LOCK=os.path.join(job, 'model.lock'))
        here = os.path.dirname(os.path.abspath(__file__))
        subprocess.run([sys.executable, os.path.join(here, 'translate.py'), job], env=env, check=True, timeout=30)
        with open(os.path.join(job, 'media.en.vtt'), encoding='utf-8') as out:
            translated = out.read()
        self.assertIn('第1行', translated)
        self.assertNotIn('第0行', translated)
        self.assertNotIn('第2行', translated)
        with open(os.path.join(job, 'translate.json')) as out:
            self.assertEqual(json.load(out)['total'], 1)


class Cues(unittest.TestCase):
    def test_timing_is_kept_whole(self):
        # a7a6b86 shadowed TIMING with a bare '-->' and every English cue lost its times.
        job = tempfile.mkdtemp()
        path = os.path.join(job, 'media.zh.vtt')
        with open(path, 'w', encoding='utf-8') as file:
            file.write('WEBVTT\n\n00:00:02.800 --> 00:00:04.000\n点餐都不行。\n')
        self.assertEqual(translate.cues(path), [('00:00:02.800 --> 00:00:04.000', '点餐都不行。')])


class TrackChoice(unittest.TestCase):
    # The table tests/media/track-choice.test.ts also runs: the app and Termux must agree (spec 012).
    TABLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tests', 'fixtures',
                         'track-choice-cases.json')

    def test_shared_cases(self):
        import json
        with open(self.TABLE, encoding='utf-8') as file:
            cases = json.load(file)['cases']
        for case in cases:
            with self.subTest(case['name']):
                tracks = [dict(t, text=t['vtt']) for t in case['tracks']]
                classified = translate.classify_tracks(tracks)
                chinese, english = translate.default_choice(classified)
                self.assertEqual(chinese, case['expect']['chinese'])
                self.assertEqual(english, case['expect']['english'])
                self.assertEqual(translate.choice_needed(classified), case['expect']['needed'])


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
