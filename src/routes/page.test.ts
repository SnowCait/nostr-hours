// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { nip19 } from 'nostr-tools';
import type { Event } from 'nostr-typedef';

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (e: unknown) => void;
};

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

type Controls = {
	metadata: Deferred<Event | undefined>;
	events: Deferred<Event[]>;
	signals: (AbortSignal | undefined)[];
};

const controls = vi.hoisted(() => new Map<string, Controls>());
const fetchers = vi.hoisted(() => [] as { shutdown: ReturnType<typeof vi.fn> }[]);

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return { page: readable({ url: new URL('http://localhost/') }) };
});
vi.mock('nip07-awaiter', () => ({ waitNostr: async () => undefined }));
vi.mock('nostr-fetch', () => ({
	NostrFetcher: {
		init: () => {
			// Ignores abort signals on purpose to simulate stale responses arriving late
			const fetcher = {
				fetchLastEvent: async (
					_relays: string[],
					filter: { kinds: number[]; authors: string[] },
					options?: { signal?: AbortSignal }
				) => {
					const c = controls.get(filter.authors[0])!;
					c.signals.push(options?.signal);
					return filter.kinds[0] === 0 ? c.metadata.promise : undefined;
				},
				allEventsIterator: async function* (
					_relays: string[],
					filter: { authors: string[] },
					_timeRange: unknown,
					options?: { signal?: AbortSignal }
				) {
					const c = controls.get(filter.authors[0])!;
					c.signals.push(options?.signal);
					yield* await c.events.promise;
				},
				shutdown: vi.fn()
			};
			fetchers.push(fetcher);
			return fetcher;
		}
	}
}));

const { default: Page } = await import('./+page.svelte');

const pubkeyA = 'a'.repeat(64);
const pubkeyB = 'b'.repeat(64);

function register(pubkey: string): Controls {
	const c: Controls = { metadata: deferred(), events: deferred(), signals: [] };
	controls.set(pubkey, c);
	return c;
}

function makeEvent(pubkey: string, kind: number, content = ''): Event {
	return {
		id: Math.random().toString(16).slice(2).padEnd(64, '0'),
		pubkey,
		created_at: Math.floor(Date.now() / 1000) - 60,
		kind,
		tags: [],
		content,
		sig: '0'.repeat(128)
	};
}

async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	flushSync();
}

function setNpub(npub: string): void {
	const input = document.querySelector<HTMLInputElement>('input[aria-label="npub"]')!;
	input.value = npub;
	input.dispatchEvent(new window.Event('input'));
	flushSync();
}

function totalEventCount(): number {
	return [...document.querySelectorAll('tbody tr')]
		.map((row) => Number(row.lastElementChild?.textContent || 0))
		.reduce((a, b) => a + b, 0);
}

let component: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (component) {
		unmount(component);
		component = undefined;
	}
	controls.clear();
	fetchers.length = 0;
	document.body.innerHTML = '';
});

describe('switching accounts while fetching', () => {
	it('does not leak stale results of the previous account into the current state', async () => {
		const a = register(pubkeyA);
		const b = register(pubkeyB);
		component = mount(Page, { target: document.body });
		flushSync();
		document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
		flushSync();

		setNpub(nip19.npubEncode(pubkeyA));
		await settle();

		const npubB = nip19.npubEncode(pubkeyB);
		setNpub(npubB);
		await settle();

		b.metadata.resolve(makeEvent(pubkeyB, 0, JSON.stringify({ name: 'Bob' })));
		b.events.resolve([makeEvent(pubkeyB, 1), makeEvent(pubkeyB, 1)]);
		await settle();

		expect(document.querySelector('.profile-name')?.textContent).toBe('Bob');
		expect(totalEventCount()).toBe(2);
		expect(document.querySelector('.status')?.textContent).not.toContain('Loading');

		a.metadata.resolve(makeEvent(pubkeyA, 0, JSON.stringify({ name: 'Alice' })));
		a.events.resolve([makeEvent(pubkeyA, 1), makeEvent(pubkeyA, 1), makeEvent(pubkeyA, 1)]);
		await settle();

		expect(document.querySelector('.profile-name')?.textContent).toBe('Bob');
		expect(totalEventCount()).toBe(2);
		expect(document.querySelector('[role="alert"]')).toBeNull();
		expect(window.location.search).toBe(`?npub=${npubB}`);
		expect(a.signals.length).toBeGreaterThan(0);
		expect(a.signals.every((signal) => signal?.aborted)).toBe(true);
		expect(b.signals.every((signal) => signal !== undefined && !signal.aborted)).toBe(true);
		expect(fetchers.every((fetcher) => fetcher.shutdown.mock.calls.length > 0)).toBe(true);
	});

	it('keeps the current account loading when the previous account completes or fails', async () => {
		const a = register(pubkeyA);
		const b = register(pubkeyB);
		component = mount(Page, { target: document.body });
		flushSync();

		setNpub(nip19.npubEncode(pubkeyA));
		await settle();
		setNpub(nip19.npubEncode(pubkeyB));
		await settle();

		a.metadata.resolve(undefined);
		a.events.reject(new Error('relay failure for A'));
		await settle();

		expect(document.querySelector('.status')?.textContent).toContain('Loading events...');
		expect(document.querySelector('[role="alert"]')).toBeNull();

		b.metadata.resolve(undefined);
		b.events.resolve([]);
		await settle();

		expect(document.querySelector('.status')?.textContent).toContain('No events found');
	});

	it('does not mark the current account as done when the previous account completes', async () => {
		const a = register(pubkeyA);
		register(pubkeyB);
		component = mount(Page, { target: document.body });
		flushSync();

		setNpub(nip19.npubEncode(pubkeyA));
		await settle();
		setNpub(nip19.npubEncode(pubkeyB));
		await settle();

		a.metadata.resolve(undefined);
		a.events.resolve([]);
		await settle();

		expect(document.querySelector('.status')?.textContent).toContain('Loading events...');
		expect(document.querySelector('.status')?.textContent).not.toContain('No events found');
	});
});
