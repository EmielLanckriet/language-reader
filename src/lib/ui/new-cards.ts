/** The daily new-word budget (ADR-0039): set in More, read by Cards. Kept per device. */
const KEY = 'reader.newCards';

export function readNewCards(): number {
	try {
		const kept = Number(localStorage.getItem(KEY));
		return Number.isInteger(kept) && kept >= 0 && localStorage.getItem(KEY) !== null ? kept : 10;
	} catch {
		return 10;
	}
}

export function keepNewCards(value: number) {
	try {
		localStorage.setItem(KEY, String(value));
	} catch {
		// The choice lasts for this visit.
	}
}
