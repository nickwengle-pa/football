import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const htmlPath = resolve("heritage_conference_power_points_simulator_25_26v1.html");
const feedScriptPath = resolve("data/football-2026.js");
const feedJsonPath = resolve("data/football-2026.json");

test("standalone scripts compile and official-sync controls exist", async () => {
  const html = await readFile(htmlPath, "utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  assert.ok(scripts.length >= 2);
  scripts.forEach((script, index) => assert.doesNotThrow(() => new Function(script), `script ${index + 1}`));
  for (const id of ["seasonSelect", "btnSyncOfficial", "officialSyncStatus", "scenarioDateLabel"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /AAAAAA/);
  assert.match(html, /<script\s+src=["']data\/football-2026\.js["']><\/script>/);
  assert.match(html, /raw\.githubusercontent\.com\/nickwengle-pa\/football\/main\/data\/football-2026\.json/);
  assert.match(html, /importNormalized\(sample,true\)/);
  assert.match(html, /function validateOfficialFeed\(feed\)/);
  assert.match(html, /str\.replace\(\/&\/g,'\\\\u0026'\)/);
});

test("direct-file feed fallback is valid JavaScript with official games", async () => {
  const source = await readFile(feedScriptPath, "utf8");
  const jsonFeed = JSON.parse(await readFile(feedJsonPath, "utf8"));
  const browserGlobal = {};
  assert.doesNotThrow(() => new Function("window", source)(browserGlobal));
  assert.deepEqual(browserGlobal.D6_OFFICIAL_FEED, jsonFeed);
  assert.equal(browserGlobal.D6_OFFICIAL_FEED?.season, 2026);
  assert.equal(browserGlobal.D6_OFFICIAL_FEED?.validation?.officialDistrict6TeamCount, 40);
  assert.ok(browserGlobal.D6_OFFICIAL_FEED?.games?.length >= 26);
  assert.ok(browserGlobal.D6_OFFICIAL_FEED?.teams?.length >= 100);
  assert.equal(browserGlobal.D6_OFFICIAL_FEED?.teams?.find((team) => team.name === "Athens")?.recordProvisional, true);
  assert.equal(browserGlobal.D6_OFFICIAL_FEED?.sources?.scoreboardPosts?.[0]?.scoreLineCount, browserGlobal.D6_OFFICIAL_FEED?.sources?.scoreboardPosts?.[0]?.parsedGameCount);
});
