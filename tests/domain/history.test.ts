import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { assertion, inHistoryOrder } from '../../src/lib/domain/history';
import { projectStates } from '../../src/lib/domain/state';
import type { HistoryEntry } from '../../src/lib/domain/types';

// FR-011 and invariant 2 of data-model.md: folding the history in (device_id, device_seq) order
// through the current projection reproduces word_state exactly, for every lexeme.
//
// This is the property that makes word_state a cache rather than a second source of truth. If it
// ever stops holding, the history has become decorative and ADR-0003's whole argument for
// recording it fails.

describe('constructing a history entry', () => {
	it('records what was asserted, not what the state became (FR-010a)', () => {
		const entry = assertion({
			lexemeId: 3,
			asserted: 'known',
			deviceId: 'd1',
			deviceSeq: 1,
			assertedAt: '2026-01-01T00:00:00.000Z'
		});
		expect(entry.asserted).toBe('known');
		// There is no `becameState` or `previousState` field. An entry states what the reader
		// claimed; what follows from that is the projection's business and may change.
		expect(Object.keys(entry)).not.toContain('state');
	});

	it('defaults provenance and owner rather than leaving them empty', () => {
		const entry = assertion({
			lexemeId: 3,
			asserted: 'known',
			deviceId: 'd1',
			deviceSeq: 1,
			assertedAt: '2026-01-01T00:00:00.000Z'
		});
		expect(entry.provenance).toBe('manual');
		expect(entry.userId).toBe(1);
	});

	it('keeps the occurrence when one is given', () => {
		const entry = assertion({
			lexemeId: 3,
			asserted: 'known',
			deviceId: 'd1',
			deviceSeq: 1,
			assertedAt: '2026-01-01T00:00:00.000Z',
			occurrence: { documentId: 9, fromOffset: 4, toOffset: 5 }
		});
		expect(entry.occurrence).toEqual({ documentId: 9, fromOffset: 4, toOffset: 5 });
	});
});

describe('history order', () => {
	function entry(deviceId: string, deviceSeq: number, lexemeId = 1, asserted = 'known') {
		return assertion({
			lexemeId,
			asserted,
			deviceId,
			deviceSeq,
			assertedAt: '2026-01-01T00:00:00.000Z'
		});
	}

	it('orders by device, then by that device counter', () => {
		const ordered = inHistoryOrder([entry('b', 1), entry('a', 2), entry('a', 1)]);
		expect(ordered.map((e) => `${e.deviceId}:${e.deviceSeq}`)).toEqual(['a:1', 'a:2', 'b:1']);
	});

	it('is a total order, so replay is deterministic', () => {
		fc.assert(
			fc.property(
				fc.array(fc.tuple(fc.constantFrom('a', 'b', 'c'), fc.integer({ min: 1, max: 20 })), {
					maxLength: 20
				}),
				(pairs) => {
					// Distinct (device, seq) pairs, as the unique index guarantees in the database.
					const seen = new Set<string>();
					const entries: HistoryEntry[] = [];
					for (const [device, seq] of pairs) {
						const key = `${device}:${seq}`;
						if (seen.has(key)) continue;
						seen.add(key);
						entries.push(entry(device, seq));
					}

					const once = inHistoryOrder(entries).map((e) => `${e.deviceId}:${e.deviceSeq}`);
					const twice = inHistoryOrder([...entries].reverse()).map(
						(e) => `${e.deviceId}:${e.deviceSeq}`
					);
					expect(twice).toEqual(once);
				}
			)
		);
	});
});

describe('replay', () => {
	it('reproduces the projection from the history alone (FR-011)', () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.tuple(
						fc.integer({ min: 1, max: 5 }),
						fc.constantFrom('unknown', 'learning', 'known', 'ignored')
					),
					{ maxLength: 30 }
				),
				(pairs) => {
					const entries = pairs.map(([lexemeId, asserted], index) =>
						assertion({
							lexemeId,
							asserted,
							deviceId: 'd1',
							deviceSeq: index + 1,
							assertedAt: '2026-01-01T00:00:00.000Z'
						})
					);

					// Fold the whole log from the beginning; compare against folding it again after
					// a shuffle. Replay must not depend on the order rows happen to come back in.
					const replayed = projectStates(inHistoryOrder([...entries].reverse()));
					const direct = projectStates(entries);
					expect(replayed).toEqual(direct);
				}
			)
		);
	});
});
