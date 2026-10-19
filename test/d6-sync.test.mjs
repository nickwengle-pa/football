import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { main } from "../scripts/sync-d6-data.mjs";

test("a later source failure preserves the monthly attempt and leaves feed artifacts unchanged", async () => {
  const folder = await mkdtemp(join(tmpdir(), "d6-refresh-"));
  try {
    const output = join(folder, "football.json");
    const scriptOutput = join(folder, "football.js");
    const classificationPath = join(folder, "classifications.json");
    const cache = JSON.parse(await readFile(new URL("../data/piaa-classifications-2026.json", import.meta.url), "utf8"));
    cache.checkedAt = "2026-09-01T06:00:00Z";
    cache.lastAttemptMonth = "2026-09";
    const oldFeed = '{"season":2026,"marker":"last good feed"}\n';
    const oldScript = 'window.D6_OFFICIAL_FEED={"marker":"last good feed"};\n';
    await Promise.all([writeFile(output, oldFeed), writeFile(scriptOutput, oldScript),
      writeFile(classificationPath, JSON.stringify(cache))]);
    let classificationRequests = 0;
    const requestText = async url => {
      if (url === cache.sourceUrl) { classificationRequests++; throw new Error("PIAA timeout"); }
      throw new Error("Score source unavailable");
    };
    const warnings = [];
    const options = { output, classificationPath, requestText, now: new Date("2026-10-01T06:00:00Z"),
      onWarning: message => warnings.push(message) };
    await assert.rejects(main(options), /Score source unavailable/);
    const attempted = JSON.parse(await readFile(classificationPath, "utf8"));
    assert.equal(attempted.lastAttemptMonth, "2026-10");
    assert.equal(attempted.checkedAt, cache.checkedAt);
    assert.deepEqual(attempted.teams, cache.teams);
    assert.equal(await readFile(output, "utf8"), oldFeed);
    assert.equal(await readFile(scriptOutput, "utf8"), oldScript);
    await assert.rejects(main({ ...options, now: new Date("2026-10-02T06:00:00Z") }), /Score source unavailable/);
    assert.equal(classificationRequests, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /PIAA timeout/);
  } finally {
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    assert.ok(basename(folder).startsWith("d6-refresh-"));
    await rm(folder, { recursive: true, force: true });
  }
});
