import { describe, it, expect } from 'vitest';
import { filesOf, mediaOf, markOf } from '../../src/lib/backup/media-files';

// A video imported with downloaded tracks (spec 012), as 非诚勿扰 was on 2026-11-04.
const files = [
	{ name: 'meta.json', text: '{"id":"Hd6Z3paEZb8","job":"20261104-151149"}' },
	{ name: 'media.zh-CN.vtt', text: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n欢迎' },
	{ name: 'tracks.json', text: '[{"file":"track.en.vtt","lang":"en","kind":"human"}]' },
	{ name: 'track.zh-CN.vtt', text: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n欢迎' },
	{ name: 'track.en.vtt', text: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nWelcome' },
	{ name: 'english.json', text: '{"source":"track","file":"track.en.vtt"}' },
	// The reader's own work on the lines (layout.ts).
	{ name: 'layout.json', text: '{"joined":[1],"cuts":[],"offsetMs":-300,"shifts":[]}' },
	// Derived, or found again: never carried.
	{ name: 'media.en.vtt', text: 'WEBVTT' },
	{ name: 'quick-english.json', text: '[]' },
	{ name: 'title.en.json', text: '{}' }
];

describe("a copy of a video's files", () => {
	it('carries the downloaded tracks and the English chosen among them, and a restore writes them back', () => {
		const media = mediaOf(files)!;
		expect(media.subtitles.name).toBe('media.zh-CN.vtt');
		expect(media.meta).toEqual({ id: 'Hd6Z3paEZb8', job: '20261104-151149' });
		const written = filesOf(media);
		const wanted = [
			'english.json',
			'layout.json',
			'media.zh-CN.vtt',
			'meta.json',
			'track.en.vtt',
			'track.zh-CN.vtt',
			'tracks.json'
		];
		expect(written.map((f) => f.name).sort()).toEqual(wanted);
		for (const f of written) {
			const original = files.find((o) => o.name === f.name)!;
			expect(f.name === 'meta.json' ? JSON.parse(f.text) : f.text).toEqual(
				f.name === 'meta.json' ? JSON.parse(original.text) : original.text
			);
		}
	});

	it('is what it was before for a video without tracks', () => {
		const media = mediaOf(files.filter((f) => !/^track|tracks|english|layout/.test(f.name)))!;
		expect(Object.keys(media).sort()).toEqual(['meta', 'subtitles']);
		expect(filesOf(media).map((f) => f.name)).toEqual(['media.zh-CN.vtt', 'meta.json']);
	});

	it('has no media without subtitles', () => {
		expect(mediaOf([{ name: 'meta.json', text: '{}' }])).toBeUndefined();
	});

	it('marks a document changed when the reader picks other English, so an increment sends it', () => {
		const sized = (list: typeof files) =>
			list.map((f) => ({ name: f.name, size: f.text.length, lastModified: 1 }));
		const before = markOf(sized(files));
		const switched = files.map((f) =>
			f.name === 'english.json' ? { ...f, text: '{"source":"machine"}' } : f
		);
		expect(markOf(sized(switched))).not.toEqual(before);
		const retranslated = files.map((f) =>
			f.name === 'media.en.vtt' ? { ...f, text: 'WEBVTT\n\nmore' } : f
		);
		expect(markOf(sized(retranslated))).toEqual(before);
	});
});
