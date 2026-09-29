#!/usr/bin/env python3
"""The one long-lived Termux process the app talks to (ADR-0020, contracts/reader-service.md).

    reader-service.py [--root DIR] [--port 8765]

Keeps copies of the reader's work under <root>/backups, and serves <root>/downloads, where
termux-url-opener leaves bundles. Takes the transcripts Reader writes (spec 008, ADR-0029) and starts
translate.py on them. Started at boot by Termux:Boot; ~/.bashrc starts it again when Termux is opened
and it is not running.
"""

import argparse
import hashlib
import http.server
import json
import os
import subprocess
import sys
import time

VERSION = 1
# When this process started, so Reader can tell a restart (Android killed Termux) from a long run.
STARTED = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
KEEP_RECENT = 20
KEEP_DAYS = 30
TRANSLATE = os.environ.get('READER_TRANSLATE', os.path.expanduser('~/bin/translate.py'))


def canonical(value):
    """Keys sorted at every level: the app's `canonical` in src/lib/backup/format.ts, byte for byte."""
    if isinstance(value, list):
        return '[' + ','.join(canonical(v) for v in value) + ']'
    if isinstance(value, dict):
        items = sorted(value.items())
        return '{' + ','.join(json.dumps(k, ensure_ascii=False) + ':' + canonical(v) for k, v in items) + '}'
    return json.dumps(value, ensure_ascii=False)


def whole(copy):
    body = {k: v for k, v in copy.items() if k != 'integrity'}
    return copy.get('integrity') == hashlib.sha256(canonical(body).encode('utf-8')).hexdigest()


def summary(path):
    with open(path, encoding='utf-8') as file:
        copy = json.load(file)
    return {
        'createdAt': copy.get('createdAt'),
        'bytes': os.path.getsize(path),
        'documents': len(copy.get('documents', [])),
        'words': len(copy.get('states', [])),
    }


def prune(backups):
    """The newest 20, plus the newest of each of the last 30 days; nothing younger than 30 days is lost
    unless a newer copy of the same day exists."""
    names = sorted((n for n in os.listdir(backups) if n.endswith('.json')), reverse=True)
    keep = set(names[:KEEP_RECENT])
    days = {}
    for name in names:
        days.setdefault(name[:10], name)
    cutoff = time.strftime('%Y-%m-%d', time.gmtime(time.time() - KEEP_DAYS * 86400))
    keep.update(name for day, name in days.items() if day >= cutoff)
    for name in names:
        if name not in keep:
            os.remove(os.path.join(backups, name))


def translating(folder):
    """Whether translate.py is already running for this job: its lock names a live process."""
    try:
        with open(os.path.join(folder, 'translate.lock'), encoding='utf-8') as file:
            os.kill(int(file.read().strip()), 0)
        return True
    except (OSError, ValueError):
        return False


class Handler(http.server.SimpleHTTPRequestHandler):
    root = ''

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass

    def reply(self, status, body=None):
        data = b'' if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        if body is not None:
            self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.reply(204)

    def backups(self):
        path = os.path.join(self.root, 'backups')
        os.makedirs(path, exist_ok=True)
        return path

    def jobs(self):
        """Recent downloads, newest first: what the app offers as "New from Termux"."""
        downloads = os.path.join(self.root, 'downloads')
        found = []
        for job in sorted(os.listdir(downloads) if os.path.isdir(downloads) else [], reverse=True)[:30]:
            folder = os.path.join(downloads, job)
            bundle = os.path.join(folder, 'bundle.tar')
            progress = os.path.join(folder, 'progress.json')
            if not os.path.isfile(bundle):
                # Still downloading, so Reader can show it from the moment of the share. A progress
                # file nobody has touched for ten minutes is a download that died, not one to wait for.
                try:
                    if time.time() - os.path.getmtime(progress) > 600:
                        continue
                    with open(progress, encoding='utf-8') as file:
                        state = json.load(file)
                except (OSError, ValueError):
                    continue
                found.append({'job': job, 'title': state.get('title') or 'A new video', 'id': None,
                              'bytes': 0, 'ready': False, 'progress': state})
                continue
            try:
                with open(os.path.join(folder, 'meta.json'), encoding='utf-8') as file:
                    meta = json.load(file)
            except (OSError, ValueError):
                meta = {}
            found.append({
                'job': job,
                'title': meta.get('title') or job,
                'id': meta.get('id'),
                'bytes': os.path.getsize(bundle),
                'ready': True,
            })
        return found

    def put_transcript(self, job):
        """A transcript Reader wrote (contracts/reader-service.md): stored, then translated."""
        folder = os.path.join(self.root, 'downloads', job)
        if not job or '/' in job or job.startswith('.') or not os.path.isdir(folder):
            return self.reply(404, {'error': 'no such job'})
        raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        text = raw.decode('utf-8', errors='replace')
        if not text.startswith('WEBVTT') or '-->' not in text:
            return self.reply(400, {'error': 'not WebVTT with a cue'})
        target = os.path.join(folder, 'media.zh.vtt')
        with open(target + '.part', 'wb') as file:
            file.write(raw)
        os.replace(target + '.part', target)
        # An older Termux's markers would make translate.py wait for a transcript still growing.
        for stale in ('transcribing.json', 'status.json'):
            if os.path.exists(os.path.join(folder, stale)):
                os.remove(os.path.join(folder, stale))
        if not translating(folder):
            subprocess.Popen([sys.executable, TRANSLATE, folder], start_new_session=True,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.reply(204)

    def do_PUT(self):
        path = self.path.split('?')[0]
        if path == '/busy':
            # Reader is transcribing: translate.py waits between chunks while this is fresh, so the
            # two do not share the phone's two fast cores (it took windows from 22 s to 55 s).
            with open(os.path.join(self.root, 'busy'), 'w'):
                pass
            return self.reply(204)
        if path.startswith('/downloads/') and path.endswith('/media.zh.vtt'):
            return self.put_transcript(path[len('/downloads/'):-len('/media.zh.vtt')])
        if path != '/backup':
            return self.reply(404)
        raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        try:
            copy = json.loads(raw)
        except ValueError:
            return self.reply(400, {'error': 'not JSON'})
        if not isinstance(copy, dict) or not whole(copy):
            return self.reply(400, {'error': 'integrity does not match'})
        name = (copy.get('createdAt') or time.strftime('%Y-%m-%dT%H:%M:%S')).replace(':', '-') + '.json'
        target = os.path.join(self.backups(), name)
        with open(target + '.part', 'wb') as file:
            file.write(raw)
        os.replace(target + '.part', target)
        prune(self.backups())
        self.reply(204)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/health':
            return self.reply(200, {'version': VERSION, 'started': STARTED})
        if path in ('/backup', '/backup/latest'):
            names = sorted((n for n in os.listdir(self.backups()) if n.endswith('.json')), reverse=True)
            if path == '/backup':
                return self.reply(200, [summary(os.path.join(self.backups(), n)) for n in names])
            if not names:
                return self.reply(404, {'error': 'no copy yet'})
            with open(os.path.join(self.backups(), names[0]), 'rb') as file:
                data = file.read()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        if path.startswith('/media/'):
            wanted = path[len('/media/'):]
            downloads = os.path.join(self.root, 'downloads')
            for job in sorted(os.listdir(downloads) if os.path.isdir(downloads) else [], reverse=True):
                meta = os.path.join(downloads, job, 'meta.json')
                try:
                    with open(meta, encoding='utf-8') as file:
                        if json.load(file).get('id') == wanted and os.path.exists(
                            os.path.join(downloads, job, 'bundle.tar')
                        ):
                            return self.reply(200, {'job': job})
                except (OSError, ValueError):
                    continue
            return self.reply(404, {'error': 'no bundle for that video'})
        if path in ('/downloads', '/downloads/'):
            return self.reply(200, self.jobs())
        if path.startswith('/downloads/'):
            return super().do_GET()
        return self.reply(404)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default=os.path.expanduser('~/.reader'))
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    Handler.root = args.root
    os.makedirs(args.root, exist_ok=True)
    # Downloads live in ~/downloads; the service reaches them through a link in its own root.
    downloads = os.path.join(args.root, 'downloads')
    if not os.path.exists(downloads) and os.path.isdir(os.path.expanduser('~/downloads')):
        os.symlink(os.path.expanduser('~/downloads'), downloads)
    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', args.port), lambda *a: Handler(*a, directory=args.root)
    )
    server.serve_forever()


if __name__ == '__main__':
    main()
