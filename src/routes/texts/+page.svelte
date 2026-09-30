<script lang="ts">
	import { resolve } from '$app/paths';
	import Library from '$lib/ui/Library.svelte';
</script>

<div class="section-heading">
	<h1>Texts</h1>
	<a class="add-link" href={resolve('/add')}>＋ Add</a>
</div>
<p class="subtitle">A few lines today. A little more understanding tomorrow.</p>

<Library kind="text">
	{#snippet empty()}
		<p class="empty">
			No texts yet. Paste Chinese text under <a href={resolve('/add')}>Add</a> to read it here.
		</p>
	{/snippet}
</Library>
