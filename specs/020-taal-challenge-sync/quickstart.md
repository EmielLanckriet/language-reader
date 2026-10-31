# Quickstart: validating spec 020

## Tests

`npm test -- tests/domain/taal tests/storage/taal tests/backup` — shares by the mapping (US1),
the difference against what was sent with hand entries and the zero clamp (US2; a property over
random send/edit/answer/withdraw sequences: Taal's value = hand entries + share whenever hand
entries stay ≥ 0), days from `since` only, copy format 5 round trip, restore turning sending off,
and one sync test against a fake log (precondition retry; a failed send leaves `taal_sent` as it
was). Each rule mutated once and seen red.

## Browser

`BASE_PATH=/language-reader npm run build` (verification mode), then
`npm run verify:browser -- taal`: connect with the fake account; read a synthetic text for a
minute and answer "Yes, every unknown word"; the stub's log shows 1 minute of Study for today;
change the answer to "Only some" under More → Sessions; the stub shows 1 of Input and 0 of Study;
a hand value already in the stub's log is kept; Progress shows the last send; with the stub
refusing, Progress shows the reason and the next working send catches up. Also `study`,
`leaving` and `hardcore` (they reach the triggers).

## Phone (needs the friend's authorized domain)

1. Connect under More with the reader's Google account (the reader signs in; the popup from the
   installed app is the first thing checked, research R2).
2. Note Taal's challenge for today, then read, do Cards and a drill part.
3. Open Taal's challenge: today's Input, Study and cards grew by what Progress's Taal line says
   was sent, and hand entries made earlier today are still there.
4. Offline for a session, then online: the minutes arrive on the next open.
