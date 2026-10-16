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
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid

VERSION = 1
# When this process started, so Reader can tell a restart (Android killed Termux) from a long run.
STARTED = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
KEEP_RECENT = 20
KEEP_DAYS = 30
TRANSLATE = os.environ.get('READER_TRANSLATE', os.path.expanduser('~/bin/translate.py'))
# Find videos (spec 015): yt-dlp for search and subtitles, the opener for a chosen video's download.
YTDLP = os.environ.get('READER_YTDLP') or shutil.which('yt-dlp') or 'yt-dlp'
OPENER = os.environ.get('READER_OPENER', os.path.expanduser('~/bin/termux-url-opener'))
# The automatic Chinese the opener asks for when no human Chinese track exists: never a translation.
AUTO_CHINESE = 'zh,zh-CN,zh-Hans,zh-SG,zh-TW,zh-Hant,zh-HK'
# One yt-dlp at a time: polite to YouTube, and the phone has two fast cores.
YTDLP_LOCK = threading.Lock()


def ytdlp(*args, timeout=300):
    """Run yt-dlp through python3, as the opener does: its zipapp's env shebang fails from a task."""
    with YTDLP_LOCK:
        return subprocess.run([sys.executable, YTDLP, '--js-runtimes', 'node', *args],
                              capture_output=True, text=True, timeout=timeout)


def refused(result):
    return 'HTTP Error 429' in result.stderr


def search(query, count):
    result = ytdlp('--flat-playlist', '-j', f'ytsearch{count}:{query}')
    if refused(result):
        return 429, {'state': 'rate-limited'}
    found = []
    for line in result.stdout.splitlines():
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        found.append({'id': entry['id'], 'url': f"https://www.youtube.com/watch?v={entry['id']}",
                      'title': entry.get('title') or '', 'channel': entry.get('channel') or entry.get('uploader') or '',
                      'duration': entry.get('duration')})
    if not found and result.returncode != 0:
        return 502, {'error': (result.stderr.strip().splitlines() or ['yt-dlp failed'])[-1]}
    return 200, found


def subtitles(video):
    """Chinese tracks only, by the opener's rule: human ones, else automatic Chinese."""
    url = f'https://www.youtube.com/watch?v={video}'
    folder = tempfile.mkdtemp(prefix='find-')
    try:
        common = ('--skip-download', '--no-playlist', '--sub-format', 'vtt', '--sleep-requests', '1',
                  '--sleep-subtitles', '1', '-P', folder)
        first = ytdlp(*common, '--write-subs', '--write-info-json', '--sub-langs', 'zh.*',
                      '-o', 'subtitle:track.%(ext)s', '-o', 'media.%(ext)s', url)
        if refused(first):
            return 429, {'state': 'rate-limited'}
        kind, prefix = 'human', 'track.'
        if not any(n.startswith('track.zh') for n in os.listdir(folder)):
            second = ytdlp(*common, '--write-auto-subs', '--sub-langs', AUTO_CHINESE,
                           '-o', 'subtitle:track-auto.%(ext)s', url)
            if refused(second):
                return 429, {'state': 'rate-limited'}
            kind, prefix = 'automatic', 'track-auto.'
        try:
            with open(os.path.join(folder, 'media.info.json'), encoding='utf-8') as file:
                info = json.load(file)
        except (OSError, ValueError):
            info = {}
        listed = info.get('subtitles' if kind == 'human' else 'automatic_captions', {})
        tracks = []
        for name in sorted(os.listdir(folder)):
            if not (name.startswith(prefix + 'zh') and name.endswith('.vtt')):
                continue
            lang = name[len(prefix):-len('.vtt')]
            with open(os.path.join(folder, name), encoding='utf-8', errors='replace') as file:
                text = file.read()
            tracks.append({'lang': lang, 'name': (listed.get(lang) or [{}])[0].get('name') or '',
                           'kind': kind, 'text': text})
        if tracks:
            return 200, {'state': 'ok', 'tracks': tracks}
        if first.returncode != 0 and not info:
            return 502, {'error': (first.stderr.strip().splitlines() or ['yt-dlp failed'])[-1]}
        return 200, {'state': 'no-chinese'}
    finally:
        shutil.rmtree(folder, ignore_errors=True)


# Stories (spec 016): drafts are written by the laptop's writer when it answers, else by story.py.
STORY = os.environ.get('READER_STORY', os.path.expanduser('~/bin/story.py'))
LAPTOP = 'http://127.0.0.1:8766'  # the laptop over USB, after `adb reverse tcp:8766 tcp:8766`
GENERATIONS = {}
GENERATIONS_LOCK = threading.Lock()
# How long a draft may wait for free memory or for Reader's transcription before it gives up and says
# why; the model held by a translation may take longer, since that ends by itself.
STORY_WAIT_MODEL = 600


def story_wait():
    return float(os.environ.get('READER_STORY_WAIT_SECONDS', '180'))
# story.py's stderr, and translate.py's own messages it passes on: what the draft waits for.
WAITING = {'waiting model': 'model', 'waiting for sufficient measurable free memory': 'memory',
           'waiting while Reader transcribes': 'reader'}
GAVE_UP = {
    'memory': 'The phone is short of memory (a story needs 2 GB free). Close other apps, or start '
              "the laptop's story writer, then try again.",
    'reader': 'Reader is transcribing a video, which goes first. Try again when it has finished.',
    'model': "A translation kept the phone's model busy. Try again in a few minutes.",
}


def laptop_urls(root):
    """Where the laptop's writer may be: over USB, then the Wi-Fi address saved in laptop.json."""
    if os.environ.get('READER_LAPTOP_URLS'):
        return os.environ['READER_LAPTOP_URLS'].split(',')
    urls = [LAPTOP]
    try:
        with open(os.path.join(root, 'laptop.json'), encoding='utf-8') as file:
            saved = json.load(file).get('url')
        if saved:
            urls.append(saved.rstrip('/'))
    except (OSError, ValueError):
        pass
    return urls


def answers(url):
    try:
        with urllib.request.urlopen(f'{url}/health', timeout=3):
            return True
    except Exception:
        return False


def generate(job, body, root):
    def state(**fields):
        with GENERATIONS_LOCK:
            GENERATIONS[job].update(fields)

    started = time.monotonic()
    for url in laptop_urls(root):
        if not answers(url):
            continue
        state(state='writing', where='laptop')
        try:
            request = urllib.request.Request(f'{url}/generate', data=json.dumps(body).encode('utf-8'),
                                             headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(request, timeout=900) as response:
                text = json.load(response)['text']
            return state(state='done', text=text, seconds=round(time.monotonic() - started))
        except Exception:
            continue  # the laptop went away mid-draft: the phone writes it instead
    state(state='waiting', where='phone')
    try:
        child = subprocess.Popen([sys.executable, STORY], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, start_new_session=True)
    except OSError as error:
        return state(state='failed', error=str(error))
    with GENERATIONS_LOCK:
        GENERATIONS[job]['_child'] = child
    child.stdin.write(json.dumps(body))
    child.stdin.close()
    waits = {'since': time.monotonic(), 'for': None}

    def watch():
        """Gives up a wait that lasts too long, with its reason, rather than wait for ever."""
        while child.poll() is None:
            reason = waits['for']
            limit = STORY_WAIT_MODEL if reason == 'model' else story_wait()
            if reason and time.monotonic() - waits['since'] > limit:
                waits['gave up'] = reason
                child.kill()
                return
            time.sleep(0.2)

    threading.Thread(target=watch, daemon=True).start()
    for line in child.stderr:
        line = line.strip()
        if line == 'writing':
            waits['for'] = None
            state(state='writing', waitingFor=None)
        elif line in WAITING:
            waits.update({'since': time.monotonic(), 'for': WAITING[line]})
            state(state='waiting', waitingFor=WAITING[line])
    text = child.stdout.read().strip()
    code = child.wait()
    with GENERATIONS_LOCK:
        if GENERATIONS[job].get('state') == 'cancelled':
            return None
    if 'gave up' in waits:
        return state(state='failed', error=GAVE_UP[waits['gave up']])
    if code != 0 or not text:
        return state(state='failed', error='The phone could not write the story.')
    return state(state='done', text=text, seconds=round(time.monotonic() - started))


def cancel_generation(job):
    """The reader stopped or left: a draft nobody will read is not written."""
    with GENERATIONS_LOCK:
        found = GENERATIONS.get(job)
        if not found:
            return False
        found['state'] = 'cancelled'
        child = found.get('_child')
    if child and child.poll() is None:
        child.kill()
    return True


def start_generation(body, root):
    job = uuid.uuid4().hex[:12]
    with GENERATIONS_LOCK:
        # An hour is longer than any story takes; older answers are of no use to anyone.
        for old in [k for k, v in GENERATIONS.items() if time.time() - v['created'] > 3600]:
            del GENERATIONS[old]
        GENERATIONS[job] = {'state': 'waiting', 'where': 'phone', 'created': time.time()}
    threading.Thread(target=generate, args=(job, body, root), daemon=True).start()
    return job


# Spoken stories (spec 018): speak.py makes a download of the story, which Reader then imports.
SPEAK = os.environ.get('READER_SPEAK', os.path.expanduser('~/bin/speak.py'))


def start_speaking(body, root):
    """A job folder beside the downloads, so the story shows under New from Termux as it is made."""
    job = time.strftime('%Y%m%d-%H%M%S') + '-story'
    folder = os.path.join(root, 'downloads', job)
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, 'progress.json'), 'w', encoding='utf-8') as file:
        json.dump({'stage': 'speaking', 'title': body['title'], 'percent': 0}, file, ensure_ascii=False)
    child = subprocess.Popen([sys.executable, SPEAK, folder], stdin=subprocess.PIPE,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True,
                             start_new_session=True)
    child.stdin.write(json.dumps(body, ensure_ascii=False))
    child.stdin.close()
    return job


def start_download(url):
    """As a share to Termux does: the opener downloads, packs, and the job shows in /downloads."""
    subprocess.Popen(['bash', OPENER, url], start_new_session=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


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


EARNED = ('documents', 'events', 'states', 'sessions', 'encounters', 'corrections')


def holds_something(data):
    """A fresh or wiped library's copy has nothing earned; offered for restore, it would stand in
    front of the copy worth having (issue #22)."""
    copy = json.loads(data)
    return any(copy.get(name) for name in EARNED)


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


def progress_of(folder):
    """A download still without its bundle: its progress file, and how many seconds since it changed."""
    path = os.path.join(folder, 'progress.json')
    if os.path.exists(os.path.join(folder, 'bundle.tar')):
        return None
    try:
        age = time.time() - os.path.getmtime(path)
        with open(path, encoding='utf-8') as file:
            return json.load(file), age
    except (OSError, ValueError):
        return None


def working(root):
    """Whether a download or a translation is running: the jobs that need the CPU with the screen off."""
    downloads = os.path.join(root, 'downloads')
    for job in sorted(os.listdir(downloads) if os.path.isdir(downloads) else [], reverse=True)[:30]:
        folder = os.path.join(downloads, job)
        if translating(folder):
            return True
        # The same ten minutes as jobs(): an untouched progress file is a download that died.
        progress = progress_of(folder)
        if progress and progress[0].get('stage') != 'failed' and progress[1] <= 600:
            return True
    return False


class WakeLock:
    """Termux's wake lock, held only while a job runs (issue #27). Held all the time, it kept the phone
    from sleeping all night, and its Wi-Fi lock kept Wi-Fi out of power saving; an idle service
    needs neither, since Reader only calls it with the screen on. Released after a minute without a
    job, which bridges the gaps between a job's steps (packing, then translate.py starting)."""

    def __init__(self, run, grace=60):
        self.run = run
        self.grace = grace
        # Unknown at start: an older version took the lock and never released it.
        self.held = None
        self.idle_since = None

    def update(self, busy, now):
        if busy:
            self.idle_since = None
            if self.held is not True:
                self.run('termux-wake-lock')
                self.held = True
            return
        if self.idle_since is None:
            self.idle_since = now
        if self.held is not False and now - self.idle_since >= self.grace:
            self.run('termux-wake-unlock')
            self.held = False


def keep_awake_while_working(root, interval=15):
    def run(command):
        if shutil.which(command):
            subprocess.run([command], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    lock = WakeLock(run)
    while True:
        lock.update(working(root), time.monotonic())
        time.sleep(interval)


class Handler(http.server.SimpleHTTPRequestHandler):
    root = ''

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE')
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
            if not os.path.isfile(bundle):
                # Still downloading, so Reader can show it from the moment of the share. A progress
                # file nobody has touched for ten minutes is a download that died, not one to wait for.
                # A failed one stays until Reader dismisses it, so the reader learns what happened.
                progress = progress_of(folder)
                if not progress:
                    continue
                state, age = progress
                if state.get('stage') != 'failed' and age > 600:
                    continue
                # A download that failed before its title arrived is known by the address shared.
                title = state.get('title') or state.get('url') or 'A new video'
                found.append({'job': job, 'title': title, 'id': None,
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

    def put_choice(self, job):
        """The tracks Reader imported (spec 012, contracts/bundle-and-service.md): stored, then the
        chosen Chinese track is translated when the reader asked for machine English."""
        folder = os.path.join(self.root, 'downloads', job)
        if not job or '/' in job or job.startswith('.') or not os.path.isdir(folder):
            return self.reply(404, {'error': 'no such job'})
        raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        try:
            choice = json.loads(raw)
            with open(os.path.join(folder, 'tracks.json'), encoding='utf-8') as file:
                files = {track.get('file') for track in json.load(file)}
        except (OSError, ValueError):
            return self.reply(400, {'error': 'not a choice for a job with tracks'})
        if (not isinstance(choice, dict) or set(choice) != {'chinese', 'english'}
                or choice['chinese'] not in files | {'transcribe'}
                or choice['english'] not in files | {'machine', 'none'}):
            return self.reply(400, {'error': 'not a choice among this job\'s tracks'})
        target = os.path.join(folder, 'choice.json')
        with open(target + '.part', 'w', encoding='utf-8') as file:
            json.dump(choice, file)
        os.replace(target + '.part', target)
        # Machine English only when asked for: beside a human English track the reader trusts its
        # maker, untranslated lines included.
        if choice['chinese'] != 'transcribe' and choice['english'] == 'machine' and not translating(folder):
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
        if path.startswith('/downloads/') and path.endswith('/choice.json'):
            return self.put_choice(path[len('/downloads/'):-len('/choice.json')])
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

    def do_DELETE(self):
        path = self.path.split('?')[0]
        if path.startswith('/generate/') and cancel_generation(path[len('/generate/'):]):
            return self.reply(200, {})
        return self.reply(404, {'error': 'no such story'})

    def do_POST(self):
        if self.path.split('?')[0] == '/speak':
            try:
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
                assert isinstance(body.get('title'), str) and body['title']
                assert isinstance(body.get('lines'), list) and any(isinstance(l, str) and l.strip() for l in body['lines'])
            except (ValueError, AssertionError, AttributeError):
                return self.reply(400, {'error': 'expected {"title": "...", "lines": ["...", ...]}'})
            return self.reply(202, {'job': start_speaking(body, self.root)})
        if self.path.split('?')[0] == '/generate':
            try:
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
                assert isinstance(body.get('messages'), list) and body['messages']
            except (ValueError, AssertionError, AttributeError):
                return self.reply(400, {'error': 'expected {"messages": [...]}'})
            return self.reply(202, {'job': start_generation(body, self.root)})
        if self.path.split('?')[0] != '/download':
            return self.reply(404)
        try:
            url = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0)))).get('url', '')
        except (ValueError, AttributeError):
            return self.reply(400, {'error': 'not JSON'})
        if not isinstance(url, str) or not url.startswith(('https://www.youtube.com/watch?v=', 'https://youtu.be/')):
            return self.reply(400, {'error': 'not a YouTube video address'})
        start_download(url)
        return self.reply(202, {})

    def do_GET(self):
        path = self.path.split('?')[0]
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        if path == '/search':
            words = (query.get('q') or [''])[0].strip()
            if not words:
                return self.reply(400, {'error': 'no query'})
            count = min(20, max(1, int((query.get('n') or ['15'])[0])))
            return self.reply(*search(words, count))
        if path.startswith('/generate/'):
            with GENERATIONS_LOCK:
                found = dict(GENERATIONS.get(path[len('/generate/'):], {}))
            if not found:
                return self.reply(404, {'error': 'no such story'})
            return self.reply(200, {k: v for k, v in found.items() if k != 'created' and not k.startswith('_')})
        if path == '/subtitles':
            video = (query.get('id') or [''])[0]
            if not video or not all(c.isalnum() or c in '-_' for c in video):
                return self.reply(400, {'error': 'not a video id'})
            return self.reply(*subtitles(video))
        if path == '/health':
            return self.reply(200, {'version': VERSION, 'started': STARTED})
        if path in ('/backup', '/backup/latest'):
            names = sorted((n for n in os.listdir(self.backups()) if n.endswith('.json')), reverse=True)
            if path == '/backup':
                return self.reply(200, [summary(os.path.join(self.backups(), n)) for n in names])
            data = None
            for name in names:
                with open(os.path.join(self.backups(), name), 'rb') as file:
                    data = file.read()
                if holds_something(data):
                    break
                data = None
            if data is None:
                return self.reply(404, {'error': 'no copy yet'})
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
    threading.Thread(target=keep_awake_while_working, args=(args.root,), daemon=True).start()
    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', args.port), lambda *a: Handler(*a, directory=args.root)
    )
    server.serve_forever()


if __name__ == '__main__':
    main()
