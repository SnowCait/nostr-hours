<script lang="ts">
	let { children } = $props();
</script>

<main>{@render children?.()}</main>

<style>
	main {
		max-width: 1024px;
		margin: 0 auto;
	}
</style>
