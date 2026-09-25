#!/usr/bin/env bash
# Lay out two Termux jobs, as termux-url-opener leaves them, for the media, live and translate
# scenarios, from any downloaded video, in seconds:
#
#   scripts/verify-in-browser/make-fixtures.sh <video.mp4> <subtitles.vtt> <serve-root>
#
#   <serve-root>/downloads/fixture-media/  bundle.tar (45 s clip + subtitles), meta.json, the .vtt
#   <serve-root>/downloads/fixture-live/   bundle.tar (clip, no subtitles, transcribing.json)
#
# Serve them with `python3 scripts/termux/reader-service.py --root <serve-root>`. The clip is 45 s:
# two transcription chunks, so the boundary is exercised, and each scenario takes seconds.
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

echo "service:     python3 scripts/termux/reader-service.py --root $root"
echo "transcriber: python3 scripts/termux/transcribe.py $live $live/media.mp4"
echo "translator:  TRANSLATE_STUB=1 python3 scripts/termux/translate.py $media"
