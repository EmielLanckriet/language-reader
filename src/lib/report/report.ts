/**
 * Reporting a problem or an idea as a GitHub issue, from the phone.
 *
 * The repository is public, so the report says how the app was running, never what was read: no
 * titles, no words, no event details. The reader sees every section before it is sent and can
 * untick any of them.
 *
 * The token lives in `localStorage`, like the running version (version.ts), and for the same
 * reason: a report is most wanted when the database cannot be opened.
 */

import type { Diagnostic } from '$lib/diagnostics/describe';
import type { RecentSession } from '$lib/storage/repository';

export const REPOSITORY = 'EmielLanckriet/language-reader';
/** GitHub refuses an issue body longer than this, and with it the whole report. */
export const BODY_LIMIT = 65_536;

export type Section = 'device' | 'screen' | 'failures' | 'session';

export interface ReportState {
	device: Record<string, string>;
	screen?: Record<string, string>;
	failures?: Diagnostic[];
	session?: RecentSession;
}

export interface ReportDraft {
	kind: 'problem' | 'idea';
	title: string;
	description: string;
	include: Record<Section, boolean>;
}

export interface Issue {
	title: string;
	body: string;
	labels: string[];
}

const HEADINGS: Record<Section, string> = {
	device: 'Build, device, storage',
	screen: 'Screen',
	failures: 'Recent failure records',
	session: 'Latest session'
};

/** The text of one section, or undefined when there is nothing to put in it. */
export function sectionText(section: Section, state: ReportState): string | undefined {
	switch (section) {
		case 'device':
			return table(state.device);
		case 'screen':
			return state.screen && table(state.screen);
		case 'failures':
			return state.failures?.length
				? state.failures.map((f) => `[${f.at}] ${f.kind}\n${f.detail}`).join('\n\n')
				: undefined;
		case 'session':
			return state.session && sessionText(state.session);
	}
}

function table(rows: Record<string, string>): string {
	return Object.entries(rows)
		.map(([key, value]) => `${key}: ${value}`)
		.join('\n');
}

/** Kinds and timings only: the word looked up and the event's detail say what was read. */
function sessionText(session: RecentSession): string {
	const start = Date.parse(session.startedAt);
	const shown = session.encounters.slice(-80);
	const lines = shown.map((e) => {
		const parts = [`+${((Date.parse(e.at) - start) / 1000).toFixed(1)} s`, e.kind];
		if (e.mediaMs !== undefined) parts.push(`media ${(e.mediaMs / 1000).toFixed(1)} s`);
		if (e.speed !== undefined) parts.push(`${e.speed}×`);
		if (e.textVisible !== undefined) parts.push(`text ${e.textVisible ? 'shown' : 'hidden'}`);
		return parts.join(' · ');
	});
	const skipped = session.encounters.length - shown.length;
	return [
		`${session.modality}, started ${session.startedAt}, ${session.encounters.length} events`,
		...(skipped > 0 ? [`(first ${skipped} left out)`] : []),
		...lines
	].join('\n');
}

export function issueFrom(draft: ReportDraft, state: ReportState): Issue {
	const head = draft.description.trim() || '(no description)';
	const sections = (Object.keys(HEADINGS) as Section[])
		.filter((section) => draft.include[section])
		.map((section) => [section, sectionText(section, state)] as const)
		.filter((entry): entry is readonly [Section, string] => entry[1] !== undefined);

	// Each section gets an equal share of what the description leaves, cut from its end: the
	// oldest events and failures matter least.
	const wrapper = (section: Section, text: string) =>
		`\n\n<details><summary>${HEADINGS[section]}</summary>\n\n\`\`\`\n${text}\n\`\`\`\n</details>`;
	const footer = '\n\n_Sent from the app._';
	const room = BODY_LIMIT - head.length - footer.length;
	const share = Math.floor(room / Math.max(sections.length, 1));
	const body =
		head +
		sections
			.map(([section, text]) => {
				const overhead = wrapper(section, '').length + '\n…cut'.length;
				return wrapper(
					section,
					text.length + overhead > share
						? `${text.slice(0, Math.max(share - overhead, 0))}\n…cut`
						: text
				);
			})
			.join('') +
		footer;

	return {
		title: draft.title.trim() || (draft.kind === 'problem' ? 'Problem' : 'Idea'),
		body: body.slice(0, BODY_LIMIT),
		labels: [draft.kind === 'problem' ? 'bug' : 'enhancement']
	};
}

const TOKEN_KEY = 'language-reader:github-token';

export function readToken(): string | null {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
}

export function keepToken(token: string | null): void {
	try {
		if (token) localStorage.setItem(TOKEN_KEY, token);
		else localStorage.removeItem(TOKEN_KEY);
	} catch {
		// No storage: the token has to be entered again next time, which the settings line shows.
	}
}

/** The new issue's address, or a sentence saying why GitHub would not take it. */
export async function sendIssue(
	token: string,
	issue: Issue
): Promise<{ url: string } | { problem: string }> {
	let response: Response;
	try {
		response = await fetch(`https://api.github.com/repos/${REPOSITORY}/issues`, {
			method: 'POST',
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${token}`,
				'X-GitHub-Api-Version': '2022-11-28'
			},
			body: JSON.stringify(issue)
		});
	} catch {
		return { problem: 'Could not reach GitHub. Are you online? Your report is still here.' };
	}
	if (response.ok) return { url: ((await response.json()) as { html_url: string }).html_url };
	if (response.status === 401)
		return { problem: 'GitHub did not accept the token: it may have expired. Replace it in More.' };
	if (response.status === 403 || response.status === 404)
		return {
			problem: `The token may not write issues on ${REPOSITORY} (GitHub said ${response.status}).`
		};
	return { problem: `GitHub said ${response.status}. Your report is still here.` };
}
