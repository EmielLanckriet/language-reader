import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The web app manifest is a contract with the device's installer, and one of its failure modes is
// invisible in development. The application is served from a project subpath in production
// (/language-reader/) and from the root locally, so an absolute "start_url": "/" works perfectly on
// this machine and installs an application that launches at the domain root and shows a missing
// page on the phone. FR-002 names that failure specifically.
//
// Relative members resolve against the manifest's own URL, so "./" is correct under any base path.
// That is the invariant here, and it is worth a test rather than a comment precisely because
// nothing local would ever catch it.

const manifest = JSON.parse(
	readFileSync(new URL('../../static/manifest.webmanifest', import.meta.url), 'utf-8')
);

function everyUrl(): Array<[string, string]> {
	const urls: Array<[string, string]> = [
		['start_url', manifest.start_url],
		['scope', manifest.scope]
	];
	for (const icon of manifest.icons)
		urls.push([`icons[${icon.sizes} ${icon.purpose}].src`, icon.src]);
	return urls;
}

describe('the web app manifest', () => {
	it('has no absolute URL anywhere in it (FR-002)', () => {
		const absolute = everyUrl().filter(([, url]) => url.startsWith('/'));
		expect(absolute).toEqual([]);
	});

	it('has no origin-qualified URL either', () => {
		// A full URL would also survive local testing and break under a different base path.
		const qualified = everyUrl().filter(([, url]) => /^[a-z]+:/i.test(url));
		expect(qualified).toEqual([]);
	});

	it('declares both icon sizes a device requires to offer installation (FR-003a)', () => {
		// Chrome will not fire its install prompt without these, so their absence would silently
		// disable the install offer rather than producing an error anyone would see.
		const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
		expect(sizes).toContain('192x192');
		expect(sizes).toContain('512x512');
	});

	it('declares a maskable icon, so Android does not box it in white (FR-003)', () => {
		const maskable = manifest.icons.filter(
			(icon: { purpose?: string }) => icon.purpose === 'maskable'
		);
		expect(maskable).toHaveLength(1);
	});

	it('opens in its own window (FR-001, SC-002)', () => {
		expect(manifest.display).toBe('standalone');
	});

	it('is identifiable on a home screen (FR-003)', () => {
		expect(manifest.name).toBeTruthy();
		expect(manifest.short_name).toBeTruthy();
		// Android truncates aggressively under an icon; anything longer is not what gets shown.
		expect(manifest.short_name.length).toBeLessThanOrEqual(12);
	});
});
