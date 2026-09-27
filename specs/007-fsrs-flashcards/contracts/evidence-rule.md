# Contract: the evidence rule and the memory fold

Pure, in the domain core (`src/lib/domain/memory.ts`). No storage and no framework imports.

```ts
type Skill = 'reading' | 'listening';

interface Evidence { at: Date; rating: 1 | 2 | 3 | 4 }   // Again, Hard, Good, Easy
interface Seed { stability: number; difficulty: number; lastReview: Date; known: boolean }

/** What one word's history says, per skill, under one named rule. */
function evidenceFor(history: WordHistory, rule: 'evidence-1'): Map<Skill, { seed?: Seed; evidence: Evidence[] }>;

/** ts-fsrs over one skill's evidence: the memory state, or none. */
function foldMemory(seed: Seed | undefined, evidence: Evidence[]): MemoryState | undefined;

/** Today's chance of recall. */
function recall(memory: MemoryState, now: Date): number;
```

`WordHistory` is everything touching one lexeme: its status events, its lookups/checks/reviews, and
the ranges covering its tokens with their session's attention answer and modality.

## Obligations

1. **Determinism**: the same history and rule give the same memory, bit for bit.
2. **Rebuild equals incremental**: recomputing every word from an empty `memory` table gives exactly
   the rows that per-event recomputation left (SC-007).
3. **Order is history order** (device, device_seq), never wall-clock. `at` only supplies the elapsed
   time between evidence.
4. **evidence-1 as specified** in research.md R5. Each limit is a test: lookups count once per
   session; passive evidence counts once per word, skill and day, only under `all`, and only for a
   word that already had a state; Anki is ignored after the first review; `ignored` words have no
   memory.
5. **No evidence, no row**: a word with only unanswered-session ranges has no memory.
6. **Card creation is the rule's**: under `evidence-1`, a lookup, an Anki seed or a hand mark of
   `learning` makes the reading memory a card; `ignored` never is. Adding a trigger changes only
   the rule.
