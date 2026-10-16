# Quickstart: validating Find videos

## 1. Laptop, automated

```sh
npx vitest run tests/content/find.test.ts            # unsaved text scores as the saved document
python3 -m unittest scripts/termux/test_service.py   # endpoints, yt-dlp stubbed
```

The scoring test must fail when `wordsByForm` misses a word or `dueWords` diverges from
`wordCounts` (mutation-check both).

## 2. Laptop, browser

`READER_YTDLP=<stub>` makes the service run a stub that answers search and subtitles from files, so
no request reaches YouTube. With a verification build and the stubbed service on port 18765:

```sh
npm run verify:browser -- findvideos
```

Passes when: results stream in (the first before the last); figures appear for the Chinese ones
and "No Chinese subtitles" for the other; changing the bar re-sorts without a new search; Download
makes a job appear in `/downloads`; and the profile's history holds no new encounter, mark, session
or document.

## 3. Phone

Deploy, update Termux's service script, then in the daily Reader search one query (a read-only
action; Download is not pressed there). Record time to first result and to the last, and the
figures of a result that is also a library document against the library's.
