/**
 * The word list on Progress (issue #47): every word with a memory or a mark, searchable by
 * characters, pinyin or English, with the columns the reader chooses. Read only.
 */

import { recall, type Memory } from '$lib/domain/memory';
import { ANKI_LEVELS, RETRACTED } from '$lib/domain/state';
import type { FsrsParameters } from '$lib/domain/anki';
import type { WordListEntry } from '$lib/storage/repository';

export interface Gloss {
	pinyin: string;
	meaning: string;
}

/** Pinyin as typed: no tone marks or numbers, no spaces, lower case — shuǐ guǒ is shuiguo. */
export function searchKey(text: string): string {
	return text
		.normalize('NFD')
		.replace(/[\u0300-\u036f\s\d]/g, '')
		.toLowerCase();
}

/** Whether a word is what the reader searched for: its characters, pinyin or meaning. */
export function matches(form: string, gloss: Gloss | undefined, query: string): boolean {
	const typed = query.trim();
	if (typed === '') return true;
	if (form.includes(typed)) return true;
	if (!gloss) return false;
	const key = searchKey(typed);
	return (
		(key !== '' && searchKey(gloss.pinyin).includes(key)) ||
		gloss.meaning.toLowerCase().includes(typed.toLowerCase())
	);
}

const STATUS_LABELS = { active: 'Active', retired: 'Retired', ignored: 'Ignored' } as const;

/** Where the word stands with the deck: its status (spec 019). */
export function deckStatus(word: WordListEntry): string {
	return STATUS_LABELS[word.status];
}

const MARK_LABELS = new Map(ANKI_LEVELS.map((state) => [state.name, state.label]));

export function markLabel(mark: string | undefined): string {
	if (mark === undefined || mark === RETRACTED) return '';
	return MARK_LABELS.get(mark) ?? mark;
}

const DAY = 86_400_000;

/** A date as days from now: "today", "in 3 d", "5 d ago". */
export function fromNow(at: string, now: Date): string {
	const days = Math.round((new Date(at).getTime() - now.getTime()) / DAY);
	if (days === 0) return 'today';
	return days > 0 ? `in ${days} d` : `${-days} d ago`;
}

const days = (value: number) => (value < 10 ? `${value.toFixed(1)} d` : `${Math.round(value)} d`);

export interface Column {
	key: string;
	label: string;
	/** Width in rem: rows are a fixed grid, so the list can be windowed. */
	width: number;
	shown: (word: WordListEntry, gloss: Gloss | undefined, context: Context) => string;
	/** What the column sorts by; words without one go last either way. */
	sort: (
		word: WordListEntry,
		gloss: Gloss | undefined,
		context: Context
	) => number | string | undefined;
}

export interface Context {
	now: Date;
	parameters?: FsrsParameters;
}

const recallOf = (memory: Memory | undefined, context: Context) =>
	memory && recall(memory, context.now, context.parameters);

function memoryColumns(skill: 'reading' | 'listening', prefix: string): Column[] {
	const label = (name: string) => (prefix ? `${prefix} ${name.toLowerCase()}` : name);
	return [
		{
			key: `${skill}-due`,
			label: label('Due'),
			width: 5.5,
			shown: (w, _, c) => (w[skill] ? fromNow(w[skill].due, c.now) : ''),
			sort: (w) => w[skill]?.due
		},
		{
			key: `${skill}-stability`,
			label: label('Stability'),
			width: 5.5,
			shown: (w) => (w[skill] ? days(w[skill].stability) : ''),
			sort: (w) => w[skill]?.stability
		},
		{
			key: `${skill}-recall`,
			label: label('Recall'),
			width: 4.5,
			shown: (w, _, c) => {
				const chance = recallOf(w[skill], c);
				return chance === undefined ? '' : `${Math.round(chance * 100)} %`;
			},
			sort: (w, _, c) => recallOf(w[skill], c)
		}
	];
}

export const COLUMNS: Column[] = [
	{
		key: 'pinyin',
		label: 'Pinyin',
		width: 7,
		shown: (_, g) => g?.pinyin ?? '…',
		sort: (_, g) => (g ? searchKey(g.pinyin) : undefined)
	},
	{
		key: 'status',
		label: 'Deck',
		width: 6,
		shown: (w) => deckStatus(w),
		sort: (w) => deckStatus(w)
	},
	...memoryColumns('reading', ''),
	{
		key: 'meaning',
		label: 'Meaning',
		width: 12,
		shown: (_, g) => g?.meaning ?? '',
		sort: (_, g) => g?.meaning.toLowerCase()
	},
	{
		key: 'mark',
		label: 'Mark',
		width: 7,
		shown: (w) => markLabel(w.mark),
		sort: (w) => markLabel(w.mark) || undefined
	},
	{
		key: 'difficulty',
		label: 'Difficulty',
		width: 5,
		shown: (w) => (w.reading ? w.reading.difficulty.toFixed(1) : ''),
		sort: (w) => w.reading?.difficulty
	},
	{
		key: 'reps',
		label: 'Reviews',
		width: 4.5,
		shown: (w) => (w.reading ? String(w.reading.reps) : ''),
		sort: (w) => w.reading?.reps
	},
	{
		key: 'lapses',
		label: 'Lapses',
		width: 4.5,
		shown: (w) => (w.reading ? String(w.reading.lapses) : ''),
		sort: (w) => w.reading?.lapses
	},
	{
		key: 'last',
		label: 'Last seen',
		width: 5.5,
		shown: (w, _, c) => (w.reading ? fromNow(w.reading.lastAt, c.now) : ''),
		sort: (w) => w.reading?.lastAt
	},
	...memoryColumns('listening', 'Listening')
];

/** Due date, deck and pinyin: enough to find a word; the rest is one tap or a column away. */
export const DEFAULT_COLUMNS = ['pinyin', 'status', 'reading-due'];

/** Sorted by `column`, words without a value last in either direction. */
export function sortWords(
	words: readonly WordListEntry[],
	column: Column,
	descending: boolean,
	glosses: ReadonlyMap<number, Gloss>,
	context: Context
): WordListEntry[] {
	const keyed = words.map((word) => ({
		word,
		key: column.sort(word, glosses.get(word.id), context)
	}));
	keyed.sort((a, b) => {
		if (a.key === undefined || b.key === undefined)
			return a.key === undefined ? (b.key === undefined ? 0 : 1) : -1;
		const order = a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
		return descending ? -order : order;
	});
	return keyed.map((entry) => entry.word);
}
