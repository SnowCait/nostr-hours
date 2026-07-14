<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<main>{@render children?.()}</main>

<style>
	main {
		max-width: 1024px;
		margin: 0 auto;
		padding: var(--space-2) var(--space-2) var(--space-3);
	}
</style>
