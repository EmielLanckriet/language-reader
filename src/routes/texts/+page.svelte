<script lang="ts">
	import { resolve } from '$app/paths';
	import Library from '$lib/ui/Library.svelte';
</script>

<div class="section-heading">
	<h1>Texts</h1>
	<span class="links">
		<a class="add-link" href={resolve('/story')}>A story</a>
		<a class="add-link" href={resolve('/add')}>＋ Add</a>
	</span>
</div>
<p class="subtitle">A few lines today. A little more understanding tomorrow.</p>

<Library kind="text">
	{#snippet empty()}
		<p class="empty">
			No texts yet. Paste Chinese text under <a href={resolve('/add')}>Add</a> to read it here.
		</p>
	{/snippet}
</Library>

<style>
	.links {
		display: flex;
		gap: 0.75rem;
	}
</style>
