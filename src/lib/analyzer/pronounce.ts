/**
 * Pinyin for every character of a text, for showing above it (asked for 2026-09-27: the reader
 * reads pinyin more easily than characters).
 *
 * pinyin-pro reads a whole text at once, so a character's reading can follow the words around it
 * (银行 háng, 行走 xíng). It still gets some heteronyms wrong (长得 cháng, 还钱 hái, 跑得快 dé):
 * the open heteronym problem in docs/backlog.md. Derived and display-only: nothing is stored.
 * Loaded on first use, so opening a document never waits for it.
 */

let library: Promise<typeof import('pinyin-pro')> | undefined;

/** One reading per code point of `text`: pinyin with tone marks, '' where it is not Chinese. */
export async function readingsOf(text: string): Promise<string[]> {
	library ??= import('pinyin-pro');
	const { pinyin } = await library;
	return pinyin(text, { type: 'all' }).map((part) => (part.isZh ? part.pinyin : ''));
}
