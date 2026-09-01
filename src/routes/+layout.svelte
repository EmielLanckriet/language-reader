<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '$lib/ui/app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Reader</title>
</svelte:head>

<main>
	{@render children()}
</main>
