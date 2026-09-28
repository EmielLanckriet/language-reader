import { describe, it, expect } from 'vitest';
import { otherBrowser } from '../../src/lib/backup/safeguards';

// The user agents of the reader's phone: Chrome must pass, the old Samsung Internet copy must not.
describe('which browser this copy runs in', () => {
	it('names Samsung Internet and passes Chrome, headless included', () => {
		const samsung =
			'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36';
		const chrome =
			'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';
		const headless =
			'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/150.0.0.0 Safari/537.36';
		expect(otherBrowser(samsung)).toBe('Samsung Internet');
		expect(otherBrowser(chrome)).toBeNull();
		expect(otherBrowser(headless)).toBeNull();
	});
});
