<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	const tabs = [
		{ route: '/', href: resolve('/'), label: 'Videos', icon: '▶' },
		{ route: '/texts', href: resolve('/texts'), label: 'Texts', icon: '文' },
		{ route: '/cards', href: resolve('/cards'), label: 'Cards', icon: '▤' },
		{ route: '/add', href: resolve('/add'), label: 'Add', icon: '＋' },
		{ route: '/diagnostics', href: resolve('/diagnostics'), label: 'More', icon: '⋯' }
	];
</script>

<nav class="tabs" aria-label="Sections">
	{#each tabs as tab (tab.route)}
		<a href={tab.href} aria-current={page.route.id === tab.route ? 'page' : undefined}>
			<span class="icon" aria-hidden="true">{tab.icon}</span>
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
		background: var(--paper);
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
	}
	.icon {
		font-size: 1.25rem;
		line-height: 1;
	}
</style>
