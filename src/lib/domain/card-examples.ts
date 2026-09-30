/** Imported source facts, separate from a learner encountering or reviewing a word. */
export interface AnkiExample {
	key: string;
	profile: string;
	noteId: string;
	word: string;
	text: string;
	translation: string;
	pinyin: string;
	wordAudio?: string;
	sentenceAudio?: string;
	original: Record<string, string>;
}
export const AUDIO_NAME = /^[a-f0-9]{64}\.(mp3|m4a|ogg|wav|opus)$/;
export function checkedExample(value: unknown): AnkiExample {
	if (!value || typeof value !== 'object') throw new Error('Invalid Anki example.');
	const item = value as Record<string, unknown>;
	const text = (name: string, max = 20000) => {
		const v = item[name];
		if (typeof v !== 'string' || v.length > max) throw new Error(`Invalid example ${name}.`);
		return v;
	};
	const example: AnkiExample = {
		key: text('key', 1000),
		profile: text('profile', 200),
		noteId: text('noteId', 100),
		word: text('word', 100),
		text: text('text'),
		translation: text('translation'),
		pinyin: text('pinyin'),
		original: {}
	};
	if (!example.key || !example.word || !example.text.includes(example.word))
		throw new Error('The example does not contain its word.');
	for (const field of ['wordAudio', 'sentenceAudio'] as const) {
		if (item[field] !== undefined) {
			if (typeof item[field] !== 'string' || !AUDIO_NAME.test(item[field]))
				throw new Error('Invalid audio identity.');
			example[field] = item[field];
		}
	}
	if (!item.original || typeof item.original !== 'object' || Array.isArray(item.original))
		throw new Error('Missing original example fields.');
	const original = Object.entries(item.original);
	if (original.length > 20) throw new Error('Too many original fields.');
	for (const [key, v] of original) {
		if (typeof v !== 'string' || v.length > 100000 || key.length > 100)
			throw new Error('Invalid original field.');
		example.original[key] = v;
	}
	return example;
}
