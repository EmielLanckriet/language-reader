import { describe, it, expect } from 'vitest';
import { issueFrom, BODY_LIMIT, type ReportState } from '../../src/lib/report/report';

// A report goes to a public issue tracker. What the reader read or looked up must not go with it,
// and GitHub refuses a body over its limit, which would lose the whole report.

const state: ReportState = {
	device: { Build: '1791790009088' },
	screen: { Route: '/read/39' },
	failures: [{ id: 1, at: '2026-10-15T08:00:00Z', kind: 'storage', detail: 'Error: locked' }],
	session: {
		title: 'Hidden Challenges',
		modality: 'video',
		startedAt: '2026-10-15T08:00:00.000Z',
		encounters: [
			{
				kind: 'lookup',
				word: '朋友',
				mediaMs: 1200,
				detail: '{"form":"朋友"}',
				at: '2026-10-15T08:00:05.000Z'
			},
			{
				kind: 'pause',
				mediaMs: 3400,
				speed: 1,
				textVisible: true,
				detail: '{}',
				at: '2026-10-15T08:00:09.000Z'
			}
		]
	}
};
const all = { device: true, screen: true, failures: true, session: true };

describe('issueFrom', () => {
	it('keeps the words and titles of what was read out of the report', () => {
		const { body } = issueFrom(
			{ kind: 'problem', title: 't', description: 'd', include: all },
			state
		);
		expect(body).toContain('lookup');
		expect(body).toContain('pause');
		expect(body).not.toContain('朋友');
		expect(body).not.toContain('Hidden Challenges');
	});

	it('leaves out what was not ticked', () => {
		const { body } = issueFrom(
			{ kind: 'idea', title: 't', description: 'd', include: { ...all, failures: false } },
			state
		);
		expect(body).not.toContain('Error: locked');
		expect(body).toContain('/read/39');
	});

	it('stays within GitHub’s limit, with the description whole', () => {
		const description = 'what went wrong '.repeat(500).trim();
		const failures = Array.from({ length: 100 }, (_, i) => ({
			id: i,
			at: '2026-10-15T08:00:00Z',
			kind: 'unexpected',
			detail: 'x'.repeat(20_000)
		}));
		const { body } = issueFrom(
			{ kind: 'problem', title: 't', description, include: all },
			{ ...state, failures }
		);
		expect(body.length).toBeLessThanOrEqual(BODY_LIMIT);
		expect(body).toContain(description);
		// One long section must not crowd out the others.
		expect(body).toContain('+0.0 s · lookup');
	});

	// A session's row is written at the first save, after its first events: timing from it gave
	// negative offsets.
	it('times events from the first one, not from when the session was saved', () => {
		const saved = { ...state.session!, startedAt: '2026-10-15T08:00:10.000Z' };
		const { body } = issueFrom(
			{ kind: 'problem', title: 't', description: 'd', include: all },
			{ ...state, session: saved }
		);
		expect(body).toContain('+0.0 s · lookup');
		expect(body).toContain('+4.0 s · pause');
	});

	it('labels problems as bugs and ideas as enhancements', () => {
		const draft = { title: 't', description: 'd', include: all };
		expect(issueFrom({ ...draft, kind: 'problem' }, state).labels).toEqual(['bug']);
		expect(issueFrom({ ...draft, kind: 'idea' }, state).labels).toEqual(['enhancement']);
	});
});
