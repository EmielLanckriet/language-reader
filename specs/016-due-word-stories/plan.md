# Implementation Plan: Stories with your due words

**Branch**: `016-due-word-stories` (on main) | **Date**: 2026-10-16 | **Spec**: [spec.md](spec.md)

Light plan (ADR-0031): nothing earned is written until the reader saves a story as an ordinary text.

## Summary

Reader picks the words (due and known, from its own memory, read-only), writes the prompts and runs
the draft loop itself, scoring each draft with spec 015's `scoreText`. Drafts are written through
one new Termux service job endpoint, `/generate`, which forwards to a laptop story writer when it
answers and otherwise runs the phone's Qwen3-1.7B through `story.py`, under translate.py's model
budget so translation and stories never hold the model at once.

## Technical Context

- **Languages**: TypeScript (app), Python 3 (Termux service, story.py, laptop writer).
- **Dependencies**: existing only: llama-completion and the 1.7B model in Termux; llama_cpp and
  Qwen3-4B-Instruct on the laptop (sentencegen's venv, as the prototype).
- **Storage**: none new; `localStorage` for length and topic. One read-only repository query
  (`vocabulary`: words with a state or reading memory, with their library counts).
- **Testing**: vitest for the draft loop with a stub writer (rewrites name never-met words, stop
  after two, best draft kept); service tests with `STORY_STUB` and a fake laptop; browser scenario.
- **Constraints**: no history writes before Read it (FR-008); the phone's model never runs beside a
  translation (FR-005); no hosting (ADR-0007).

## Constitution Check

I phone (deployed, phone check of a phone-written story) · II no state transition; the loop and
word choice tested first · III untouched · IV one slice · V prompts and loop in `content/story.ts`,
model calls behind the service · VI research.md · VII reuses scoreText, kindOf, isDueWord ·
VIII progress shown per draft. No violations.

## Structure

```text
src/lib/content/story.ts            # word choice, prompts, draft loop
src/lib/storage/repository.ts       # vocabulary(): read-only
src/routes/story/+page.svelte       # the page; a link from Texts
scripts/termux/story.py             # one generation on the phone, via translate.py's budget
scripts/termux/reader-service.py    # POST /generate, GET /generate/<job>
scripts/story-writer/server.py      # the laptop writer (llama_cpp, Qwen3-4B), README
tests/content/story.test.ts
```
