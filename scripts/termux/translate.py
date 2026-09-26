#!/usr/bin/env python3
"""Translate a video's Chinese subtitles into English, line by line, as they become available.

    translate.py <job directory>

Reads the job's Chinese track (a downloaded media.<lang>.vtt, or the media.zh.vtt that transcribe.py
is still writing) and writes media.en.vtt with the same timings, plus translate.json as
{"through": lines, "total": lines, "done": bool}. The reader service serves both from ~/downloads.

Qwen3-1.7B (Q4_K_M) through llama-completion, 20 lines per prompt, behind the quick English Reader
makes itself (ADR-0023): about 3x slower than playback on the phone, which is fine for a background
upgrade. The model echoes each line's Chinese before its English, and each answer is placed on the
line it echoes (`place`), so a merged line costs that line, not every line after it.
Smaller chunks were measured worse, not better: at 5 lines a sentence split across lines shifted.
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
LLAMA = os.environ.get('LLAMA', 'llama-completion')
MODEL = os.environ.get('TRANSLATE_MODEL', os.path.expanduser('~/.whisper/qwen3-1.7b-q4.gguf'))
# What a chunk needs free before it starts: the 1.1 GB model, which must stay resident while it runs,
# 0.55 GB of context and compute buffers, and a margin. Android counts the model's own file pages as
# available, which is why the margin is not smaller: the phone froze twice when this ran out.
NEEDED_KB = 2_000_000
STUB = os.environ.get('TRANSLATE_STUB') == '1'
THREADS = str(min(4, os.cpu_count() or 4))
SYSTEM = ('You translate Chinese subtitles into natural English for a learner. For each numbered line, '
          'write the number, the Chinese line copied exactly, " => ", and its English translation, one line '
          'per number, nothing else. Translate each line on its own; use the surrounding lines only for '
          'context.')
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


def available_kb():
    """MemAvailable, or None where /proc/meminfo cannot be read (then there is nothing to wait for)."""
    try:
        with open('/proc/meminfo') as meminfo:
            for line in meminfo:
                if line.startswith('MemAvailable:'):
                    return int(line.split()[1])
    except OSError:
        pass
    return None


def wait_for_memory():
    """Waits while the phone is short of memory, e.g. while Reader is still translating quickly."""
    said = False
    while (free := available_kb()) is not None and free < NEEDED_KB:
        if not said:
            print(f'waiting for memory: {free // 1000} MB free, {NEEDED_KB // 1000} MB needed', flush=True)
            said = True
        time.sleep(10)


def ask(lines):
    """English for each line, or None where the model's answer cannot be placed on it."""
    if STUB:
        return [f'EN: {line}' for line in lines]
    wait_for_memory()
    numbered = '\n'.join(f'{i + 1}. {line}' for i, line in enumerate(lines))
    # The answer is started for the model: a 1.7B model ignores the echo format when only asked for
    # it, and follows it once the first line shows it.
    start = f'1. {lines[0]} =>'
    prompt = (f'<|im_start|>system\n{SYSTEM}<|im_end|>\n<|im_start|>user\n{numbered} /no_think'
              f'<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n{start}')
    # --no-repack: repacking keeps a second, rearranged copy of Q4 weights, 2.0 GB peak against 1.4 GB
    # without it, measured on laptop and phone; the phone was no slower without it.
    # -c: without it llama.cpp reserves the model's whole 40k-token context, measured at 6.4 GB peak
    # against 2.0 GB with 1024. That froze a 5.6 GB phone twice. 20 echoed lines need ~1000.
    out = subprocess.run(
        [LLAMA, '-m', MODEL, '-c', '2048', '--no-repack', '-p', prompt, '-n', str(60 * len(lines) + 40),
         '--temp', '0.2', '-t', THREADS, '-no-cnv', '--no-display-prompt'],
        capture_output=True, text=True, check=True,
    ).stdout.replace('[end of text]', '')  # llama-completion's own end marker, not the model's
    answers = []
    for line in (start + out).splitlines():
        match = re.match(r'\s*(\d+)\.\s*(.*?)\s*=>\s*(.*\S)', line)
        if match:
            answers.append((int(match.group(1)), match.group(2), match.group(3)))
    return place(lines, answers)


def bare(chinese):
    """A line's Chinese without the spacing and punctuation a model may drop when echoing it."""
    return re.sub(r'[\s，。？！、,.?!~～…]', '', chinese)


def place(lines, answers):
    """Each answer on the line whose Chinese it echoes (ADR-0023).

    Not on its number: a model that merges two lines keeps counting, so every line after the merge
    gets its neighbour's English under a count that still matches. That was measured, and the count
    was the only check. An echo that matches no line (a merge, a paraphrase) places nothing, and
    Reader keeps showing that line's quick English. The number only breaks a tie between two lines
    with the same Chinese.
    """
    placed = [None] * len(lines)
    for number, echo, english in answers:
        candidates = [i for i, line in enumerate(lines) if bare(line) == bare(echo) and placed[i] is None]
        if number - 1 in candidates:
            placed[number - 1] = english
        elif len(candidates) == 1:
            placed[candidates[0]] = english
    return placed


def translate(lines):
    """English per Chinese line; empty where it could not be placed, so the quick line stays."""
    return [answer or '' for answer in ask(lines)]


def source(job):
    """The Chinese track, and whether it can still grow (a transcript still being written)."""
    status = os.path.join(job, 'status.json')
    if os.path.exists(status):
        with open(status, encoding='utf-8') as file:
            growing = not json.load(file).get('done', False)
        return os.path.join(job, 'media.zh.vtt'), growing
    # termux-url-opener writes transcribing.json before starting this and transcribe.py together,
    # and this one looked first: no status yet, no subtitles, so it finished with nothing, on every
    # transcribed video until 2026-09-26. The marker means a transcript is on its way.
    if os.path.exists(os.path.join(job, 'transcribing.json')):
        return os.path.join(job, 'media.zh.vtt'), True
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
        # Not while a transcript is still being written: the two shared the phone's four cores, and the
        # transcript, which the reader is waiting for, took 6:50 against 4:20 without this beside it.
        # Reader's quick English covers those lines meanwhile (ADR-0023).
        if pending and not growing:
            chunk = pending[:CHUNK]
            done.extend(zip((timing for timing, _ in chunk), translate([text for _, text in chunk])))
            write(os.path.join(job, 'media.en.vtt'),
                  # No cue for a line that could not be placed: Reader matches English to Chinese by
                  # timing, and the line keeps its quick English.
                  'WEBVTT\n\n' + ''.join(f'{timing}\n{text}\n\n' for timing, text in done if text))
        finished = not growing and len(done) == len(available)
        write(os.path.join(job, 'translate.json'),
              json.dumps({'through': len(done), 'total': len(available), 'done': finished}))
        if finished:
            print(f'translated {len(done)} lines', flush=True)
            return
        if not pending or growing:
            time.sleep(2)


if __name__ == '__main__':
    main(sys.argv[1])
