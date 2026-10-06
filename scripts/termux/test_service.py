"""python3 -m unittest scripts/termux/test_service.py — the one check on taking Reader's transcript.

A transcript Reader sends (spec 008, contracts/reader-service.md) is stored, and starts one
translation: sent again while that runs, it does not start a second.
"""

import http.client
import importlib.util
import os
import tempfile
import textwrap
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
VTT = 'WEBVTT\n\n00:00:00.200 --> 00:00:01.000\n上海街头采访\n'


def load_service(translate):
    os.environ['READER_TRANSLATE'] = translate
    spec = importlib.util.spec_from_file_location('reader_service', os.path.join(HERE, 'reader-service.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TakingATranscript(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.job = os.path.join(self.root, 'downloads', 'job-1')
        os.makedirs(self.job)
        # A translate.py that holds the lock for a moment and notes that it ran.
        stub = os.path.join(self.root, 'translate-stub.py')
        with open(stub, 'w') as file:
            file.write(textwrap.dedent('''
                import os, sys, time
                job = sys.argv[1]
                open(os.path.join(job, 'translate.lock'), 'w').write(str(os.getpid()))
                open(os.path.join(job, 'runs'), 'a').write('run\\n')
                time.sleep(1.5)
                os.remove(os.path.join(job, 'translate.lock'))
            '''))
        service = load_service(stub)
        service.Handler.root = self.root
        self.server = service.http.server.ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()

    def put(self, job, body):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1])
        connection.request('PUT', f'/downloads/{job}/media.zh.vtt', body=body.encode('utf-8'),
                           headers={'Content-Type': 'text/vtt'})
        return connection.getresponse().status

    def test_stores_the_transcript_and_starts_one_translation(self):
        self.assertEqual(self.put('job-1', VTT), 204)
        with open(os.path.join(self.job, 'media.zh.vtt'), encoding='utf-8') as file:
            self.assertEqual(file.read(), VTT)
        deadline = time.time() + 5
        while not os.path.exists(os.path.join(self.job, 'translate.lock')) and time.time() < deadline:
            time.sleep(0.05)
        self.assertEqual(self.put('job-1', VTT), 204)
        time.sleep(2)
        with open(os.path.join(self.job, 'runs')) as file:
            self.assertEqual(file.read().count('run'), 1)

    def test_busy_touches_the_file_translate_waits_on(self):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1])
        connection.request('PUT', '/busy')
        self.assertEqual(connection.getresponse().status, 204)
        self.assertLess(time.time() - os.path.getmtime(os.path.join(self.root, 'busy')), 5)

    def test_refuses_an_unknown_job_and_what_is_not_a_transcript(self):
        self.assertEqual(self.put('no-such-job', VTT), 404)
        self.assertEqual(self.put('..', VTT), 404)
        self.assertEqual(self.put('job-1', 'not subtitles'), 400)


class TakingAChoice(TakingATranscript):
    """Spec 012: Reader reports the tracks it imported; Termux translates only then."""

    def setUp(self):
        super().setUp()
        import json
        for name in ('track.zh.vtt', 'track.en.vtt'):
            with open(os.path.join(self.job, name), 'w', encoding='utf-8') as file:
                file.write(VTT)
        with open(os.path.join(self.job, 'tracks.json'), 'w', encoding='utf-8') as file:
            json.dump([{'file': 'track.zh.vtt', 'lang': 'zh', 'name': '', 'kind': 'human'},
                       {'file': 'track.en.vtt', 'lang': 'en', 'name': '', 'kind': 'human'}], file)

    def choose(self, job, body):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1])
        connection.request('PUT', f'/downloads/{job}/choice.json', body=body.encode('utf-8'),
                           headers={'Content-Type': 'application/json'})
        return connection.getresponse().status

    def started(self):
        deadline = time.time() + 3
        while time.time() < deadline:
            if os.path.exists(os.path.join(self.job, 'runs')):
                return True
            time.sleep(0.05)
        return False

    def test_stores_the_choice_and_starts_translating(self):
        self.assertEqual(self.choose('job-1', '{"chinese": "track.zh.vtt", "english": "machine"}'), 204)
        with open(os.path.join(self.job, 'choice.json'), encoding='utf-8') as file:
            self.assertIn('track.zh.vtt', file.read())
        self.assertTrue(self.started())

    def test_starts_nothing_for_human_or_no_english_or_a_transcript_to_come(self):
        self.assertEqual(self.choose('job-1', '{"chinese": "track.zh.vtt", "english": "track.en.vtt"}'), 204)
        self.assertEqual(self.choose('job-1', '{"chinese": "track.zh.vtt", "english": "none"}'), 204)
        self.assertEqual(self.choose('job-1', '{"chinese": "transcribe", "english": "machine"}'), 204)
        self.assertFalse(self.started())

    def test_refuses_what_the_job_does_not_have(self):
        self.assertEqual(self.choose('job-1', '{"chinese": "track.fr.vtt", "english": "machine"}'), 400)
        self.assertEqual(self.choose('job-1', '{"chinese": "track.zh.vtt", "english": "../x"}'), 400)
        self.assertEqual(self.choose('job-1', 'not json'), 400)
        self.assertEqual(self.choose('no-such-job', '{"chinese": "transcribe", "english": "none"}'), 404)


class HoldingTheWakeLock(unittest.TestCase):
    """Issue #27: the wake lock only while a download or translation runs, not all night."""

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.job = os.path.join(self.root, 'downloads', 'job-1')
        os.makedirs(self.job)
        self.service = load_service('unused')
        self.calls = []
        self.lock = self.service.WakeLock(self.calls.append, grace=60)

    def test_sees_a_download_and_a_translation_but_not_a_finished_or_dead_job(self):
        working = self.service.working
        self.assertFalse(working(self.root))
        progress = os.path.join(self.job, 'progress.json')
        open(progress, 'w').write('{"stage": "starting"}')
        self.assertTrue(working(self.root))
        os.utime(progress, (time.time() - 700, time.time() - 700))
        self.assertFalse(working(self.root))
        open(os.path.join(self.job, 'translate.lock'), 'w').write(str(os.getpid()))
        self.assertTrue(working(self.root))
        open(os.path.join(self.job, 'translate.lock'), 'w').write('999999999')
        self.assertFalse(working(self.root))

    def test_takes_it_for_a_job_and_releases_it_after_a_minute_idle(self):
        lock = self.lock
        lock.update(False, 0)
        lock.update(False, 59)
        self.assertEqual(self.calls, [])
        # A lock an older version left held is released too.
        lock.update(False, 60)
        self.assertEqual(self.calls, ['termux-wake-unlock'])
        lock.update(True, 100)
        lock.update(True, 115)
        lock.update(False, 130)
        lock.update(True, 145)
        lock.update(False, 160)
        lock.update(False, 219)
        self.assertEqual(self.calls, ['termux-wake-unlock', 'termux-wake-lock'])
        lock.update(False, 220)
        lock.update(False, 300)
        self.assertEqual(self.calls, ['termux-wake-unlock', 'termux-wake-lock', 'termux-wake-unlock'])


if __name__ == '__main__':
    unittest.main()
