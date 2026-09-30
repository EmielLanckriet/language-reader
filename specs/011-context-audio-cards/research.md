# Research
- Reader already retains raw text, token offsets, read/played ranges, lookups and withdrawals. Mere
  library occurrence is not evidence of encounter. Reuse those facts rather than synthesize visits.
- Media raw text is one cue per line. Display the full cue for matching source audio; no trustworthy
  sub-cue word timing exists. Play original/sound-only file without extracting/decoding whole media.
- Local Anki User 2 has 2,128 studied HSK notes with examples, 4,037 existing referenced audio files,
  about 170 MB. Prior Reader import retained only word/scheduling information.
- Installed legacy add-on used Cloud TTS; current SideProjects/Anki/sentencegen/tts.py uses Kokoro
  v1.1-zh with matching vocab/Misaki and content-addressed clips. Reuse existing clips now; do not
  transfer its 374 MB model or Python runtime to the phone.
- Device speech voices load asynchronously. Select a local Mandarin voice, never silently use a
  remote/default foreign-language voice. See [available voices](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices)
  and [localService](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService).
- USTAR restricts import to a small standard format without adding a ZIP dependency or decoding a
  170 MB JSON/base64 value. Validate per-file content hashes before appending example facts.
