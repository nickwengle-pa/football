import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { refreshClassificationCache, validateClassificationCache } from "../scripts/d6-classifications.mjs";

const saved = JSON.parse(await readFile(new URL("../data/piaa-classifications-2026.json", import.meta.url), "utf8"));
const sourceUrl = saved.sourceUrl;
const context = { season: 2026, sourceUrl };
const html = saved.teams.map(team => `<tr><td>${team.sourceName}</td><td>${team.cls}</td></tr>`).join("");
const at = value => new Date(value);
const cacheAt = value => ({ ...structuredClone(saved), checkedAt: value, lastAttemptMonth: value.slice(0, 7) });

test("saved classifications let regular score refreshes skip PIAA within the month", async () => {
  const cache = cacheAt("2026-10-01T06:00:00Z");
  const result = await refreshClassificationCache({ ...context, cache, now: at("2026-10-31T23:59:59Z"),
    fetchText: () => assert.fail("Daily refresh must not contact the classifications page") });
  assert.equal(result.cache, cache);
  assert.equal(result.warning, undefined);
});

test("the first refresh in a new month checks classes once and records source time", async () => {
  let requests = 0;
  const fetchText = async url => { requests++; assert.equal(url, sourceUrl); return html; };
  const first = await refreshClassificationCache({ ...context, cache: cacheAt("2026-10-19T01:06:26Z"),
    now: at("2026-11-01T06:00:00Z"), fetchText });
  assert.equal(first.cache.checkedAt, "2026-11-01T06:00:00.000Z");
  assert.equal(first.cache.lastAttemptMonth, "2026-11");
  assert.deepEqual(first.cache.teams.map(({ id, cls, district }) => ({ id, cls, district })),
    saved.teams.map(({ id, cls, district }) => ({ id, cls, district })));
  await refreshClassificationCache({ ...context, cache: first.cache, now: at("2026-11-15T06:00:00Z"), fetchText });
  assert.equal(requests, 1);
});

test("a failed monthly check keeps saved classes without repeated daily requests", async () => {
  const cache = cacheAt("2026-10-19T01:06:26Z");
  let requests = 0;
  const fetchText = async () => { requests++; throw new Error("PIAA timed out"); };
  const failed = await refreshClassificationCache({ ...context, cache, now: at("2026-11-01T06:00:00Z"), fetchText });
  assert.deepEqual(failed.cache.teams, cache.teams);
  assert.equal(failed.cache.checkedAt, cache.checkedAt);
  assert.equal(failed.cache.lastAttemptMonth, "2026-11");
  assert.match(failed.warning, /PIAA timed out/);
  assert.match(failed.warning, /scores and rankings will still refresh/);
  await refreshClassificationCache({ ...context, cache: failed.cache, now: at("2026-11-02T06:00:00Z"), fetchText });
  assert.equal(requests, 1);
});

test("manual override checks PIAA even after a monthly attempt", async () => {
  let requested = false;
  const result = await refreshClassificationCache({ ...context, cache: cacheAt("2026-10-01T06:00:00Z"),
    now: at("2026-10-19T06:00:00Z"), force: true,
    fetchText: async () => { requested = true; return html; } });
  assert.equal(requested, true);
  assert.equal(result.cache.checkedAt, "2026-10-19T06:00:00.000Z");
});

test("invalid PIAA content cannot replace validated saved classes", async () => {
  const cache = cacheAt("2026-10-01T06:00:00Z");
  const result = await refreshClassificationCache({ ...context, cache, now: at("2026-11-01T06:00:00Z"),
    fetchText: async () => "<html>Site maintenance</html>" });
  assert.deepEqual(result.cache.teams, cache.teams);
  assert.equal(result.cache.checkedAt, cache.checkedAt);
  assert.match(result.warning, /incomplete/);
});

test("monthly checks handle the December to January boundary", async () => {
  const result = await refreshClassificationCache({ ...context, cache: cacheAt("2026-12-15T06:00:00Z"),
    now: at("2027-01-01T06:00:00Z"), fetchText: async () => html });
  assert.equal(result.cache.lastAttemptMonth, "2027-01");
});

test("a new season cannot reuse the previous season's classes", async () => {
  await assert.rejects(refreshClassificationCache({ ...context, season: 2027, cache: saved,
    now: at("2027-01-01T06:00:00Z"), fetchText: () => assert.fail("Wrong-season cache must be rejected") }), /season/);
});

test("without a saved cache an unavailable or incomplete source fails closed", async () => {
  await assert.rejects(refreshClassificationCache({ ...context, cache: null, now: at("2026-11-01T06:00:00Z"),
    fetchText: async () => { throw new Error("PIAA offline"); } }), /No saved classifications.*PIAA offline/);
  await assert.rejects(refreshClassificationCache({ ...context, cache: null, now: at("2026-11-01T06:00:00Z"),
    fetchText: async () => "<html>Site maintenance</html>" }), /No saved classifications.*incomplete/);
});

test("the saved cache preserves the official classes and their source timestamp", async () => {
  const feed = JSON.parse(await readFile(new URL("../data/football-2026.json", import.meta.url), "utf8"));
  assert.ok(Date.parse(saved.checkedAt) <= Date.parse(feed.generatedAt));
  assert.equal(saved.teams.length, feed.validation.officialDistrict6TeamCount);
  for (const team of saved.teams) {
    const prior = feed.teams.find(candidate => candidate.id === team.id);
    assert.equal(team.cls, prior.cls);
    assert.equal(team.district, prior.district);
  }
  validateClassificationCache(saved, { ...context, now: at("2026-10-19T23:59:59Z") });
});

test("corrupt, duplicate, and future-dated caches are rejected", () => {
  const options = { ...context, now: at("2026-10-19T23:59:59Z") };
  assert.throws(() => validateClassificationCache({ ...saved, checkedAt: "invalid" }, options), /dates/);
  assert.throws(() => validateClassificationCache({ ...saved, checkedAt: "2027-01-01T00:00:00Z" }, options), /dates/);
  assert.throws(() => validateClassificationCache({ ...saved, teams: [...saved.teams, saved.teams[0]] }, options), /invalid teams/);
  assert.throws(() => validateClassificationCache({ ...saved, sourceUrl: "https://example.com" }, options), /source/);
});
