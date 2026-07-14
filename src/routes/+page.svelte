<script lang="ts">
	import { onMount } from 'svelte';
	import { NostrFetcher } from 'nostr-fetch';
	import { nip19 } from 'nostr-tools';
	import type { Content, Event, Nip07 } from 'nostr-typedef';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';

	let npub = $state('');
	let metadata: Content.Metadata | undefined = $state();
	let events: Event[] = $state.raw([]);
	let status: 'idle' | 'loading' | 'done' | 'error' = $state('idle');
	let errorMessage = $state('');

	const defaultRelays = ['wss://relay.nostr.band/', 'wss://nos.lol/'];
	const days = 14;
	let displayEventCount = $state(false);
	let displayGradation = $state(false);

	const now = new Date();
	const dates = Array.from({ length: days }, (_, i) => {
		const date = new Date(now.toDateString());
		date.setDate(now.getDate() - i);
		return date;
	});
	const hours = Array.from({ length: 24 }, (_, i) => i);

	onMount(() => {
		npub = $page.url.searchParams.get('npub') ?? '';
	});

	async function fetch(pubkey: string): Promise<void> {
		const { waitNostr } = await import('nip07-awaiter');
		const nostr = await waitNostr(1000);
		let relaysResultNIP07;
		try {
			relaysResultNIP07 = await nostr?.getRelays?.();
		} catch (error) {
			console.error(error);
		}
		const relaysWithNIP07 =
			relaysResultNIP07 !== undefined
				? [
						...new Set([
							...Object.entries(relaysResultNIP07).map(([relay]) => relay),
							...defaultRelays
						])
					]
				: defaultRelays;

		const relaysResultKind10002 = await getRelaysWithKind10002(relaysWithNIP07, pubkey);
		const relays =
			relaysResultKind10002 !== undefined
				? [
						...new Set([
							...Object.entries(relaysResultKind10002).map(([relay]) => relay),
							...relaysWithNIP07
						])
					]
				: relaysWithNIP07;

		const fetcher = NostrFetcher.init();
		fetcher.fetchLastEvent(relays, { kinds: [0], authors: [pubkey] }).then((event) => {
			if (event === undefined) {
				return;
			}
			try {
				metadata = JSON.parse(event.content);
			} catch (error) {
				console.warn('[failed to parse metadata]', error, event);
			}
		});
		const iterator = fetcher.allEventsIterator(
			relays,
			{ authors: [pubkey] },
			{
				since: Math.floor(dates[dates.length - 1].getTime() / 1000),
				until: Math.floor(dates[0].getTime() / 1000) + 1 * 24 * 60 * 60
			},
			{
				skipVerification: true
			}
		);
		for await (const event of iterator) {
			console.log(event);
			events = [...events, event];
		}
	}

	async function getRelaysWithKind10002(
		relays: string[],
		pubkey: string
	): Promise<Nip07.GetRelayResult | undefined> {
		const fetcher = NostrFetcher.init();
		const ev: Event | undefined = await fetcher.fetchLastEvent(relays, {
			kinds: [10002],
			authors: [pubkey]
		});
		if (ev === undefined) {
			return undefined;
		}
		const newRelays: Nip07.GetRelayResult = {};
		for (const tag of ev.tags.filter((tag) => tag.length >= 2 && tag[0] === 'r')) {
			newRelays[tag[1]] = {
				read: tag.length === 2 || tag[2] === 'read',
				write: tag.length === 2 || tag[2] === 'write'
			};
		}
		fetcher.shutdown();
		return newRelays;
	}

	async function inputNpub(): Promise<void> {
		const { waitNostr } = await import('nip07-awaiter');
		const nostr = await waitNostr(1000);
		if (nostr === undefined) {
			alert('Install NIP-07 browser extension');
			return;
		}
		const pubkey = await nostr.getPublicKey();
		npub = nip19.npubEncode(pubkey);
	}

	function heatColor(eventsCount: number): string {
		const maxEvents = 60;
		if (eventsCount === 0) {
			return 'transparent';
		}
		const alpha = displayGradation ? Math.min(eventsCount, maxEvents) / maxEvents : 1;
		return `rgb(var(--heat-rgb) / ${alpha.toFixed(2)})`;
	}

	function totalEventsForDate(index: number) {
		return eventsCountPerHour[index] ? eventsCountPerHour[index].reduce((a, b) => a + b, 0) : 0;
	}

	$effect(() => {
		if (npub.startsWith('npub1') && browser) {
			console.log(npub);
			try {
				const { type, data: pubkey } = nip19.decode(npub);
				if (type === 'npub') {
					metadata = undefined;
					events = [];
					status = 'loading';
					errorMessage = '';
					fetch(pubkey)
						.then(() => (status = 'done'))
						.catch((error) => {
							status = 'error';
							errorMessage = error instanceof Error ? error.message : 'Failed to fetch events.';
						});
					history.replaceState(history.state, '', `${$page.url.pathname}?npub=${npub}`);
				}
			} catch (error) {
				// Ignore partial input while typing
			}
		}
	});

	let eventsCountPerHour = $derived(
		dates.map((date) =>
			hours.map(
				(hour) =>
					events.filter((event) => {
						const createdAt = event.created_at * 1000;
						return (
							date.getTime() + hour * 60 * 60 * 1000 <= createdAt &&
							createdAt < date.getTime() + (hour + 1) * 60 * 60 * 1000
						);
					}).length
			)
		)
	);
</script>

<h1>Nostr hours</h1>
<p class="tagline">How many hours do you spend in Nostr?</p>

<form class="controls" onsubmit={(e) => e.preventDefault()}>
	<div class="npub-row">
		<input type="text" bind:value={npub} placeholder="npub1..." aria-label="npub" />
		<input type="button" onclick={inputNpub} value="from NIP-07" />
	</div>

	<div class="options-row">
		<label>
			<input type="checkbox" bind:checked={displayEventCount} />
			Display Event Count
		</label>

		<label>
			<input type="checkbox" bind:checked={displayGradation} />
			Display Gradation
		</label>
	</div>
</form>

{#if metadata !== undefined}
	<article class="profile">
		<img src={metadata.picture} alt="" />
		<div class="profile-name">{metadata.display_name ? metadata.display_name : metadata.name}</div>
	</article>
{/if}

{#if status === 'error'}
	<p class="message error" role="alert">Failed to load events: {errorMessage}</p>
{:else if status === 'loading'}
	<p class="message" aria-live="polite"><span class="spinner"></span> Loading events...</p>
{:else if status === 'done' && events.length === 0}
	<p class="message">No events found in the last {days} days.</p>
{/if}

{#if status !== 'idle'}
	<div class="table-scroll">
		<table>
			<thead>
				<tr>
					<th></th>
					{#each hours as hour}
						<th>{hour}</th>
					{/each}
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each dates as date, index}
					<tr>
						<td class="date day-{date.getDay()}">{date.toLocaleDateString()}</td>
						{#each hours as hour, hourIndex}
							<td
								class="heat"
								style:background-color={heatColor(eventsCountPerHour[index][hourIndex])}
							>
								{displayEventCount ? eventsCountPerHour[index][hourIndex] : ''}
							</td>
						{/each}
						<td>{displayEventCount ? totalEventsForDate(index) : ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	h1 {
		margin: var(--space-3) 0 0;
		text-align: center;
		color: var(--color-accent);
		letter-spacing: -0.02em;
	}

	.tagline {
		margin-top: var(--space-1);
		text-align: center;
		color: var(--color-text-muted);
	}

	.controls {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		max-width: 34rem;
		margin: var(--space-3) auto;
		padding: var(--space-2);
		background-color: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.npub-row {
		display: flex;
		gap: var(--space-1);
		width: 100%;
	}

	input[type='text'] {
		flex: 1;
		min-width: 0;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background-color: var(--color-bg);
		color: var(--color-text);
		font: inherit;
	}

	input[type='text']:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}

	input[type='button'] {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: var(--radius-sm);
		background-color: var(--color-accent);
		color: var(--color-accent-contrast);
		font: inherit;
		cursor: pointer;
		white-space: nowrap;
	}

	input[type='button']:hover {
		opacity: 0.85;
	}

	.options-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.options-row label {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		cursor: pointer;
	}

	input[type='checkbox'] {
		accent-color: var(--color-accent);
	}

	.profile {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		margin: var(--space-2) auto;
	}

	.profile img {
		width: 64px;
		height: 64px;
		object-fit: cover;
		border-radius: 50%;
		border: 2px solid var(--color-border);
	}

	.profile-name {
		font-weight: 600;
	}

	.message {
		text-align: center;
		color: var(--color-text-muted);
	}

	.error {
		max-width: 34rem;
		margin: var(--space-2) auto;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		background-color: var(--color-error-bg);
		color: var(--color-error-text);
	}

	.spinner {
		display: inline-block;
		width: 1em;
		height: 1em;
		vertical-align: -0.125em;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.table-scroll {
		overflow-x: auto;
		margin: var(--space-3) calc(-1 * var(--space-2)) 0;
		padding: 0 var(--space-2);
	}

	table {
		margin: 0 auto;
		border-collapse: separate;
		border-spacing: 2px;
	}

	th,
	td {
		min-width: 2rem;
		height: 1.6rem;
		text-align: center;
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
	}

	th {
		color: var(--color-text-muted);
		font-weight: 500;
	}

	td.heat {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	td.date {
		position: sticky;
		left: 0;
		z-index: 1;
		padding: 0 0.5rem;
		background-color: var(--color-bg);
		white-space: nowrap;
	}

	.day-0 {
		background-color: var(--color-weekend-sun);
	}

	.day-6 {
		background-color: var(--color-weekend-sat);
	}
</style>
