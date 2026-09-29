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

import difflib
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
# Touched by the reader service while Reader transcribes (PUT /busy); Reader repeats it every 20 s.
BUSY = os.environ.get('READER_BUSY', os.path.expanduser('~/.reader/busy'))
BUSY_SECONDS = 90  # Chrome runs a hidden page's timers about once a minute
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


def wait_for_reader():
    """Waits while Reader transcribes: measured on the phone, the two together took a 30 s window
    from 22 s to 55 s, and the transcript is what the reader is waiting for."""
    said = False
    while True:
        try:
            if time.time() - os.path.getmtime(BUSY) > BUSY_SECONDS:
                return
        except OSError:
            return
        if not said:
            print('waiting while Reader transcribes', flush=True)
            said = True
        time.sleep(5)


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


PUNCTUATE = ('Add Chinese punctuation (，。？！) to the text so that it reads as proper sentences. Do not '
             'change, add or remove any other character. Reply with the punctuated text only.')
MARKS = '，。？！；：,.?!;:'
# A group with no punctuation at any of its line ends is still cut after this many characters.
GROUP_MAX = 40


def ends_from(lines, punctuated):
    """After which lines a clause ends: the line ends the model put a mark after.

    Aligned by character rather than compared whole: the model sometimes changes a character (it
    added 是 to 不得不提的一个词AI), and that must cost the one boundary, not the chunk.
    """
    text = ''.join(lines)
    kept, marked = [], set()
    for ch in punctuated:
        if ch in MARKS:
            if kept:
                marked.add(len(kept) - 1)
        elif not ch.isspace():
            kept.append(ch)
    after = set()
    for block in difflib.SequenceMatcher(None, text, ''.join(kept), autojunk=False).get_matching_blocks():
        for k in range(block.size):
            if block.b + k in marked:
                after.add(block.a + k)
    ends, at = set(), 0
    for i, line in enumerate(lines):
        at += len(line)
        if at - 1 in after:
            ends.add(i)
    return ends


def groups(lines, ends):
    """Consecutive lines as clauses: [first, last] index pairs covering every line once."""
    found, first, length = [], 0, 0
    for i, line in enumerate(lines):
        length += len(line)
        if i in ends or length >= GROUP_MAX or i == len(lines) - 1:
            found.append([first, i])
            first, length = i + 1, 0
    return found


def sentence_ends(lines):
    """Where the model punctuates the lines run together: subtitles cut a sentence wherever a line
    ran out of room, and a learner needs the whole sentence, and its English, together."""
    if STUB:
        return set(range(len(lines)))
    wait_for_memory()
    text = ''.join(lines)
    prompt = (f'<|im_start|>system\n{PUNCTUATE}<|im_end|>\n<|im_start|>user\n{text} /no_think'
              f'<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n')
    out = subprocess.run(
        [LLAMA, '-m', MODEL, '-c', '2048', '--no-repack', '-p', prompt, '-n', str(2 * len(text) + 40),
         '--temp', '0.2', '-t', THREADS, '-no-cnv', '--no-display-prompt'],
        capture_output=True, text=True, check=True,
    ).stdout.replace('[end of text]', '')
    return ends_from(lines, out)


def source(job):
    """The Chinese track, and whether it can still grow (a transcript still being written)."""
    status = os.path.join(job, 'status.json')
    if os.path.exists(status):
        with open(status, encoding='utf-8') as file:
            growing = not json.load(file).get('done', False)
        return os.path.join(job, 'media.zh.vtt'), growing
    # An older Termux wrote transcribing.json before its transcriber had written a status. Reader now
    # writes the transcript (spec 008) and the service removes this marker when it arrives, so a
    # present marker still means a transcript is on its way.
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


def span(first, last):
    """One cue's timing across lines: the first line's start to the last one's end."""
    return first.split('-->')[0].strip() + ' --> ' + last.split('-->')[1].strip()


def main(job):
    # One entry per clause: (timing across its lines, English, how many lines).
    done = []
    while True:
        track, growing = source(job)
        available = cues(track) if track and os.path.exists(track) else []
        through = sum(n for _, _, n in done)
        pending = available[through:]
        # Not while a transcript is still being written: the two shared the phone's four cores, and the
        # transcript, which the reader is waiting for, took 6:50 against 4:20 without this beside it.
        # Reader's quick English covers those lines meanwhile (ADR-0023).
        if pending and not growing:
            wait_for_reader()
            chunk = pending[:CHUNK]
            texts = [text for _, text in chunk]
            ends = sentence_ends(texts)
            found = groups(texts, ends)
            # The last clause may go on past the chunk: it is left to the next chunk, unless the chunk
            # is the end of the track, the model closed it, or it is the only clause.
            more = len(pending) > len(chunk)
            if more and len(found) > 1 and found[-1][1] not in ends:
                found = found[:-1]
            english = translate([''.join(texts[a:b + 1]) for a, b in found])
            done.extend((span(chunk[a][0], chunk[b][0]), text, b - a + 1)
                        for (a, b), text in zip(found, english))
            write(os.path.join(job, 'media.en.vtt'),
                  # One cue per clause, across its lines: Reader shows the lines one cue covers as one.
                  # No cue for a clause that could not be placed: Reader matches English to Chinese by
                  # timing, and those lines keep their quick English.
                  'WEBVTT\n\n' + ''.join(f'{timing}\n{text}\n\n' for timing, text, _ in done if text))
            through = sum(n for _, _, n in done)
        finished = not growing and through == len(available)
        write(os.path.join(job, 'translate.json'),
              json.dumps({'through': through, 'total': len(available), 'done': finished}))
        if finished:
            print(f'translated {through} lines in {len(done)} clauses', flush=True)
            return
        if not pending or growing:
            time.sleep(2)


def locked(job):
    """Take the job's lock, so the reader service never starts a second translation of it."""
    lock = os.path.join(job, 'translate.lock')
    try:
        with open(lock, encoding='utf-8') as file:
            os.kill(int(file.read().strip()), 0)
        return False  # a live translate.py has it
    except (OSError, ValueError):
        pass
    with open(lock, 'w', encoding='utf-8') as file:
        file.write(str(os.getpid()))
    return True


if __name__ == '__main__':
    if locked(sys.argv[1]):
        try:
            main(sys.argv[1])
        finally:
            os.remove(os.path.join(sys.argv[1], 'translate.lock'))
