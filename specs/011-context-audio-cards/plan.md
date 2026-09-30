# Plan: Context and audio cards

## Technical context
Existing TypeScript/Svelte/SQLite PWA. Read-only Python Anki exporter. No dependency or paid service.
Extend the open encounter log with imported `anki-example` facts; reuse backup unknown-kind support.
Keep media as files, as existing Reader media does. A restricted USTAR bundle streams file-by-file;
manifest first, SHA-256 audio names, strict size/path/checksum validation. No migration required.

## Constitution check
Anki is read from a temporary copy; original collection is never written. Source example text is
retained in earned encounters; source audio files are retained locally and recoverable from the
export bundle. Reviews retain example identity. Tests precede queue/review contract changes;
UI gets one end-to-end browser flow. Verify only isolated data, then installed version/read-only UI.
No heavy phone synthesis or media transcoding. Domain modules remain storage/framework independent.
All seams trace to spec anticipated changes; ADR-0035 records audio/source decisions.

## Implementation
US1: Repository queries qualified encountered token ranges and returns source metadata; full cue
line for subtitle documents, punctuation sentence for plain texts. Queue defers words with no
Reader/Anki example. Existing source spans remain review occurrence facts.
US2: Export studied HSK notes' sentence, translation, pinyin and audio into USTAR. Browser verifies
bundle and saves content-addressed audio in OPFS; transaction appends validated Anki metadata only
when files are ready. Identical note content is idempotent; originals remain append-only. Fallback
selection uses newest note snapshot, distinct from an encounter. New More importer reports progress.
US3: Small audio controller plays retained source interval via HTMLAudioElement, with end watchdog,
hidden/navigation cancellation and blob cleanup. Imported word TTS first, then local Mandarin device
voice. Controls appear after reveal. Reuse line-aligned translations; avoid translating Anki sentences.

## Research
See research.md; delegated read-only media/TTS inspection completed. No critical unknown blocks
implementation. User corrected no-context policy to preserve Anki examples; first TTS version uses
existing clips/device voices unless subsequently steered toward laptop generation.
