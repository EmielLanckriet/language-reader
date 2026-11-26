import { afterEach, expect, it, vi } from 'vitest';
import { CardAudio, shownExample } from '../../src/lib/media/card-audio';
import { PLAIN } from '../../src/lib/media/layout';
import type { StoredMedia } from '../../src/lib/media/store';
import type { CardSentence } from '../../src/lib/storage/repository';

const media = (over: Partial<StoredMedia>): StoredMedia => ({
	media: undefined,
	cues: [],
	translation: [],
	quick: [],
	meta: {},
	tracks: [],
	english: { source: 'machine' },
	layout: PLAIN,
	...over
});
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
	expect(shownExample(sentence, media({ cues }))).toMatchObject({
		start: 3,
		end: 5,
		sentence: { text: cues[0].text, from: 0, to: 6, wordFrom: 3, wordTo: 5 }
	});
	expect(
		shownExample(sentence, media({ cues: [{ ...cues[0], text: 'different' }] }))
	).toBeUndefined();
});
// Issue #62: a video with "Edited by you" English gave its cards none at all.
it('shows the line as the reader edited it: joined, retimed, with its English', () => {
	const cues = [
		{ start: 10, end: 12, text: '我们走吧' },
		{ start: 12, end: 14, text: '去北京。' },
		{ start: 14, end: 15, text: '好的' }
	];
	const document = cues.map((cue) => cue.text).join('\n');
	// A drill card for 北京 on the document's second line (hardcore.ts drillSentence).
	const sentence: CardSentence = {
		source: 'reader',
		sourceTitle: 'Clip',
		sourceKey: 'r:6',
		available: true,
		documentId: 1,
		text: '去北京。',
		lineText: '去北京。',
		from: 5,
		to: 9,
		lineFrom: 5,
		wordFrom: 1,
		wordTo: 3,
		line: 1
	};
	const layout = {
		...PLAIN,
		joined: [1],
		shifts: [{ at: { line: 0, at: 0 }, ms: -300 }],
		english: [
			{ from: { line: 0, at: 0 }, to: { line: 2, at: 0 }, text: "Let's go to Beijing." },
			{ from: { line: 2, at: 0 }, to: { line: 3, at: 0 }, text: 'OK.' }
		]
	};
	const edited = shownExample(sentence, media({ cues, layout, english: { source: 'edited' } }))!;
	expect(edited.sentence.text).toBe('我们走吧\n去北京。');
	expect(edited.english).toBe("Let's go to Beijing.");
	expect([edited.start, edited.end]).toEqual([9.7, 13.7]);
	// A review records from + wordFrom as the word's place in the document.
	const { from, wordFrom, wordTo } = edited.sentence;
	expect([...document].slice(from + wordFrom, from + wordTo).join('')).toBe('北京');

	// Machine English on the same joined line: both lines' English.
	const machine = shownExample(
		sentence,
		media({ cues, layout, quick: ["Let's go", 'to Beijing.', 'OK.'] })
	)!;
	expect(machine.english).toBe("Let's go to Beijing.");
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
