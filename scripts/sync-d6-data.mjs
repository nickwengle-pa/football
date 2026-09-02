import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFeed,
  parseBlacklineRankings,
  parsePiaaClassifications
} from "./d6-feed-lib.mjs";

const SEASON = Number(process.env.D6_SEASON ?? new Date().getFullYear());
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, process.env.D6_OUTPUT ?? `data/football-${SEASON}.json`);
const SCRIPT_OUTPUT = OUTPUT.toLowerCase().endsWith(".json")
  ? `${OUTPUT.slice(0, -5)}.js`
  : `${OUTPUT}.js`;
const USER_AGENT = "Heritage-D6-Football-Simulator/2.0 (+https://github.com/nickwengle-pa/football)";
const URLS = {
  category: `https://piaad6.org/wp-json/wp/v2/categories?slug=${SEASON}-football-scoreboard`,
  classifications: "https://www.piaa.org/schools/classifications/sportDistrict.aspx?district=6&sportID=10",
  rankings: "https://sports.blkline.com/sports/reports/d6FootballRanking.action"
};

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { Accept: "text/html,application/xhtml+xml,application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

async function loadPosts() {
  const categories = await fetchJson(URLS.category);
  const category = Array.isArray(categories) ? categories[0] : null;
  if (!category?.id) throw new Error(`PIAA scoreboard category not found for ${SEASON}`);
  const postsUrl = `https://piaad6.org/wp-json/wp/v2/posts?categories=${category.id}&per_page=100&orderby=date&order=asc&_fields=id,date,modified,link,title,content`;
  const posts = await fetchJson(postsUrl);
  if (!Array.isArray(posts)) throw new Error("PIAA scoreboard posts response was not an array");
  return { posts, postsUrl };
}

async function main() {
  let prior = null;
  try { prior = JSON.parse(await readFile(OUTPUT, "utf8")); } catch {}
  const [{ posts, postsUrl }, classificationsHtml, rankingsHtml] = await Promise.all([
    loadPosts(),
    fetchText(URLS.classifications),
    fetchText(URLS.rankings)
  ]);
  const generatedAt = new Date().toISOString();
  const feed = buildFeed({
    season: SEASON,
    generatedAt,
    classifications: parsePiaaClassifications(classificationsHtml),
    rankingReport: parseBlacklineRankings(rankingsHtml),
    posts,
    sourceUrls: {
      scoreboard: postsUrl,
      classifications: URLS.classifications,
      rankings: URLS.rankings
    }
  });
  const afterRegularSeason = Date.now() >= Date.parse(`${SEASON}-11-02T13:00:00Z`);
  if (afterRegularSeason) {
    if (!prior?.teams?.length) throw new Error(`Cannot refresh ${SEASON} after the regular-season cutoff without a prior feed whose Blackline records can be frozen.`);
    const priorTeams = new Map(prior.teams.map((team) => [team.id, team]));
    const recordFields = ["wins", "losses", "ties", "rankingPoints", "averagePoints", "averageScore", "averageAllowed", "recordSource", "recordProvisional"];
    for (const team of feed.teams) {
      if (team.recordSource !== "blackline-rankings") continue;
      const previous = priorTeams.get(team.id);
      if (!previous) continue;
      for (const field of recordFields) {
        if (previous[field] === undefined) delete team[field];
        else team[field] = previous[field];
      }
    }
    feed.sources.rankingsUpdatedAt = prior.sources?.rankingsUpdatedAt ?? feed.sources.rankingsUpdatedAt;
    feed.sources.rankingsFrozenAt = prior.sources?.rankingsFrozenAt ?? prior.generatedAt;
  }
  if (prior?.season === SEASON && process.env.D6_ALLOW_SOURCE_SHRINK !== "1") {
    const checks = [
      ["officialDistrict6TeamCount", "classified teams"],
      ["rankingRowCount", "ranking rows"],
      ["scoreboardPostCount", "scoreboard posts"],
      ["district6GameCount", "District 6 games"]
    ];
    for (const [key, label] of checks) {
      const before = Number(prior.validation?.[key] ?? 0);
      const after = Number(feed.validation?.[key] ?? 0);
      if (before && after < before) {
        throw new Error(`Refusing source shrink for ${label}: ${before} -> ${after}. Review the source and set D6_ALLOW_SOURCE_SHRINK=1 only for a confirmed correction.`);
      }
    }
  }
  const sourceUnchanged = prior
    && JSON.stringify({ ...prior, generatedAt: null }) === JSON.stringify({ ...feed, generatedAt: null });
  const outputFeed = sourceUnchanged ? prior : feed;
  const jsonText = `${JSON.stringify(outputFeed, null, 2)}\n`;
  const scriptText = `window.D6_OFFICIAL_FEED=${JSON.stringify(outputFeed)};\n`;
  let priorJsonText = null;
  let priorScriptText = null;
  try { priorJsonText = await readFile(OUTPUT, "utf8"); } catch {}
  try { priorScriptText = await readFile(SCRIPT_OUTPUT, "utf8"); } catch {}
  if (priorJsonText === jsonText && priorScriptText === scriptText) {
    process.stdout.write(`No source-data changes for ${SEASON}; keeping ${OUTPUT} and ${SCRIPT_OUTPUT}\n`);
    return;
  }
  await mkdir(dirname(OUTPUT), { recursive: true });
  await Promise.all([
    writeFile(OUTPUT, jsonText, "utf8"),
    writeFile(SCRIPT_OUTPUT, scriptText, "utf8")
  ]);
  process.stdout.write(`Wrote ${outputFeed.teams.length} teams and ${outputFeed.games.length} games to ${OUTPUT} and ${SCRIPT_OUTPUT}\n`);
}

await main();
