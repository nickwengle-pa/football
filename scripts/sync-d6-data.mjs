import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchText as fetchSourceText } from "./d6-fetch.mjs";
import { refreshClassificationCache } from "./d6-classifications.mjs";
import {
  buildFeed,
  parseBlacklineRankings
} from "./d6-feed-lib.mjs";

const SEASON = Number(process.env.D6_SEASON ?? new Date().getFullYear());
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, process.env.D6_OUTPUT ?? `data/football-${SEASON}.json`);
const CORRECTIONS = resolve(ROOT, `data/score-corrections-${SEASON}.json`);
const CLASSIFICATIONS = resolve(ROOT, `data/piaa-classifications-${SEASON}.json`);
const USER_AGENT = "Heritage-D6-Football-Simulator/2.0 (+https://github.com/nickwengle-pa/football)";
const URLS = {
  category: `https://piaad6.org/wp-json/wp/v2/categories?slug=${SEASON}-football-scoreboard`,
  classifications: "https://www.piaa.org/schools/classifications/sportDistrict.aspx?district=6&sportID=10",
  rankings: "https://sports.blkline.com/sports/reports/d6FootballRanking.action"
};

const fetchText = url => fetchSourceText(url, { userAgent: USER_AGENT });

async function fetchJson(url, requestText = fetchText) {
  return JSON.parse(await requestText(url));
}

async function loadPosts(requestText = fetchText) {
  const categories = await fetchJson(URLS.category, requestText);
  const category = Array.isArray(categories) ? categories[0] : null;
  if (!category?.id) throw new Error(`PIAA scoreboard category not found for ${SEASON}`);
  const postsUrl = `https://piaad6.org/wp-json/wp/v2/posts?categories=${category.id}&per_page=100&orderby=date&order=asc&_fields=id,date,modified,link,title,content`;
  const posts = await fetchJson(postsUrl, requestText);
  if (!Array.isArray(posts)) throw new Error("PIAA scoreboard posts response was not an array");
  return { posts, postsUrl };
}

export async function main({ output = OUTPUT, classificationPath = CLASSIFICATIONS, requestText = fetchText, now = new Date() } = {}) {
  const scriptOutput = output.toLowerCase().endsWith(".json") ? `${output.slice(0, -5)}.js` : `${output}.js`;
  let prior = null;
  try { prior = JSON.parse(await readFile(output, "utf8")); } catch {}
  let corrections = [];
  try { corrections = JSON.parse(await readFile(CORRECTIONS, "utf8")); } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`Could not read ${CORRECTIONS}: ${error.message}`);
  }
  let savedClassifications = null;
  try { savedClassifications = JSON.parse(await readFile(classificationPath, "utf8")); } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`Could not read ${classificationPath}: ${error.message}`);
  }
  const classificationResult = await refreshClassificationCache({
    cache: savedClassifications,
    season: SEASON,
    sourceUrl: URLS.classifications,
    fetchText: requestText,
    now,
    force: process.env.D6_FORCE_CLASSIFICATIONS === "1",
    allowShrink: process.env.D6_ALLOW_SOURCE_SHRINK === "1"
  });
  if (classificationResult.warning) process.stderr.write(`Warning: ${classificationResult.warning}\n`);
  const classificationCache = classificationResult.cache;
  // Persist the attempt before other sources run. On a later source failure,
  // the workflow commits only this checkpoint, retaining the old validated
  // classifications. New classes are saved only with a fully validated feed.
  if (savedClassifications && savedClassifications.lastAttemptMonth !== classificationCache.lastAttemptMonth) {
    await writeFile(classificationPath, `${JSON.stringify({ ...savedClassifications,
      lastAttemptMonth: classificationCache.lastAttemptMonth }, null, 2)}\n`, "utf8");
  }
  const [{ posts, postsUrl }, rankingsHtml] = await Promise.all([
    loadPosts(requestText),
    requestText(URLS.rankings)
  ]);
  const generatedAt = now.toISOString();
  const feed = buildFeed({
    season: SEASON,
    generatedAt,
    classifications: classificationCache.teams,
    rankingReport: parseBlacklineRankings(rankingsHtml),
    posts,
    corrections,
    sourceUrls: {
      scoreboard: postsUrl,
      classifications: URLS.classifications,
      rankings: URLS.rankings
    }
  });
  feed.sources.classificationsCheckedAt = classificationCache.checkedAt;
  const { unmatched } = feed.sources.scoreCorrections;
  if (unmatched.length) process.stdout.write(`Warning: score corrections with no matching game: ${unmatched.join(", ")}
`);
  const afterRegularSeason = now.getTime() >= Date.parse(`${SEASON}-11-02T13:00:00Z`);
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
  const cacheText = `${JSON.stringify(classificationCache, null, 2)}\n`;
  let priorJsonText = null;
  let priorScriptText = null;
  let priorCacheText = null;
  try { priorJsonText = await readFile(output, "utf8"); } catch {}
  try { priorScriptText = await readFile(scriptOutput, "utf8"); } catch {}
  try { priorCacheText = await readFile(classificationPath, "utf8"); } catch {}
  if (priorJsonText === jsonText && priorScriptText === scriptText && priorCacheText === cacheText) {
    process.stdout.write(`No source-data changes for ${SEASON}; keeping ${output} and ${scriptOutput}\n`);
    return;
  }
  await mkdir(dirname(output), { recursive: true });
  await Promise.all([
    writeFile(output, jsonText, "utf8"),
    writeFile(scriptOutput, scriptText, "utf8"),
    writeFile(classificationPath, cacheText, "utf8")
  ]);
  process.stdout.write(`Wrote ${outputFeed.teams.length} teams and ${outputFeed.games.length} games to ${output} and ${scriptOutput}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

