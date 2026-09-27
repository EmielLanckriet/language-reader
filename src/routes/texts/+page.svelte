<script lang="ts">
	import { resolve } from '$app/paths';
	import Library from '$lib/ui/Library.svelte';
</script>

<h1>Texts</h1>

<Library kind="text">
	{#snippet empty()}
		<p class="empty">
			No texts yet. Paste Chinese text under <a href={resolve('/add')}>Add</a> to read it here.
		</p>
	{/snippet}
</Library>
