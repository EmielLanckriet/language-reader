<script lang="ts">
	import { safeguards, type Safeguards } from '$lib/backup/safeguards';

	/**
	 * One warning per unprotected state, each with one thing to do (FR-011); nothing when all is
	 * well. Checked on start, when the app comes back to the front, and every minute.
	 */
	let current = $state<Safeguards | null>(null);

	$effect(() => {
		const check = () => void safeguards().then((found) => (current = found));
		check();
		const onVisible = () => document.visibilityState === 'visible' && check();
		document.addEventListener('visibilitychange', onVisible);
		const timer = setInterval(check, 60_000);
		return () => {
			document.removeEventListener('visibilitychange', onVisible);
			clearInterval(timer);
		};
	});
</script>

{#if current}
	{#if !current.installed}
		<p class="notice warning" data-safeguard="installed">
			<strong>Reader is open in a browser tab</strong>, so the browser may delete its data without
			warning. Install it: Chrome menu → Add to Home screen → Install, then open it from its icon.
		</p>
	{:else if !current.persisted}
		<!-- Measured on the emulator: a home-screen shortcut opens standalone exactly like an
		     installed app, but storage protection is refused. So this is how a shortcut shows. -->
		<p class="notice warning" data-safeguard="persisted">
			<strong>Reader is a shortcut, not an installed app</strong>, so the browser may delete its
			data without warning. Remove the icon, then in Chrome use Add to Home screen → Install.
		</p>
	{/if}
	{#if current.copy === 'unreachable'}
		<p class="notice warning" data-safeguard="copy">
			<strong>Your work isn't being copied</strong>: Termux's reader service isn't running. Open
			Termux once, then come back.
		</p>
	{:else if current.copy === 'stale'}
		<p class="notice warning" data-safeguard="copy">
			<strong>Your latest marks haven't been copied yet.</strong> Open Termux once, then come back.
		</p>
	{/if}
{/if}
