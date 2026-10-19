import test from "node:test";
import assert from "node:assert/strict";
import { fetchText } from "../scripts/d6-fetch.mjs";

const URL = "https://example.test/official-data";
const quiet = { wait: async () => {}, onRetry: () => {} };
const ok = (text = "official data") => ({ ok: true, text: async () => text });

test("retries network failures with fresh timeout signals and bounded backoff", async () => {
  const calls = [];
  const delays = [];
  const retries = [];
  const result = await fetchText(URL, {
    userAgent: "D6 test",
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      if (calls.length < 3) throw new TypeError("fetch failed");
      return ok();
    },
    wait: async (ms) => { delays.push(ms); },
    onRetry: (retry) => { retries.push(retry); }
  });
  assert.equal(result, "official data");
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map((call) => call.signal)).size, 3);
  assert.ok(calls.every((call) => call.signal instanceof AbortSignal && !call.signal.aborted));
  assert.ok(calls.every((call) => call.url === URL && call.headers["User-Agent"] === "D6 test"));
  assert.deepEqual(delays, [2_000, 4_000]);
  assert.deepEqual(retries.map(({ attempt, attempts, url }) => ({ attempt, attempts, url })), [
    { attempt: 1, attempts: 3, url: URL },
    { attempt: 2, attempts: 3, url: URL }
  ]);
});

test("stops after the configured attempts and reports the URL and underlying network cause", async () => {
  let calls = 0;
  const failure = new TypeError("fetch failed", { cause: Object.assign(new Error("connection timed out"), { code: "UND_ERR_CONNECT_TIMEOUT" }) });
  await assert.rejects(fetchText(URL, {
    ...quiet,
    fetchImpl: async () => { calls += 1; throw failure; }
  }), (error) => {
    assert.match(error.message, /https:\/\/example\.test\/official-data/);
    assert.match(error.message, /after 3 attempts/);
    assert.match(error.message, /connection timed out \(UND_ERR_CONNECT_TIMEOUT\)/);
    assert.equal(error.cause, failure);
    return true;
  });
  assert.equal(calls, 3);
});

for (const status of [408, 429, 500, 503]) {
  test(`retries HTTP ${status} and releases its response body`, async () => {
    let calls = 0;
    let cancelled = false;
    const text = await fetchText(URL, {
      ...quiet,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return { ok: false, status, body: { cancel: async () => { cancelled = true; } } };
        assert.equal(cancelled, true);
        return ok();
      }
    });
    assert.equal(text, "official data");
    assert.equal(calls, 2);
  });
}

test("does not retry a permanent HTTP failure", async () => {
  let calls = 0;
  await assert.rejects(fetchText(URL, {
    ...quiet,
    fetchImpl: async () => { calls += 1; return { ok: false, status: 404 }; },
    wait: async () => { assert.fail("Permanent HTTP failures must not wait or retry"); }
  }), /after 1 attempt: HTTP 404/);
  assert.equal(calls, 1);
});

test("retries timeouts that occur while reading the response body", async () => {
  let calls = 0;
  assert.equal(await fetchText(URL, {
    ...quiet,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return { ok: true, text: async () => { throw new DOMException("The operation timed out", "TimeoutError"); } };
      return ok("complete body");
    }
  }), "complete body");
  assert.equal(calls, 2);
});

test("never waits longer than thirty seconds between attempts", async () => {
  const delays = [];
  let calls = 0;
  await fetchText(URL, {
    retryDelayMs: 20_000,
    fetchImpl: async () => { calls += 1; if (calls < 3) throw new TypeError("fetch failed"); return ok(); },
    wait: async (ms) => { delays.push(ms); },
    onRetry: () => {}
  });
  assert.deepEqual(delays, [20_000, 30_000]);
});
