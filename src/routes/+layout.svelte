<script>
	/**
	 * @typedef {Object} Props
	 * @property {import('svelte').Snippet} [children]
	 */

	/** @type {Props} */
	let { children } = $props();
</script>

<main>{@render children?.()}</main>

<style>
	main {
		max-width: 1024px;
		margin: 0 auto;
	}
</style>
