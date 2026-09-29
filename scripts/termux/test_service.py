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


if __name__ == '__main__':
    unittest.main()
