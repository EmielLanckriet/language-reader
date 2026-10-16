# Tasks: Stories with your due words

- [x] T001 Test first `tests/content/story.test.ts`: the draft loop with a stub writer asks a rewrite
      naming the never-met words, stops after two rewrites or none left, keeps the best known share;
      word choice takes due words by `isDueWord` and known ones by `kindOf`, most frequent first.
- [x] T002 `src/lib/content/story.ts` (+ `vocabulary()` read-only in the repository and plumbing).
- [x] T003 Service tests, then `POST /generate` / `GET /generate/<job>` with laptop probe and
      `story.py` fallback; `scripts/termux/story.py` with `STORY_STUB`.
- [x] T004 `scripts/story-writer/server.py` and README (laptop, Qwen3-4B).
- [x] T005 `src/routes/story/+page.svelte`, link from Texts.
- [x] T006 Browser scenario `story` (stub writer); `setup.sh` installs story.py.
- [ ] T007 Deploy; update the phone's scripts; phone check (a phone-written story); docs; #10.
