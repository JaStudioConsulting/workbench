import test from "node:test";
import assert from "node:assert/strict";
import {
  _clearReadCacheForTesting,
  _readCacheSizeForTesting,
  clearReadCache,
  invalidateReadCache,
  readThroughCache,
} from "../src/lib/readCache.js";

test("read cache deduplicates concurrent callers", async () => {
  _clearReadCacheForTesting();
  let calls = 0;
  let release;
  const fetcher = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  const requests = Array.from({ length: 12 }, () => readThroughCache("dedupe", fetcher));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release("rows");
  assert.deepEqual(await Promise.all(requests), Array(12).fill("rows"));
});

test("read cache serves fresh values until TTL expiry", async () => {
  _clearReadCacheForTesting();
  let calls = 0;
  const fetcher = async () => ++calls;
  assert.equal(await readThroughCache("ttl", fetcher, { ttlMs: 15 }), 1);
  assert.equal(await readThroughCache("ttl", fetcher, { ttlMs: 15 }), 1);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(await readThroughCache("ttl", fetcher, { ttlMs: 15 }), 2);
});

test("read cache invalidates exact keys and prefixes", async () => {
  _clearReadCacheForTesting();
  let calls = 0;
  const fetcher = async () => ++calls;
  await readThroughCache("group:a", fetcher);
  await readThroughCache("group:b", fetcher);
  invalidateReadCache("group:a");
  assert.equal(await readThroughCache("group:a", fetcher), 3);
  assert.equal(await readThroughCache("group:b", fetcher), 2);
  invalidateReadCache("group:");
  assert.equal(await readThroughCache("group:b", fetcher), 4);
});

test("clearReadCache clears values and in-flight records", async () => {
  _clearReadCacheForTesting();
  await readThroughCache("cached", async () => "value");
  let release;
  const pending = readThroughCache("pending", () => new Promise((resolve) => { release = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  clearReadCache();
  assert.equal(_readCacheSizeForTesting(), 0);
  release("late");
  await pending;
  assert.equal(_readCacheSizeForTesting(), 0);
});

test("read cache evicts expired entries when writing a new key", async () => {
  _clearReadCacheForTesting();
  await readThroughCache("expired", async () => "old", { ttlMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await readThroughCache("fresh", async () => "new");
  assert.equal(_readCacheSizeForTesting(), 1);
});

test("read cache retries one 5xx once and returns the successful result", async () => {
  _clearReadCacheForTesting();
  let calls = 0;
  const result = await readThroughCache("retry-5xx", async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("server error"), { status: 503 });
    return "ok";
  }, { backoffMs: 0 });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("read cache does not retry 4xx errors or writes", async () => {
  _clearReadCacheForTesting();
  let calls = 0;
  await assert.rejects(readThroughCache("retry-4xx", async () => {
    calls += 1;
    throw Object.assign(new Error("bad request"), { status: 400 });
  }), /bad request/);
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(readThroughCache("write", async () => {
    calls += 1;
    throw Object.assign(new Error("write failed"), { status: 503 });
  }, { retry: false }), /write failed/);
  assert.equal(calls, 1);
});
