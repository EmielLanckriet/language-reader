import { afterEach, expect, it, vi } from 'vitest';
import { quickTranslation, type QuickReply } from '../../src/lib/translation/quick';

vi.mock('$app/paths', () => ({ base: '' }));
vi.mock('../../src/lib/inference-budget', () => ({ inferenceBudget: vi.fn(async () => vi.fn()) }));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

it('terminates hidden translation, resumes without losing lines, and bounds a stalled worker', async () => {
	vi.useFakeTimers();
	const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
	const win = new EventTarget();
	vi.stubGlobal('document', doc);
	vi.stubGlobal('addEventListener', win.addEventListener.bind(win));
	vi.stubGlobal('removeEventListener', win.removeEventListener.bind(win));
	vi.stubGlobal('caches', { open: async () => ({ match: async () => true }) });
	const workers: FakeWorker[] = [];
	class FakeWorker {
		onmessage?: (event: { data: QuickReply }) => void;
		terminate = vi.fn();
		postMessage = vi.fn();
		constructor() {
			workers.push(this);
		}
	}
	vi.stubGlobal('Worker', FakeWorker);
	const saved = new Map<number, string>();
	const onStatus = vi.fn();
	const translation = quickTranslation(
		() => ['一', '二'],
		(i) => saved.has(i),
		(i, en) => saved.set(i, en),
		onStatus
	);
	await vi.waitFor(() => expect(workers).toHaveLength(1));
	workers[0].onmessage?.({ data: { kind: 'ready' } });
	workers[0].onmessage?.({ data: { kind: 'line', index: 0, english: 'one' } });
	doc.visibilityState = 'hidden';
	doc.dispatchEvent(new Event('visibilitychange'));
	expect(workers[0].terminate).toHaveBeenCalledOnce();
	translation.more();
	expect(workers).toHaveLength(1);
	doc.visibilityState = 'visible';
	doc.dispatchEvent(new Event('visibilitychange'));
	await vi.waitFor(() => expect(workers).toHaveLength(2));
	workers[1].onmessage?.({ data: { kind: 'ready' } });
	expect(workers[1].postMessage).toHaveBeenLastCalledWith({
		kind: 'translate',
		index: 1,
		text: '二'
	});
	await vi.advanceTimersByTimeAsync(90_000);
	expect(workers[1].terminate).toHaveBeenCalledOnce();
	expect(saved.get(0)).toBe('one');
	translation.stop();
});
