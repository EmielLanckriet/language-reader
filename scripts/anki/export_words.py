#!/usr/bin/env python3
"""Export the reader's studied Anki words, with Anki's level for each, for Reader (spec 006).

    python3 scripts/anki/export_words.py [--profile "User 2"] [--out anki-words.json] [--push]

Reads a copy of the collection, never the original: Anki may hold it open, and this project writes
nothing to it (Principle III, ADR-0006). The copy is opened read-only, with its write-ahead log, so
it is the latest committed state. The file format is specs/006-anki-baseline/contracts/anki-words.md.
"""

import argparse
import datetime
import json
import struct
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile

ANKI = os.path.expanduser('~/.local/share/Anki2')
NOTE_TYPE = 'HSK'
FIELD = 'Simplified'


def level(card_type, stability):
    """Anki's level from FSRS stability in days (research R1); a card being (re)learnt is learning."""
    if card_type in (1, 3) or stability < 7:
        return 'anki-learning'
    if stability < 21:
        return 'anki-young'
    if stability < 365:
        return 'anki-mature'
    return 'anki-long-term'


def strongest(words):
    """One entry per word: the strongest card where a word is on two notes."""
    best = {}
    for word in words:
        if word['word'] not in best or word['stability'] > best[word['word']]['stability']:
            best[word['word']] = word
    return list(best.values())


def read(collection):
    """The studied words from a read-only copy of `collection`."""
    with tempfile.TemporaryDirectory() as folder:
        copy = os.path.join(folder, 'collection.anki2')
        shutil.copy2(collection, copy)
        if os.path.exists(collection + '-wal'):
            shutil.copy2(collection + '-wal', copy + '-wal')
        db = sqlite3.connect(f'file:{copy}?mode=ro', uri=True)
        # Anki's own collation for names; only comparisons use it, so case-folding is enough to read.
        db.create_collation('unicase', lambda a, b: (a.casefold() > b.casefold()) - (a.casefold() < b.casefold()))
        try:
            (note_type,) = db.execute('SELECT id FROM notetypes WHERE name = ?', (NOTE_TYPE,)).fetchone()
            (field,) = db.execute('SELECT ord FROM fields WHERE ntid = ? AND name = ?', (note_type, FIELD)).fetchone()
            presets = db.execute('SELECT name, config FROM deck_config').fetchall()
            rows = db.execute(
                '''SELECT n.flds, c.type, c.ivl, c.data, c.lapses, c.queue,
                          (SELECT MAX(r.id) FROM revlog r WHERE r.cid = c.id)
                     FROM cards c JOIN notes n ON n.id = c.nid
                    WHERE n.mid = ? AND c.type != 0''', (note_type,)).fetchall()
        finally:
            db.close()
    words = [word for word in (card_word(row[0], field, *row[1:]) for row in rows) if word]
    return strongest(words), parameters_in(presets, [word['decay'] for word in words])


def protobuf_fields(blob):
    """The top-level fields of a protobuf message: (number, wire type, value). Enough for deck configs."""
    fields, i = [], 0

    def varint():
        nonlocal i
        value = shift = 0
        while True:
            byte = blob[i]
            i += 1
            value |= (byte & 0x7F) << shift
            shift += 7
            if byte < 0x80:
                return value

    while i < len(blob):
        key = varint()
        number, wire = key >> 3, key & 7
        if wire == 0:
            value = varint()
        elif wire == 1:
            value, i = blob[i:i + 8], i + 8
        elif wire == 5:
            value, i = struct.unpack('<f', blob[i:i + 4])[0], i + 4
        elif wire == 2:
            length = varint()
            value, i = blob[i:i + length], i + length
        else:
            raise ValueError(f'protobuf wire type {wire}')
        fields.append((number, wire, value))
    return fields


# Anki's DeckConfig message: its FSRS-6 weights and its desired retention.
FSRS_6_WEIGHTS, DESIRED_RETENTION = 6, 37


def parameters_in(presets, decays):
    """The FSRS-6 parameters of the preset the cards were scheduled with (spec 007).

    Told apart by decay: every FSRS-6 card stores its preset's last weight, so the preset whose last
    weight most of the cards carry is theirs. None when no preset has FSRS-6 weights.
    """
    found = []
    for name, blob in presets:
        fields = protobuf_fields(blob)
        weights = [struct.unpack(f'<{len(v) // 4}f', v) for n, w, v in fields if n == FSRS_6_WEIGHTS and w == 2]
        retention = [v for n, w, v in fields if n == DESIRED_RETENTION and w == 5]
        if weights and len(weights[0]) == 21:
            found.append({'preset': name, 'weights': list(weights[0]), 'retention': retention[0] if retention else 0.9})
    if not found:
        return None
    cards = [round(d, 3) for d in decays if d is not None]
    return max(found, key=lambda p: sum(abs(round(p['weights'][20], 3) - d) < 0.001 for d in cards))


def card_word(fields, field, card_type, interval, data, lapses, queue, last_review_ms):
    """One studied card as the Reader reads it (format 2), or None when its word field is empty.

    Stability, difficulty and decay are the card's FSRS memory; `lastReview` is its newest review-log
    entry, whose id is the review's time in milliseconds.
    """
    word = fields.split('\x1f')[field].strip()
    if not word:
        return None
    memory = json.loads(data) if data else {}
    stability = float(memory.get('s', interval))
    return {
        'word': word, 'level': level(card_type, stability), 'stability': stability,
        'difficulty': memory.get('d'), 'decay': memory.get('decay'),
        'lastReview': stamp(last_review_ms / 1000) if last_review_ms else None,
        'type': card_type, 'lapses': lapses, 'suspended': queue == -1,
    }


def stamp(seconds):
    return datetime.datetime.fromtimestamp(seconds, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--profile', default='User 2')
    parser.add_argument('--out', default='anki-words.json')
    parser.add_argument('--push', action='store_true', help="copy the file to the phone's Downloads over adb")
    args = parser.parse_args()

    collection = os.path.join(ANKI, args.profile, 'collection.anki2')
    words, parameters = read(collection)
    words = sorted(words, key=lambda w: w['word'])
    modified = max(os.path.getmtime(p) for p in (collection, collection + '-wal') if os.path.exists(p))
    export = {'format': 2, 'profile': args.profile, 'collectionModified': stamp(modified),
              'exportedAt': stamp(datetime.datetime.now().timestamp()), 'parameters': parameters, 'words': words}
    with open(args.out, 'w', encoding='utf-8') as file:
        json.dump(export, file, ensure_ascii=False)

    counts = {name: sum(w['level'] == name for w in words)
              for name in ('anki-learning', 'anki-young', 'anki-mature', 'anki-long-term')}
    print(f"{args.profile}, last changed {export['collectionModified']}: "
          + ', '.join(f"{n} {name.removeprefix('anki-')}" for name, n in counts.items())
          + f' ({len(words)} words) -> {args.out}')
    if args.push:
        adb = shutil.which('adb') or os.path.expanduser('~/Android/Sdk/platform-tools/adb')
        # -d: the phone on USB, not an emulator that may also be running.
        subprocess.run([adb, '-d', 'push', args.out, '/sdcard/Download/anki-words.json'], check=True)
        print('On the phone: Reader → Storage and diagnostics → Anki words → pick anki-words.json')


if __name__ == '__main__':
    sys.exit(main())
