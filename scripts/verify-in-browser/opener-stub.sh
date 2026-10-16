#!/bin/sh
# termux-url-opener's stand-in for Find videos' scenario (spec 015): leaves a job that has just
# started, as a real download shows in /downloads from the moment of the share. Needs READER_ROOT.
job="$READER_ROOT/downloads/$(date +%Y%m%d-%H%M%S)-find"
mkdir -p "$job"
printf '{"stage": "starting", "url": "%s"}' "$1" >"$job/progress.json"
