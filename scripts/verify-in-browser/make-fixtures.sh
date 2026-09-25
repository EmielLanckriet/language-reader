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
	cp "$subtitles" "$clip/media.zh-CN.vtt"
	tar cf "$build/test-bundle.tar" -C "$clip" media.mp4 media.zh-CN.vtt meta.json
	rm "$clip/media.zh-CN.vtt"
fi

mkdir -p "$root/fixture-live"
cp "$clip/media.mp4" "$clip/meta.json" "$root/fixture-live/"
rm -f "$root/fixture-live/status.json" "$root/fixture-live/media.zh.vtt"
printf '{"status":"http://127.0.0.1:8765/fixture-live/status.json","vtt":"http://127.0.0.1:8765/fixture-live/media.zh.vtt"}' \
	>"$root/fixture-live/transcribing.json"
tar cf "$build/test-live.tar" -C "$root/fixture-live" media.mp4 meta.json transcribing.json
ls -la "$build"/test-*.tar
echo "transcriber: python3 scripts/termux/transcribe.py $root/fixture-live $root/fixture-live/media.mp4"
