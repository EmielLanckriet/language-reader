#!/usr/bin/env bash
# Build the bundles the media and live scenarios fetch, from any downloaded video, in seconds.
#
#   scripts/verify-in-browser/make-fixtures.sh <video.mp4> [subtitles.vtt] [serve-root]
#
# Writes build/test-bundle.tar (video + subtitles) and build/test-live.tar (video only, with a
# transcribing.json pointing at 127.0.0.1:8765/fixture-live/). The clip is 45 s: two transcription
# chunks, so the boundary is exercised, and a run of `live` stays around a minute. For `live`, run
# the transcriber on <serve-root>/fixture-live as the scenario starts (see android-emulator/).
set -euo pipefail
video=$1
subtitles=${2:-}
root=${3:-${TMPDIR:-/tmp}/reader-fixtures}
build=$(cd "$(dirname "$0")/../.." && pwd)/build
clip=$(mktemp -d)
ffmpeg -loglevel error -y -i "$video" -t 45 -c copy "$clip/media.mp4"
echo '{"title":"Test clip, 45 s"}' >"$clip/meta.json"

if [ -n "$subtitles" ]; then
	# Names a Termux job, so the translate scenario can follow its English: run translate.py
	# (TRANSLATE_STUB=1) on <serve-root>/downloads/fixture-media.
	media=$(mktemp -d)
	cp "$clip/media.mp4" "$media/"
	cp "$subtitles" "$media/media.zh-CN.vtt"
	echo '{"title":"Test clip, 45 s","job":"fixture-media"}' >"$media/meta.json"
	tar cf "$build/test-bundle.tar" -C "$media" media.mp4 media.zh-CN.vtt meta.json
	mkdir -p "$root/downloads/fixture-media"
	cp "$subtitles" "$root/downloads/fixture-media/media.zh-CN.vtt"
	rm -f "$root/downloads/fixture-media/media.en.vtt" "$root/downloads/fixture-media/translate.json"
fi

mkdir -p "$root/downloads/fixture-live"
cp "$clip/media.mp4" "$clip/meta.json" "$root/downloads/fixture-live/"
rm -f "$root/downloads/fixture-live/status.json" "$root/downloads/fixture-live/media.zh.vtt"
printf '{"status":"http://127.0.0.1:8765/downloads/fixture-live/status.json","vtt":"http://127.0.0.1:8765/downloads/fixture-live/media.zh.vtt"}' \
	>"$root/downloads/fixture-live/transcribing.json"
tar cf "$build/test-live.tar" -C "$root/downloads/fixture-live" media.mp4 meta.json transcribing.json
ls -la "$build"/test-*.tar
echo "service:     python3 scripts/termux/reader-service.py --root $root"
echo "transcriber: python3 scripts/termux/transcribe.py $root/downloads/fixture-live $root/downloads/fixture-live/media.mp4"
