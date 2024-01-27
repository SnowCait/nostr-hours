<script lang="ts">
	import { NostrFetcher } from 'nostr-fetch';
	import { nip19 } from 'nostr-tools';
	import type { Event } from 'nostr-typedef';

	let npub = '';
	let events: Event[] = [];

	const defaultRelays = ['wss://relay.nostr.band/', 'wss://nos.lol/'];
	const days = 14;

	const now = new Date();
	const dates = Array.from({ length: days }, (_, i) => {
		const date = new Date(new Date().toLocaleDateString());
		date.setDate(now.getDate() - i);
		return date;
	});
	const hours = Array.from({ length: 24 }, (_, i) => i);

	$: if (npub.startsWith('npub1')) {
		console.log(npub);
		try {
			const { type, data: pubkey } = nip19.decode(npub);
			if (type === 'npub') {
				fetch(pubkey);
			}
		} catch (error) {}
	}

	async function fetch(pubkey: string): Promise<void> {
		const { waitNostr } = await import('nip07-awaiter');
		const nostr = await waitNostr(1000);
		const relaysResult = await nostr?.getRelays?.();
		const relays =
			relaysResult !== undefined
				? Object.entries(relaysResult).map(([relay]) => relay)
				: defaultRelays;

		const fetcher = NostrFetcher.init();
		const iterator = fetcher.allEventsIterator(
			relays,
			{ authors: [pubkey] },
			{ since: Math.floor(dates[0].getTime() / 1000) - days * 24 * 60 * 60 }
		);
		for await (const event of iterator) {
			console.log(event);
			events.push(event);
			events = events;
		}
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
</script>

<h1>Nostr hours</h1>
<p>How many hours do you spend in Nostr?</p>

<form on:submit|preventDefault>
	<input type="text" bind:value={npub} placeholder="npub1..." />
	<input type="button" on:click={inputNpub} value="from NIP-07" />
</form>

<table>
	<thead>
		<tr>
			<th></th>
			{#each hours as hour}
				<th>{hour}</th>
			{/each}
		</tr>
	</thead>
	<tbody>
		{#each dates as date}
			<tr>
				<td>{date.toLocaleDateString()}</td>
				{#each hours as hour}
					<td
						class:active={events.filter((event) => {
							const createdAt = event.created_at * 1000;
							return (
								date.getTime() + hour * 60 * 60 * 1000 <= createdAt &&
								createdAt < date.getTime() + (hour + 1) * 60 * 60 * 1000
							);
						}).length > 0}
					>
					</td>
				{/each}
			</tr>
		{/each}
	</tbody>
</table>

<style>
	* {
		text-align: center;
	}

	table {
		margin: 2rem auto;
	}

	th,
	td {
		width: 2rem;
		text-align: center;
	}

	td.active {
		background-color: purple;
	}
</style>
