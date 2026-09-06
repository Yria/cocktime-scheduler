export interface ResourceLease<T> {
	readonly value: T;
	release(): void;
}

export interface PoolResource<T> {
	value: T;
	bytes: number;
	destroy(): void;
}

interface Entry<T> extends PoolResource<T> {
	refs: number;
	used: number;
}

/** A renderer-scoped cache. Only unreferenced entries may be evicted. */
export class TexturePool<T> {
	private readonly entries = new Map<string, Entry<T>>();
	private clock = 0;
	private bytes = 0;
	private disposed = false;
	private hits = 0;
	private misses = 0;
	private readonly maxBytes: number;
	private readonly maxEntries: number;

	constructor({ maxBytes = 64 * 1024 * 1024, maxEntries = 512 } = {}) {
		this.maxBytes = maxBytes;
		this.maxEntries = maxEntries;
	}

	acquire(key: string, create: () => PoolResource<T>): ResourceLease<T> {
		if (this.disposed) throw new Error("Board texture pool is disposed");
		let entry = this.entries.get(key);
		if (entry) this.hits++;
		else {
			const resource = create();
			entry = { ...resource, refs: 0, used: 0 };
			this.entries.set(key, entry);
			this.bytes += entry.bytes;
			this.misses++;
		}
		entry.refs++;
		entry.used = ++this.clock;
		this.trim();
		let released = false;
		return {
			value: entry.value,
			release: () => {
				if (released || this.disposed) return;
				released = true;
				entry.refs--;
				entry.used = ++this.clock;
				this.trim();
			},
		};
	}

	/** Read-only render snapshot; callers still acquire a lease after commit. */
	peek(key: string): T | undefined {
		return this.entries.get(key)?.value;
	}

	/** Useful after leaving a board; normal releases retain warm drag/ghost variants. */
	trim(allUnused = false): void {
		if (!allUnused && this.bytes <= this.maxBytes && this.entries.size <= this.maxEntries) return;
		const unused = [...this.entries].filter(([, entry]) => entry.refs === 0)
			.sort((a, b) => a[1].used - b[1].used);
		for (const [key, entry] of unused) {
			if (!allUnused && this.bytes <= this.maxBytes && this.entries.size <= this.maxEntries) break;
			this.entries.delete(key);
			this.bytes -= entry.bytes;
			entry.destroy();
		}
	}

	/** Final renderer teardown, unlike eviction, destroys even leased entries. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const entry of this.entries.values()) entry.destroy();
		this.entries.clear();
		this.bytes = 0;
	}

	get stats() {
		let references = 0;
		for (const entry of this.entries.values()) references += entry.refs;
		return { entries: this.entries.size, bytes: this.bytes, references, hits: this.hits, misses: this.misses };
	}
}

export interface PhotoAsset {
	readonly promise: Promise<HTMLImageElement | null>;
	image: HTMLImageElement | null;
}

/** CORS-safe decoded image ownership is separate from the generated GPU textures. */
export function createPhotoResource(url: string, createImage: () => HTMLImageElement = () => new Image()): PoolResource<PhotoAsset> {
	const image = createImage();
	let resolvePhoto: (value: HTMLImageElement | null) => void = () => {};
	const asset: PhotoAsset = {
		image: null,
		promise: new Promise<HTMLImageElement | null>((resolve) => { resolvePhoto = resolve; }),
	};
	let settled = false;
	const finish = (value: HTMLImageElement | null) => {
		if (settled) return;
		settled = true;
		asset.image = value;
		image.onload = null;
		image.onerror = null;
		resolvePhoto(value);
	};
	image.crossOrigin = "anonymous";
	image.decoding = "async";
	image.onload = () => {
		if (typeof image.decode === "function") void image.decode().then(() => finish(image), () => finish(null));
		else finish(image);
	};
	image.onerror = () => finish(null);
	image.src = url;
	return {
		value: asset,
		// Source photos are bounded by entry count; decoded dimensions are not known yet.
		bytes: 0,
		destroy: () => {
			finish(null);
			asset.image = null;
			image.onload = null;
			image.onerror = null;
			image.removeAttribute("src");
		},
	};
}
