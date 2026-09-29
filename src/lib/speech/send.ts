/**
 * A finished transcript goes to the Termux service, which translates it (FR-019,
 * contracts/reader-service.md). Never blocks the transcript: a document is complete without it,
 * and its lines keep Reader's quick English until the LLM's arrive.
 */
import { jobOf } from '$lib/media/translation';
import {
	mediaDocuments,
	mediaFiles,
	readMediaJson,
	writeMediaJson,
	TRANSCRIPT_METHOD,
	TRANSCRIPT_SENT
} from '$lib/media/store';

const SERVICE = 'http://127.0.0.1:8765';

/**
 * Reader is transcribing: Termux's translation waits between chunks while it hears this every 20 s
 * (the two together took a window from 22 s to 55 s on the phone). Best effort, like the rest.
 */
export function sayBusy(): void {
	void fetch(`${SERVICE}/busy`, { method: 'PUT' }).catch(() => {});
}

/** Send one document's transcript, unless it has been; true once Termux has it or never will. */
export async function sendTranscript(documentId: number): Promise<boolean> {
	if (await readMediaJson(documentId, TRANSCRIPT_SENT)) return true;
	const files = await mediaFiles(documentId);
	const meta = files.find((f) => f.name === 'meta.json');
	const vtt = files.find((f) => f.name === 'media.zh.vtt');
	const job = meta ? jobOf(JSON.parse(await meta.text())) : undefined;
	if (!job || !vtt) return true;
	const response = await fetch(`${SERVICE}/downloads/${encodeURIComponent(job)}/media.zh.vtt`, {
		method: 'PUT',
		headers: { 'Content-Type': 'text/vtt' },
		body: await vtt.text()
	});
	if (response.status === 204) {
		await writeMediaJson(documentId, TRANSCRIPT_SENT, { at: new Date().toISOString() });
		return true;
	}
	// Termux no longer has the job (pruned, or never there): nothing will ever translate it.
	if (response.status === 404) {
		await writeMediaJson(documentId, TRANSCRIPT_SENT, { gone: true, at: new Date().toISOString() });
		return true;
	}
	return false;
}

/** Every transcript Reader wrote and Termux does not have yet; errors wait for the next try. */
export async function sendUnsent(): Promise<void> {
	for (const id of await mediaDocuments()) {
		if (!(await readMediaJson(id, TRANSCRIPT_METHOD))) continue;
		try {
			await sendTranscript(id);
		} catch {
			// The service is not running; tried again later.
		}
	}
}
