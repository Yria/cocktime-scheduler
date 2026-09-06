import { describe, expect, it, vi } from "vitest";
import { createPhotoResource, TexturePool } from "./texturePool";
import type { PhotoAsset } from "./texturePool";

const resource = (value: string, bytes = 4) => ({ value, bytes, destroy: vi.fn() });

describe("TexturePool", () => {
	it("shares a resource across normal/ghost/preview consumers and releases idempotently", () => {
		const pool = new TexturePool<string>();
		const a = resource("texture");
		const create = vi.fn(() => a);
		const first = pool.acquire("same", create);
		const second = pool.acquire("same", create);
		expect(first.value).toBe(second.value);
		expect(create).toHaveBeenCalledTimes(1);
		first.release();
		first.release();
		pool.trim(true);
		expect(a.destroy).not.toHaveBeenCalled();
		expect(pool.stats.references).toBe(1);
		second.release();
		pool.trim(true);
		expect(a.destroy).toHaveBeenCalledTimes(1);
	});

	it("evicts least recently unused entries, never a displayed texture", () => {
		const pool = new TexturePool<string>({ maxBytes: 8 });
		const resources = [resource("a"), resource("b"), resource("c")];
		const a = pool.acquire("a", () => resources[0]);
		pool.acquire("b", () => resources[1]).release();
		const c = pool.acquire("c", () => resources[2]);
		expect(resources[0].destroy).not.toHaveBeenCalled();
		expect(resources[1].destroy).toHaveBeenCalledOnce();
		expect(resources[2].destroy).not.toHaveBeenCalled();
		expect(pool.stats.bytes).toBe(8);
		a.release();
		c.release();
	});

	it("keeps warm variants until budget pressure and exceeds the budget for live leases", () => {
		const pool = new TexturePool<string>({ maxBytes: 4 });
		const a = resource("a");
		const b = resource("b");
		const leaseA = pool.acquire("a", () => a);
		const leaseB = pool.acquire("b", () => b);
		expect(pool.stats.bytes).toBe(8);
		expect(a.destroy).not.toHaveBeenCalled();
		leaseA.release();
		expect(a.destroy).toHaveBeenCalledOnce();
		leaseB.release();
		expect(b.destroy).not.toHaveBeenCalled();
	});

	it("tears down all generated resources once and tolerates late cleanup", () => {
		const pool = new TexturePool<string>();
		const a = resource("a");
		const lease = pool.acquire("a", () => a);
		pool.dispose();
		pool.dispose();
		lease.release();
		expect(a.destroy).toHaveBeenCalledOnce();
		expect(pool.stats.entries).toBe(0);
		expect(pool.stats.bytes).toBe(0);
		expect(() => pool.acquire("b", () => resource("b"))).toThrow("disposed");
	});

	it("does not retain a failed factory or prevent its retry", () => {
		const pool = new TexturePool<string>();
		expect(() => pool.acquire("a", () => { throw new Error("failed"); })).toThrow("failed");
		expect(pool.stats.entries).toBe(0);
		expect(pool.acquire("a", () => resource("ok")).value).toBe("ok");
	});
});

describe("createPhotoResource", () => {
	function fakeImage() {
		return { onload: null, onerror: null, src: "", crossOrigin: "", decoding: "", removeAttribute: vi.fn() } as unknown as HTMLImageElement;
	}

	it("sets anonymous CORS before loading and resolves a load only once", async () => {
		const image = fakeImage();
		const photo = createPhotoResource("photo.jpg?v=2", () => image);
		expect(image.crossOrigin).toBe("anonymous");
		expect(image.src).toBe("photo.jpg?v=2");
		image.onload?.call(image, new Event("load"));
		expect(photo.value.image).toBe(image);
		expect(await photo.value.promise).toBe(image);
		photo.destroy();
		expect(image.onload).toBeNull();
		expect(image.removeAttribute).toHaveBeenCalledWith("src");
	});

	it("settles an in-flight load on teardown and ignores its late completion", async () => {
		const image = fakeImage();
		const photo = createPhotoResource("photo.jpg", () => image);
		const lateLoad = image.onload;
		photo.destroy();
		lateLoad?.call(image, new Event("load"));
		expect(await photo.value.promise).toBeNull();
	});

	it("waits for decode and ignores a decode finishing after teardown", async () => {
		const image = fakeImage();
		let decoded: () => void = () => {};
		image.decode = () => new Promise<void>((resolve) => { decoded = resolve; });
		const photo = createPhotoResource("photo.jpg", () => image);
		image.onload?.call(image, new Event("load"));
		photo.destroy();
		decoded();
		expect(await photo.value.promise).toBeNull();
	});

	it("falls back to initials if decoding fails", async () => {
		const image = fakeImage();
		image.decode = () => Promise.reject(new Error("corrupt photo"));
		const photo = createPhotoResource("photo.jpg", () => image);
		image.onload?.call(image, new Event("load"));
		expect(await photo.value.promise).toBeNull();
	});

	it("keeps an image alive while another ghost still holds a lease", async () => {
		const image = fakeImage();
		const pool = new TexturePool<PhotoAsset>({ maxEntries: 0 });
		const first = pool.acquire("photo", () => createPhotoResource("photo", () => image));
		const second = pool.acquire("photo", () => { throw new Error("duplicate load"); });
		first.release();
		expect(image.removeAttribute).not.toHaveBeenCalled();
		image.onerror?.call(image, new Event("error"));
		expect(await second.value.promise).toBeNull();
		second.release();
		expect(image.removeAttribute).toHaveBeenCalledOnce();
	});

	it("exposes a warm decoded photo synchronously without acquiring during React render", () => {
		const image = fakeImage();
		const pool = new TexturePool<PhotoAsset>();
		const owner = pool.acquire("photo", () => createPhotoResource("photo", () => image));
		image.onload?.call(image, new Event("load"));
		const references = pool.stats.references;
		expect(pool.peek("photo")?.image).toBe(image);
		expect(pool.stats.references).toBe(references);
		const preview = pool.acquire("photo", () => { throw new Error("duplicate request"); });
		expect(preview.value.image).toBe(image);
		owner.release();
		preview.release();
		pool.dispose();
	});
});
