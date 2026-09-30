import { afterEach, expect, it, vi } from 'vitest';
import { CardAudio, timedExample } from '../../src/lib/media/card-audio';
import type { CardSentence } from '../../src/lib/storage/repository';
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});
it('expands a punctuation fragment to exactly its timed cue and refuses a changed transcript', () => {
	const sentence: CardSentence = {
		source: 'reader',
		sourceTitle: 'Clip',
		sourceKey: 'r:1',
		available: true,
		documentId: 1,
		text: '学习。',
		from: 3,
		to: 6,
		wordFrom: 0,
		wordTo: 2,
		line: 0,
		lineFrom: 0,
		lineText: '你好。学习。'
	};
	const cues = [{ start: 3, end: 5, text: '你好。学习。' }];
	expect(timedExample(sentence, cues)).toMatchObject({
		start: 3,
		end: 5,
		sentence: { text: cues[0].text, from: 0, to: 6, wordFrom: 3, wordTo: 5 }
	});
	expect(timedExample(sentence, [{ ...cues[0], text: 'different' }])).toBeUndefined();
});
it('bounds playback and cancels stale play completion, hidden playback and object URLs', async () => {
	vi.useFakeTimers();
	const document = new EventTarget();
	Object.assign(document, { hidden: false });
	vi.stubGlobal('document', document);
	const cancel = vi.fn();
	vi.stubGlobal('speechSynthesis', { cancel });
	const revoke = vi.spyOn(URL, 'revokeObjectURL');
	vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
	let resolve!: () => void;
	class AudioStub {
		currentTime = 0;
		duration = 60;
		src = '';
		preload = '';
		onloadedmetadata?: () => void;
		ontimeupdate?: () => void;
		onended?: () => void;
		onerror?: () => void;
		pause = vi.fn();
		load = vi.fn();
		removeAttribute = vi.fn();
		play = () => new Promise<void>((r) => (resolve = r));
	}
	const instances: AudioStub[] = [];
	vi.stubGlobal(
		'Audio',
		class extends AudioStub {
			constructor() {
				super();
				instances.push(this);
			}
		}
	);
	const report = vi.fn();
	const player = new CardAudio(report);
	player.play(new Blob(['audio']), 2, 4);
	instances[0].onloadedmetadata?.();
	expect(instances[0].currentTime).toBe(2);
	instances[0].currentTime = 4;
	vi.advanceTimersByTime(40);
	expect(instances[0].pause).toHaveBeenCalled();
	expect(revoke).toHaveBeenCalledWith('blob:test');
	resolve();
	await Promise.resolve();
	expect(report).not.toHaveBeenCalledWith(true);
	player.play(new Blob(['audio']));
	instances[1].onloadedmetadata?.();
	resolve();
	await Promise.resolve();
	expect(report).toHaveBeenCalledWith(true);
	Object.assign(document, { hidden: true });
	document.dispatchEvent(new Event('visibilitychange'));
	expect(instances[1].pause).toHaveBeenCalled();
	player.dispose();
	expect(vi.getTimerCount()).toBe(0);
	expect(cancel).toHaveBeenCalled();
});
