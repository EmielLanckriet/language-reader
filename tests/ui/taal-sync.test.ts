import { describe, expect, it } from 'vitest';
import { sendNow, type SendDeps } from '../../src/lib/taal/sync';
import type { TaalInputs, TaalSession } from '../../src/lib/domain/taal';

// The send's plumbing (spec 020): the request Taal's rules accept, what is remembered as sent, and
// what a refusal or a lost connection leaves behind.

const URL_ = 'https://taal.test/v1/projects/language-81ef3/databases/(default)/documents';
const CODE = 'AbCdEfGhIjKlMnOpQrSt.0123456789abcdefghijABCDEFGHIJkl';
const DOCS = 'projects/language-81ef3/databases/(default)/documents';

/** `minutes` of one-minute reading at the start of each of `hours` successive hours. */
function reading(hours: number, minutes = 1): TaalInputs {
	const start = Date.parse('2026-10-26T08:00:00Z');
	return {
		studyTime: Array.from({ length: hours }, (_, h) =>
			Array.from({ length: minutes }, (_, m) => ({
				at: new Date(start + h * 3600000 + (m + 1) * 60000).toISOString(),
				durationMs: 60000,
				sessionId: null
			}))
		).flat(),
		answers: [],
		cards: [],
		drills: []
	};
}

function setup(inputs: TaalInputs, answer: (n: number) => number | Error = () => 200) {
	const requests: { url: string; body: { writes: unknown[] } }[] = [];
	let stored: Record<string, TaalSession> = {};
	const deps: SendDeps = {
		storage: { taalInputs: async () => inputs },
		sent: {
			read: (code) => (code === CODE ? stored : {}),
			write: (code, sent) => {
				expect(code).toBe(CODE);
				stored = sent;
			}
		},
		fetch: (async (url: string, init: { body: string }) => {
			requests.push({ url, body: JSON.parse(init.body) });
			const status = answer(requests.length);
			if (status instanceof Error) throw status;
			return new Response('{}', { status });
		}) as unknown as typeof fetch,
		url: URL_,
		connection: { code: CODE, since: '2026-10-26', on: true },
		timeZone: 'Europe/Brussels',
		dayEndHour: 4,
		now: new Date('2026-10-26T20:00:00Z'),
		online: true
	};
	return { deps, requests, stored: () => stored };
}

describe('sendNow', () => {
	it("sends the changed hours in Taal's own request shape, and then has nothing to send", async () => {
		const { deps, requests } = setup(reading(1, 12));
		expect(await sendNow(deps)).toMatchObject({
			ok: true,
			today: { input: 12, study: 0, cards: 0 }
		});
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe(`${URL_}:commit?key=AIzaSyDKFxjk7_QxTJX0vg57PfXqLP7gAK-2Clo`);
		const stamp = { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' };
		expect(requests[0].body).toEqual({
			writes: [
				{
					update: {
						name: `${DOCS}/appInbox/AbCdEfGhIjKlMnOpQrSt`,
						fields: { code: { stringValue: '0123456789abcdefghijABCDEFGHIJkl' } }
					},
					updateTransforms: [stamp]
				},
				{
					update: {
						name: `${DOCS}/appSources/AbCdEfGhIjKlMnOpQrSt`,
						fields: {
							sessions: {
								mapValue: {
									fields: {
										'2026-10-26T09': {
											mapValue: {
												fields: {
													at: { integerValue: String(Date.parse('2026-10-26T08:01:00Z')) },
													input: { integerValue: '12' }
												}
											}
										}
									}
								}
							}
						}
					},
					updateMask: { fieldPaths: ['sessions.`2026-10-26T09`'] },
					updateTransforms: [stamp]
				}
			]
		});
		await sendNow(deps);
		expect(requests).toHaveLength(1);
	});

	it('remembers each batch Taal accepted and stops at a refusal, saying so', async () => {
		// 150 hours: two batches; Taal refuses the second.
		const { deps, requests, stored } = setup(reading(150), (n) => (n === 1 ? 200 : 403));
		deps.connection = { ...deps.connection!, since: '2026-10-01' };
		deps.now = new Date('2026-11-05T12:00:00Z');
		expect(await sendNow(deps)).toMatchObject({ ok: false, reason: 'refused' });
		expect(requests).toHaveLength(2);
		expect(Object.keys(stored())).toHaveLength(100);
	});

	it('keeps everything pending when Taal cannot be reached, and asks nothing offline', async () => {
		const { deps, requests, stored } = setup(reading(1), () => new TypeError('Failed to fetch'));
		expect(await sendNow(deps)).toMatchObject({ ok: false, reason: 'offline' });
		expect(stored()).toEqual({});
		expect(await sendNow({ ...deps, online: false })).toMatchObject({ reason: 'offline' });
		expect(requests).toHaveLength(1);
	});

	it('sends nothing while sending is off', async () => {
		const { deps, requests } = setup(reading(1));
		expect(await sendNow({ ...deps, connection: { ...deps.connection!, on: false } })).toBeNull();
		expect(await sendNow({ ...deps, connection: null })).toBeNull();
		expect(requests).toHaveLength(0);
	});
});
