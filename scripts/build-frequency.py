"""Usage: <python with wordfreq==3.1.1> scripts/build-frequency.py
Writes src/lib/domain/frequency-zh.txt: the 50,000 most frequent Chinese words, most frequent first,
one per line, after a header line naming the source. What new cards are chosen by (issue #5):
general frequency, not how often a word occurs in the reader's own library.

The source is wordfreq's Chinese list (simplified), which blends film and TV subtitles (SUBTLEX-CH,
OpenSubtitles) with other text. Its data is CC BY-SA 4.0, so this derived file is too; see
src/lib/domain/frequency-zh.LICENSE.md. Entries that are not all Chinese characters (wordfreq writes
digits as 0) are left out. Generated, never hand-edited."""
import re
import wordfreq

COUNT = 50_000
OUTPUT = 'src/lib/domain/frequency-zh.txt'
HAN = re.compile(r'^[㐀-鿿豈-﫿]+$')

words = [w for w in wordfreq.iter_wordlist('zh', wordlist='best') if HAN.match(w)][:COUNT]
header = f'# wordfreq 3.1.1, zh, best: top {len(words)} words, most frequent first. CC BY-SA 4.0.'
with open(OUTPUT, 'w', encoding='utf8') as out:
    out.write(header + '\n' + '\n'.join(words) + '\n')
print(f'{OUTPUT}: {len(words)} words')
