import { describe, it, expect, vi } from 'vitest';

// The browser's handle, standing in: the guard patches whatever prototype the global names.
class FakeDirectoryHandle {
	removed: string[] = [];
	async removeEntry(name: string) {
		this.removed.push(name);
	}
}

describe("the pool's directories", () => {
	it('cannot be removed in the storage worker; anything else can', async () => {
		vi.stubGlobal('FileSystemDirectoryHandle', FakeDirectoryHandle);
		vi.stubGlobal('DOMException', class extends Error {});
		const { guardPoolDirectory } = await import('../../src/lib/storage/pool-guard');
		guardPoolDirectory();

		const dir = new FakeDirectoryHandle();
		await expect(dir.removeEntry('.opaque')).rejects.toThrow(/refuses/);
		await expect(dir.removeEntry('.opfs-sahpool')).rejects.toThrow(/refuses/);
		await dir.removeEntry('42');
		expect(dir.removed).toEqual(['42']);
		vi.unstubAllGlobals();
	});
});
