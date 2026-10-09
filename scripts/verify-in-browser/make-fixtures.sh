#!/usr/bin/env bash
# Lay out two Termux jobs, as termux-url-opener leaves them, for the media, live and translate
# scenarios, from any downloaded video, in seconds:
#
#   scripts/verify-in-browser/make-fixtures.sh <video.mp4> <subtitles.vtt> <serve-root>
#
#   <serve-root>/downloads/fixture-media/  bundle.tar (45 s clip + subtitles), meta.json, the .vtt
#   <serve-root>/downloads/fixture-tracks-*/  spec 012 bundles with track.<lang>.vtt and tracks.json
#   <serve-root>/downloads/fixture-video-*/   one video downloaded twice, for new subtitles (issue #9)
#   <serve-root>/downloads/fixture-failed/ a download that fetched nothing (issue #28)
#   <serve-root>/downloads/fixture-live/   bundle.tar (clip, no subtitles, and the transcribing.json
#                                          an older Termux wrote: Reader transcribes it anyway)
#
# Serve them with `python3 scripts/termux/reader-service.py --root <serve-root>`. The clip is 45 s:
# three transcription windows in Reader (10 s, then 30 s every 28 s), so both joins are exercised,
# and each scenario takes seconds. The video needs AAC audio, which Reader decodes itself.
set -euo pipefail
video=$1
subtitles=$2
root=$3
downloads="$root/downloads"
job() { rm -rf "$downloads/$1" && mkdir -p "$downloads/$1" && echo "$downloads/$1"; }

media=$(job fixture-media)
ffmpeg -loglevel error -y -i "$video" -t 45 -c copy "$media/media.mp4"
cp "$subtitles" "$media/media.zh-CN.vtt"
echo '{"title":"Test clip, 45 s","job":"fixture-media"}' >"$media/meta.json"
tar cf "$media/bundle.tar" -C "$media" media.mp4 media.zh-CN.vtt meta.json

live=$(job fixture-live)
cp "$media/media.mp4" "$live/"
echo '{"title":"Test clip without subtitles","job":"fixture-live"}' >"$live/meta.json"
printf '{"status":"http://127.0.0.1:8765/downloads/fixture-live/status.json","vtt":"http://127.0.0.1:8765/downloads/fixture-live/media.zh.vtt"}' \
	>"$live/transcribing.json"
tar cf "$live/bundle.tar" -C "$live" media.mp4 meta.json transcribing.json

# Spec 012 bundles, as the two-pass download leaves them: track.<lang>.vtt plus tracks.json.
# clean-mixed is Jun's shape (a clean track and the same lines with a romanised line under each):
# it imports without asking. english adds a human English track whose cues start 0.2 s late and
# merge the second and third lines into one cue, so one Chinese line is left for machine English.
python3 - "$subtitles" "$downloads" "$media/media.mp4" <<'EOF'
import json, os, re, shutil, subprocess, sys
source, downloads, clip = sys.argv[1:]
blocks = [b for b in open(source, encoding='utf-8').read().replace('\r', '').split('\n\n') if '-->' in b]

def times(block):
    return next(line for line in block.split('\n') if '-->' in line)

def text(block):
    return ' '.join(block.split('\n')[block.split('\n').index(times(block)) + 1:]).strip()

def shift(stamp, seconds):
    h, m, s = stamp.split(':')
    total = int(h) * 3600 + int(m) * 60 + float(s) + seconds
    return f'{int(total // 3600):02d}:{int(total % 3600 // 60):02d}:{total % 60:06.3f}'

def write(job, tracks, title, video=None):
    folder = os.path.join(downloads, job)
    shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(folder)
    shutil.copy(clip, os.path.join(folder, 'media.mp4'))
    for track in tracks:
        with open(os.path.join(folder, track['file']), 'w', encoding='utf-8') as file:
            file.write(track.pop('vtt'))
    json.dump(tracks, open(os.path.join(folder, 'tracks.json'), 'w'), ensure_ascii=False)
    meta = {'title': title, 'job': job, **({'id': video} if video else {})}
    json.dump(meta, open(os.path.join(folder, 'meta.json'), 'w'), ensure_ascii=False)
    names = ['media.mp4', 'meta.json', 'tracks.json'] + [t['file'] for t in tracks]
    subprocess.run(['tar', 'cf', os.path.join(folder, 'bundle.tar'), '-C', folder, *names], check=True)

clean = 'WEBVTT\n\n' + '\n\n'.join(f'{times(b)}\n{text(b)}' for b in blocks) + '\n'
mixed = 'WEBVTT\n\n' + '\n\n'.join(f'{times(b)}\n{text(b)}\nroman line {i}' for i, b in enumerate(blocks)) + '\n'
english, i = [], 0
while i < len(blocks):
    start, end = times(blocks[i]).split(' --> ')
    if i == 1 and len(blocks) > 2:
        end = times(blocks[2]).split(' --> ')[1]
        english.append(f'{shift(start, 0.2)} --> {shift(end, 0.2)}\nHuman English for lines 2 and 3')
        i += 2
        continue
    # Line 4 is long: the question previews it, and must still fit a phone (it once overflowed).
    long = ', said at length so that this line is far wider than any phone screen' if i == 3 else ''
    english.append(f'{shift(start, 0.2)} --> {shift(end, 0.2)}\nHuman English for line {i + 1}{long}')
    i += 1
human = 'WEBVTT\n\n' + '\n\n'.join(english) + '\n'
track = lambda file, lang, name, vtt: {'file': file, 'lang': lang, 'name': name, 'kind': 'human', 'vtt': vtt}
write('fixture-tracks-clean-mixed', [track('track.zh.vtt', 'zh', 'Chinese', clean),
      track('track.zh-Hans.vtt', 'zh-Hans', 'Chinese (Simplified)', mixed)], 'Test clip, clean and mixed tracks')
write('fixture-tracks-english', [track('track.zh.vtt', 'zh', 'Chinese', clean),
      track('track.en.vtt', 'en', 'English', human)], 'Test clip, human English')
# Issue #9: one video downloaded twice. The first time only its pinyin-style track came, as for a
# download before spec 012 kept every track; shared again, it brings the clean one too.
write('fixture-video-first', [track('track.zh-Hans.vtt', 'zh-Hans', 'Chinese (Simplified)', mixed)],
      'Test clip, one video', 'fixtureVideo1')
write('fixture-video-again', [track('track.zh.vtt', 'zh', 'Chinese', clean),
      track('track.zh-Hans.vtt', 'zh-Hans', 'Chinese (Simplified)', mixed)], 'Test clip, one video (again)', 'fixtureVideo1')
EOF

# Issue #28: a share whose yt-dlp fetched nothing, as termux-url-opener now leaves it.
failed=$(job fixture-failed)
echo '{"stage": "failed", "reason": "ERROR: [youtube] fixtureFailed: Video unavailable", "url": "https://www.youtube.com/watch?v=fixtureFailed"}' \
	>"$failed/progress.json"
echo 'ERROR: [youtube] fixtureFailed: Video unavailable' >"$failed/download.log"

echo "service:     python3 scripts/termux/reader-service.py --root $root"
echo "translator:  TRANSLATE_STUB=1 python3 scripts/termux/translate.py $media"
