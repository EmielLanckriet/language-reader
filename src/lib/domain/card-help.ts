/**
 * What a card gave besides the word before its grade (#37, ADR-0042).
 *
 * The reader often grades Hard when the example sentence got them there. These are facts for the
 * fit to weigh (#18), recorded on each review, not used by the memory model.
 */

/** Before Show answer, or after it. */
export type Face = 'front' | 'back';

export interface CardHelp {
	/** An example sentence was on the front. */
	sentenceShown: boolean;
	/** Each recording played, with the face it was first played on; `{}` when none was. */
	heard: { sentence?: Face; word?: Face };
}

export function heardOn(
	heard: CardHelp['heard'],
	recording: keyof CardHelp['heard'],
	revealed: boolean
): CardHelp['heard'] {
	return heard[recording] ? heard : { ...heard, [recording]: revealed ? 'back' : 'front' };
}
