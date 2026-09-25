#!/usr/bin/env python3
"""Translate a video's Chinese subtitles into English, line by line, as they become available.

    translate.py <job directory>

Reads the job's Chinese track (a downloaded media.<lang>.vtt, or the media.zh.vtt that transcribe.py
is still writing) and writes media.en.vtt with the same timings, plus translate.json as
{"through": lines, "total": lines, "done": bool}. The reader service serves both from ~/downloads.

Qwen3-1.7B (Q8) through llama-completion, 20 lines per prompt: measured to keep every line aligned
where the Q4 build merged two, and to run ahead of playback on the emulator. A chunk that does not
come back with exactly one line per input is redone a line at a time.
TRANSLATE_STUB=1 replaces the model with "EN: <line>", for tests that check plumbing, not English.
"""

import glob
import json
import os
import re
import subprocess
import sys
import time

CHUNK = 20
# While a transcript is still being written, start sooner: its first English should not wait 90 s.
GROWING_CHUNK = 8
LLAMA = os.environ.get('LLAMA', 'llama-completion')
MODEL = os.environ.get('TRANSLATE_MODEL', os.path.expanduser('~/.whisper/qwen3-1.7b-q8.gguf'))
STUB = os.environ.get('TRANSLATE_STUB') == '1'
THREADS = str(min(4, os.cpu_count() or 4))
SYSTEM = ('You translate Chinese subtitles into natural English for a learner. Translate each numbered '
          'line on its own, keeping the numbering, one line per number, nothing else. Use the '
          'surrounding lines for context.')
TIMING = re.compile(r'(\d+:)?\d{1,2}:\d{2}[.,]\d{3}\s+-->\s+(\d+:)?\d{1,2}:\d{2}[.,]\d{3}')


def cues(path):
    """(timing, text) per cue: the same cues, in the same order, that the app parses."""
    found, previous = [], ''
    for block in open(path, encoding='utf-8').read().replace('\r', '').split('\n\n'):
        lines = block.split('\n')
        at = next((i for i, line in enumerate(lines) if TIMING.search(line)), None)
        if at is None:
            continue
        fresh = [re.sub(r'<[^>]*>', '', line).strip() for line in lines[at + 1:]]
        fresh = [line for line in fresh if line and line != previous]
        if fresh:
            previous = fresh[-1]
            found.append((TIMING.search(lines[at]).group(0), ' '.join(fresh)))
    return found


def ask(lines):
    if STUB:
        return [f'EN: {line}' for line in lines]
    numbered = '\n'.join(f'{i + 1}. {line}' for i, line in enumerate(lines))
    prompt = (f'<|im_start|>system\n{SYSTEM}<|im_end|>\n<|im_start|>user\n{numbered} /no_think'
              f'<|im_end|>\n<|im_start|>assistant\n')
    # -c: without it llama.cpp reserves the model's whole 40k-token context, measured at 6.4 GB peak
    # against 2.0 GB with 1024. That froze a 5.6 GB phone twice. A 20-line chunk needs ~1500.
    out = subprocess.run(
        [LLAMA, '-m', MODEL, '-c', '2048', '-p', prompt, '-n', str(40 * len(lines) + 40), '--temp', '0.2',
         '-t', THREADS, '-no-cnv', '--no-display-prompt'],
        capture_output=True, text=True, check=True,
    ).stdout.replace('[end of text]', '')  # llama-completion's own end marker, not the model's
    answers = {}
    for line in out.splitlines():
        match = re.match(r'\s*(\d+)\.\s*(.*\S)', line)
        if match:
            answers.setdefault(int(match.group(1)), match.group(2))
    return [answers.get(i + 1) for i in range(len(lines))]


def translate(lines):
    """One English line per Chinese line, or a line at a time when the chunk comes back misaligned."""
    answers = ask(lines)
    if len(lines) > 1 and any(answer is None for answer in answers):
        answers = [ask([line])[0] for line in lines]
    return [answer or '' for answer in answers]


def source(job):
    """The Chinese track, and whether it can still grow (a transcript still being written)."""
    status = os.path.join(job, 'status.json')
    if os.path.exists(status):
        with open(status, encoding='utf-8') as file:
            growing = not json.load(file).get('done', False)
        return os.path.join(job, 'media.zh.vtt'), growing
    tracks = [path for path in glob.glob(os.path.join(job, 'media.*.vtt')) if not path.endswith('.en.vtt')]
    return (min(tracks, key=preference) if tracks else None), False


def preference(path):
    """The app's order (src/lib/media/import.ts), so the English lines up with the track it shows."""
    name = os.path.basename(path)
    if re.search(r'zh-(CN|Hans|SG)\b', name, re.I):
        return (0, name)
    if re.search(r'\.zh\.', name, re.I):
        return (1, name)
    return (2, name)


def write(path, text):
    with open(path + '.part', 'w', encoding='utf-8') as file:
        file.write(text)
    os.replace(path + '.part', path)


def main(job):
    done = []
    while True:
        track, growing = source(job)
        available = cues(track) if track and os.path.exists(track) else []
        pending = available[len(done):]
        if pending and (len(pending) >= (GROWING_CHUNK if growing else CHUNK) or not growing):
            chunk = pending[:CHUNK]
            done.extend(zip((timing for timing, _ in chunk), translate([text for _, text in chunk])))
            write(os.path.join(job, 'media.en.vtt'),
                  'WEBVTT\n\n' + ''.join(f'{timing}\n{text}\n\n' for timing, text in done))
        finished = not growing and len(done) == len(available)
        write(os.path.join(job, 'translate.json'),
              json.dumps({'through': len(done), 'total': len(available), 'done': finished}))
        if finished:
            print(f'translated {len(done)} lines', flush=True)
            return
        if not pending or (growing and len(pending) < GROWING_CHUNK):
            time.sleep(2)


if __name__ == '__main__':
    main(sys.argv[1])
