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
            rows = db.execute(
                '''SELECT n.flds, c.type, c.ivl, c.data, c.lapses, c.queue
                     FROM cards c JOIN notes n ON n.id = c.nid
                    WHERE n.mid = ? AND c.type != 0''', (note_type,)).fetchall()
        finally:
            db.close()
    words = []
    for fields, card_type, interval, data, lapses, queue in rows:
        word = fields.split('\x1f')[field].strip()
        if not word:
            continue
        memory = json.loads(data) if data else {}
        stability = float(memory.get('s', interval))
        words.append({
            'word': word, 'level': level(card_type, stability), 'stability': round(stability, 1),
            'type': card_type, 'lapses': lapses, 'suspended': queue == -1,
        })
    return strongest(words)


def stamp(seconds):
    return datetime.datetime.fromtimestamp(seconds, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--profile', default='User 2')
    parser.add_argument('--out', default='anki-words.json')
    parser.add_argument('--push', action='store_true', help="copy the file to the phone's Downloads over adb")
    args = parser.parse_args()

    collection = os.path.join(ANKI, args.profile, 'collection.anki2')
    words = sorted(read(collection), key=lambda w: w['word'])
    modified = max(os.path.getmtime(p) for p in (collection, collection + '-wal') if os.path.exists(p))
    export = {'format': 1, 'profile': args.profile, 'collectionModified': stamp(modified),
              'exportedAt': stamp(datetime.datetime.now().timestamp()), 'words': words}
    with open(args.out, 'w', encoding='utf-8') as file:
        json.dump(export, file, ensure_ascii=False)

    counts = {name: sum(w['level'] == name for w in words)
              for name in ('anki-learning', 'anki-young', 'anki-mature', 'anki-long-term')}
    print(f"{args.profile}, last changed {export['collectionModified']}: "
          + ', '.join(f"{n} {name.removeprefix('anki-')}" for name, n in counts.items())
          + f' ({len(words)} words) -> {args.out}')
    if args.push:
        adb = shutil.which('adb') or os.path.expanduser('~/Android/Sdk/platform-tools/adb')
        subprocess.run([adb, 'push', args.out, '/sdcard/Download/anki-words.json'], check=True)
        print('On the phone: Reader → Storage and diagnostics → Anki words → pick anki-words.json')


if __name__ == '__main__':
    sys.exit(main())
