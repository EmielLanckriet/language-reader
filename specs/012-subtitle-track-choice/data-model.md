# Data model: Subtitle track choice

No database migration. Everything below is files: in a Termux job folder, in the bundle, and in a
document's OPFS folder `media/<documentId>/` (ADR-0018). All of it is derived or configuration;
the earned data (marks, encounters, corrections) keeps pointing at the document's fixed text.

## Track manifest — `tracks.json`
Written by termux-url-opener from the info JSON; travels in the bundle; copied into the document.

| Field | Meaning |
|---|---|
| `file` | `track.<lang>.vtt` or `track-auto.<lang>.vtt`, present beside the manifest |
| `lang` | YouTube language code (`zh`, `zh-Hans`, `en`, `en-GB`, …) |
| `name` | YouTube's track name ("Chinese (Simplified)"), may be empty |
| `kind` | `human` or `automatic` |

Validation: every `file` exists and is WebVTT; unknown fields ignored; a missing manifest means a
pre-012 bundle (FR-009).

## Track classification (computed, never stored)
For each track: `chinese` (most cues have a Chinese line), `english` (`lang` starts with `en` and
most cues have no Chinese line), `mixed` (R2), and a fingerprint of its cue texts to drop duplicate
Chinese tracks. Default Chinese = clean before mixed, human before automatic, simplified before
traditional. Default English = the first human English track, else machine translation.
A choice is asked when there are 2+ distinct clean Chinese tracks or 1+ human English track.

## Track choice — `choice.json`
Reader → Termux (`PUT /downloads/<job>/choice.json`) after an asked choice:
`{ "chinese": "<file>" | "transcribe", "english": "<file>" | "machine" | "none" }`.
Termux translates only when `english` is not `none`; with a file, only uncovered lines.

## Document English setting — `english.json` (document folder)
`{ "source": "track", "file": "<file>" } | { "source": "machine" } | { "source": "none" }`.
Absent means `machine` (every pre-012 document). Changing it (US4) rewrites only this file.

## Per-line English (computed)
`English = { text, source: 'human' | 'llm' | 'quick' }` per Chinese line. Human from the chosen
English track via R3; LLM from `media.en.vtt` by start time; quick from `quick-english.json`.
With `source: none`, no English is shown and no translation is requested.

## State: a Termux job
`downloaded` → (no choice needed) `translating` → `translated`
`downloaded` → (choice needed) `awaiting choice` → `PUT choice.json` → `translating` (uncovered
lines only, or none) → `translated`. A dismissed or never-opened job stays `awaiting choice`.
