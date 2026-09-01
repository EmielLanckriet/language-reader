import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { AVAILABLE_STATES, stateNames, projectStates } from '../../src/lib/domain/state';
import { assertion } from '../../src/lib/domain/history';
import type { HistoryEntry } from '../../src/lib/domain/types';

// Constitution Principle II: word state transitions are test-first, property-based.
//
// The thing under test is *not* a fixed set of four states. FR-006a says the set is configuration
// and nothing may depend on there being four, on their names, or on their order — so these tests
// are written against whatever the configuration says, and would keep passing if a fifth arrived.
// What is actually asserted is FR-010a: current state is a function of the history alone.

const DEVICE = 'device-a';

/** A history built from a list of (lexeme, asserted) pairs, numbered as one device would. */
function historyOf(pairs: [number, string][]): HistoryEntry[] {
	return pairs.map(([lexemeId, asserted], index) =>
		assertion({
			lexemeId,
			asserted,
			deviceId: DEVICE,
			deviceSeq: index + 1,
			assertedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
		})
	);
}

const anyAssertions = fc.array(
	fc.tuple(fc.integer({ min: 1, max: 6 }), fc.constantFrom(...stateNames())),
	{ maxLength: 40 }
);

describe('the state set', () => {
	it('is configuration, not structure (FR-006a)', () => {
		// Deliberately not `toEqual([...four names...])`. Adding a state must not break a test.
		expect(AVAILABLE_STATES.length).toBeGreaterThan(0);
		for (const state of AVAILABLE_STATES) {
			expect(state.name).toBeTypeOf('string');
			expect(state.label).toBeTypeOf('string');
		}
	});

	it('has distinct names', () => {
		expect(new Set(stateNames()).size).toBe(AVAILABLE_STATES.length);
	});

	it('ships the placeholder set slice 0 was specified with', () => {
		// The one place the four are named. If this fails because a state was *added*, update it;
		// if it fails because one was renamed, that is a change of meaning and is expensive —
		// it reinterprets marks already made (FR-006a).
		expect(stateNames()).toContain('unknown');
		expect(stateNames()).toContain('learning');
		expect(stateNames()).toContain('known');
		expect(stateNames()).toContain('ignored');
	});
});

describe('the projection', () => {
	it('is empty for an empty history', () => {
		expect(projectStates([]).size).toBe(0);
	});

	it('records a single assertion', () => {
		const states = projectStates(historyOf([[7, 'learning']]));
		expect(states.get(7)?.state).toBe('learning');
	});

	it('takes the most recent assertion about a word (FR-010b)', () => {
		const states = projectStates(
			historyOf([
				[7, 'unknown'],
				[7, 'known'],
				[7, 'learning']
			])
		);
		expect(states.get(7)?.state).toBe('learning');
	});

	it('creates a row only for words actually judged (FR-006b)', () => {
		// A word merely displayed and never touched has no entry, and so has no state. That is
		// distinct from any state the reader can choose, including a deliberate 'unknown'.
		const states = projectStates(historyOf([[7, 'known']]));
		expect(states.has(7)).toBe(true);
		expect(states.has(8)).toBe(false);
	});

	it('treats a downgrade to unknown as a judgment like any other (FR-006b)', () => {
		const states = projectStates(
			historyOf([
				[7, 'known'],
				[7, 'unknown']
			])
		);
		expect(states.get(7)?.state).toBe('unknown');
		expect(states.has(7)).toBe(true);
	});

	it('orders by the device counter, never by wall-clock time (FR-010c)', () => {
		// A clock that jumped backwards between the two marks. The later assertion still wins,
		// because device_seq is what orders the log.
		const entries: HistoryEntry[] = [
			assertion({
				lexemeId: 7,
				asserted: 'known',
				deviceId: DEVICE,
				deviceSeq: 1,
				assertedAt: '2026-05-01T12:00:00.000Z'
			}),
			assertion({
				lexemeId: 7,
				asserted: 'learning',
				deviceId: DEVICE,
				deviceSeq: 2,
				assertedAt: '2020-01-01T00:00:00.000Z'
			})
		];
		expect(projectStates(entries).get(7)?.state).toBe('learning');
	});

	it('does not depend on the order entries are handed to it', () => {
		fc.assert(
			fc.property(anyAssertions, fc.array(fc.nat(), { maxLength: 40 }), (pairs, noise) => {
				const entries = historyOf(pairs);
				// A deterministic shuffle driven by generated data.
				const shuffled = entries
					.map((entry, i) => ({ entry, key: noise[i] ?? i }))
					.sort((a, b) => a.key - b.key)
					.map((x) => x.entry);
				expect(projectStates(shuffled)).toEqual(projectStates(entries));
			})
		);
	});

	it('always agrees with the last assertion about each word', () => {
		fc.assert(
			fc.property(anyAssertions, (pairs) => {
				const states = projectStates(historyOf(pairs));

				const expected = new Map<number, string>();
				for (const [lexemeId, asserted] of pairs) expected.set(lexemeId, asserted);

				expect(states.size).toBe(expected.size);
				for (const [lexemeId, asserted] of expected) {
					expect(states.get(lexemeId)?.state).toBe(asserted);
				}
			})
		);
	});

	it('carries provenance and owner through to the projection (FR-012, FR-013)', () => {
		const states = projectStates(historyOf([[7, 'known']]));
		expect(states.get(7)?.provenance).toBe('manual');
		expect(states.get(7)?.userId).toBe(1);
	});
});
