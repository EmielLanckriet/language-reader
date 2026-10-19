# Quickstart: validating word status

## Laptop

```sh
npx vitest run tests/domain/status.test.ts tests/domain/legacy-active.test.ts \
  tests/storage/status.test.ts tests/storage/cards.test.ts tests/storage/backup.test.ts
npm test && npm run check && npm run lint
```

- `status.test.ts` (domain): each transition edge and each rule of research R3, mutation-checked;
  a property that `activation` never returns anything for `active` or `ignored`.
- `legacy-active.test.ts`: the characterization cases written against today's code before it
  changed (research R4).
- `status.test.ts` (storage): replay reproduces `word_status`; the switch on a seeded library
  (carry-over, deleted marks, `(none)` kept for an Anki undo, once only); a restored format 3 copy
  runs it; a format 4 copy restores statuses exactly; Cards, hardcore and shares by status.
- On the 2026-10-16 backup (outside the repository): after the switch, active = 2,111 + 1 (丁),
  and 0 marks other than Anki levels and `(none)`.

## Browser (isolated)

`npm run build`, then the `cards`, `study`, `hardcore`, `wordlist` and `sheet` scenarios: Retire and
Ignore with Undo on Cards and in a drill; un-ignore in the word sheet and the Progress detail.

## Phone

After the update: Cards' due count and the number of active words (Progress word list, filtered)
equal the counts read just before the update, plus 丁;
an ignored word leaves Cards and the next drill; the "Just curious" chip records a reason.
