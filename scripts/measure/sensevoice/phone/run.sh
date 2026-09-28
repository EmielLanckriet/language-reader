#!/bin/bash
# One fresh page per thread setting, waiting for each result: run.sh <results.jsonl> '{"threads":1}' '{"threads":2}' …
# Needs serve.py running and `adb reverse tcp:8799 tcp:8799`; the phone must be unlocked.
set -e
RESULTS=$1; shift; ADB=${ADB:-adb}; : > "$RESULTS"; n=0
for c in "$@"; do
	n=$((n + 1)); q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote('['+sys.argv[1]+']'))" "$c")
	$ADB -d shell am start -a android.intent.action.VIEW -d "'http://127.0.0.1:8799/threads.html?c=$q&n=$n${EXTRA:-}'" com.android.chrome >/dev/null
	until [ "$(wc -l < "$RESULTS")" -ge $n ]; do sleep 3; done
	tail -1 "$RESULTS"
done
