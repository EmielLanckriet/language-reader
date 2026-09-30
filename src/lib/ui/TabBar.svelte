<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	const tabs = [
		{ route: '/', href: resolve('/'), label: 'Library', icon: 'M4 4h16v16H4z M10 8l6 4-6 4z' },
		{
			route: '/texts',
			href: resolve('/texts'),
			label: 'Texts',
			icon: 'M4 4h6a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H4z M13 7a3 3 0 0 1 3-3h4v14h-4a3 3 0 0 0-3 3'
		},
		{
			route: '/cards',
			href: resolve('/cards'),
			label: 'Cards',
			icon: 'M7 7h13v14H7z M4 17H2V2h14v2'
		},
		{
			route: '/progress',
			href: resolve('/progress'),
			label: 'Progress',
			icon: 'M4 20V12 M12 20V7 M20 20V3'
		},
		{
			route: '/diagnostics',
			href: resolve('/diagnostics'),
			label: 'More',
			icon: 'M5 11h1v1H5z M11 11h1v1h-1z M17 11h1v1h-1z'
		}
	];
</script>

<nav class="tabs" aria-label="Sections">
	{#each tabs as tab (tab.route)}
		<a
			href={tab.href}
			aria-current={page.route.id === tab.route ||
			(tab.route === '/cards' && page.route.id?.startsWith('/cards/'))
				? 'page'
				: undefined}
		>
			<svg
				class="icon"
				aria-hidden="true"
				viewBox="0 0 24 24"
				width="22"
				height="22"
				fill="none"
				stroke="currentColor"
				stroke-width="1.7"
				stroke-linejoin="round"
				stroke-linecap="round"><path d={tab.icon} /></svg
			>
			{tab.label}
		</a>
	{/each}
</nav>

<style>
	.tabs {
		position: fixed;
		inset: auto 0 0 0;
		z-index: 4;
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		background: var(--surface);
		border-top: 1px solid var(--rule);
		padding-bottom: env(safe-area-inset-bottom);
	}
	.tabs a {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.1rem;
		padding: 0.5rem 0 0.6rem;
		font-size: 0.8rem;
		color: var(--muted);
		text-decoration: none;
	}
	.tabs a[aria-current='page'] {
		color: var(--accent);
		font-weight: 600;
		background: var(--accent-soft);
	}
	.icon {
		font-size: 1.25rem;
		line-height: 1;
	}
</style>
