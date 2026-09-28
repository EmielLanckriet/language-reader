/**
 * How many threads transcribe fastest on this device, measured once (research R9, FR-010).
 *
 * On the reader's phone 2 threads decode a 30 s window in 22 s, 1 thread in 38.6 s, and 3 or 4 are
 * slower than 1: two fast cores and six slow ones, and onnxruntime waits for the slowest thread on
 * every op. Another phone will differ, so it is measured rather than assumed. The encoder's cost
 * depends on the audio's length, not on what is said, so a generated signal times it as well as
 * speech. Each trial needs its own worker: onnxruntime fixes its thread count when it starts.
 */
import { REVISION, RUNTIME, readJson, speechRoot } from './model';
import { SpeechClient } from './worker-client';

const FILE = 'calibration.json';
const TRIALS = [1, 2, 4];

export interface Calibration {
	threads: number;
	timings: Record<string, number>;
	revision: string;
	runtime: string;
	cores: number;
	isolated: boolean;
	at: string;
}

export async function readCalibration(): Promise<Calibration | undefined> {
	return readJson<Calibration>(await speechRoot(), FILE);
}

function valid(c: Calibration | undefined): c is Calibration {
	return (
		!!c &&
		c.isolated &&
		c.revision === REVISION &&
		c.runtime === RUNTIME &&
		c.cores === navigator.hardwareConcurrency
	);
}

/** The measured count when it still applies, otherwise one thread, which always works. */
export async function calibratedThreads(): Promise<number> {
	if (!globalThis.crossOriginIsolated) return 1;
	const c = await readCalibration();
	return valid(c) ? c.threads : 1;
}

/** Whether to measure now: only in an isolated session, since threads need it. */
export async function needsCalibration(): Promise<boolean> {
	return !!globalThis.crossOriginIsolated && !valid(await readCalibration());
}

export async function calibrate(
	base: string,
	worker: () => SpeechClient,
	onStep: (step: number, of: number) => void
): Promise<Calibration> {
	const counts = TRIALS.filter((n) => n <= (navigator.hardwareConcurrency || 1));
	const timings: Record<string, number> = {};
	for (const [i, threads] of counts.entries()) {
		onStep(i + 1, counts.length);
		const client = worker();
		try {
			await client.open(base, REVISION, threads);
			// Twice, keeping the second: the first also pays for warming the session up.
			timings[threads] = Math.round(await client.time(10, 2));
		} finally {
			client.close();
		}
	}
	const threads = Number(Object.entries(timings).sort((a, b) => a[1] - b[1])[0][0]);
	const result: Calibration = {
		threads,
		timings,
		revision: REVISION,
		runtime: RUNTIME,
		cores: navigator.hardwareConcurrency,
		isolated: !!globalThis.crossOriginIsolated,
		at: new Date().toISOString()
	};
	const writable = await (
		await (await speechRoot()).getFileHandle(FILE, { create: true })
	).createWritable();
	await writable.write(JSON.stringify(result));
	await writable.close();
	return result;
}
