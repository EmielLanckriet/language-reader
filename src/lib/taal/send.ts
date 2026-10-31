import type { TaalSession } from '$lib/domain/taal';

/**
 * Taal's `sendToTaal()`, from its connect guide (https://language-81ef3.web.app/connect/README.md,
 * version 2026-10-29), in TypeScript. The guide asks for the request to stay exactly as published:
 * Taal's security rules accept that shape and no other. Only `fetch` and the database address are
 * passed in, so a test or a verification build never reaches Taal.
 */
export const TAAL_DOCS = 'projects/language-81ef3/databases/(default)/documents';
/** Taal's public web key, the one its own page ships: public on purpose. */
export const TAAL_KEY = 'AIzaSyDKFxjk7_QxTJX0vg57PfXqLP7gAK-2Clo';
export const TAAL_URL = `https://firestore.googleapis.com/v1/${TAAL_DOCS}`;
const TAAL_FIELDS = ['input', 'study', 'output', 'review', 'cards'] as const;

/** Whether the text looks like a Taal code: `{linkId}.{secret}`. */
export function isTaalCode(code: unknown): code is string {
	return /^[A-Za-z0-9]{20}\.[A-Za-z0-9]{32}$/.test(String(code ?? '').trim());
}

/** Taal refused the code: mistyped, or the reader removed the app in Taal. */
export class TaalCodeError extends Error {
	name = 'TaalCodeError';
}

type Session = TaalSession & { output?: number; review?: number };

export async function sendToTaal(
	code: string,
	sessions: Session[],
	fetch: typeof globalThis.fetch,
	url = TAAL_URL
): Promise<void> {
	if (!isTaalCode(code)) throw new TaalCodeError('This is not a Taal code.');
	if (sessions.length > 100) throw new Error('Send at most 100 sessions at once.');
	if (!sessions.length) return;
	const [linkId, secret] = code.trim().split('.');
	const number = (value: number) =>
		Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
	// Each session is its own field, so the ones sent before stay.
	const quote = (id: string) => '`' + String(id).replace(/[\\`]/g, '\\$&') + '`';
	const fields: Record<string, unknown> = {};
	for (const session of sessions) {
		const at = new Date(session.at).getTime();
		if (!Number.isFinite(at)) throw new Error(`Session ${session.id} has no valid time.`);
		const values: Record<string, unknown> = { at: number(at) };
		for (const field of TAAL_FIELDS) {
			const value = session[field];
			if (value !== undefined && value > 0) values[field] = number(value);
		}
		fields[session.id] = { mapValue: { fields: values } };
	}
	// Taal's server stamps the time, so the device's clock doesn't matter.
	const stamp = { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' };
	const response = await fetch(`${url}:commit?key=${TAAL_KEY}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			writes: [
				{
					update: {
						name: `${TAAL_DOCS}/appInbox/${linkId}`,
						fields: { code: { stringValue: secret } }
					},
					updateTransforms: [stamp]
				},
				{
					update: {
						name: `${TAAL_DOCS}/appSources/${linkId}`,
						fields: { sessions: { mapValue: { fields } } }
					},
					updateMask: {
						fieldPaths: sessions.map((session) => `sessions.${quote(session.id)}`)
					},
					updateTransforms: [stamp]
				}
			]
		})
	});
	if (response.status === 403)
		throw new TaalCodeError(
			'Taal refused the code. Copy it again from Taal, or connect the app again.'
		);
	if (!response.ok) throw new Error(`Taal could not save the study time (${response.status}).`);
}
