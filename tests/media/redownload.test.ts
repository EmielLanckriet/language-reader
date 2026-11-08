import { describe, it, expect } from 'vitest';
import { isVideo, videoAddress, waitingForVideo } from '../../src/lib/media/redownload';

describe('downloading a video again', () => {
	it('downloads from the page the video came from, or its YouTube id', () => {
		expect(videoAddress({ webpage_url: 'https://www.youtube.com/watch?v=Nw9MIybVWzE' })).toBe(
			'https://www.youtube.com/watch?v=Nw9MIybVWzE'
		);
		expect(videoAddress({ id: '-HqwDZFdxz8' })).toBe('https://www.youtube.com/watch?v=-HqwDZFdxz8');
	});

	it('offers nothing for what did not come from YouTube', () => {
		expect(videoAddress({ id: '', title: 'Story · 16/10/2026' })).toBeUndefined();
		expect(videoAddress({ webpage_url: 'https://example.com/x', id: 'a b' })).toBeUndefined();
	});

	it('tells a video from the sound alone, and a document waiting for one', () => {
		expect(isVideo(new File([], 'media.mp4'))).toBe(true);
		expect(isVideo(new File([], 'sound-only.m4a'))).toBe(false);
		expect(isVideo(undefined)).toBe(false);
		expect(waitingForVideo({ redownload: '2026-11-08T21:00:00Z' })).toBe(true);
		expect(waitingForVideo({})).toBe(false);
	});
});
