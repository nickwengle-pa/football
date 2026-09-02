const VALID_CLASSES = new Set(["A", "AA", "AAA", "AAAA", "AAAAA", "AAAAAA"]);

export const TEAM_ALIASES = Object.freeze({
  "altoona area high school": "Altoona",
  "bald eagle area high school": "Bald Eagle Area",
  "bellefonte area high school": "Bellefonte",
  "bellwood antis high school": "Bellwood-Antis",
  "bishop guilfoyle academy": "Bishop Guilfoyle",
  "bishop mccort catholic high school": "Bishop McCort",
  "central high school martinsburg": "Central",
  "central martinsburg": "Central",
  "central (martinsburg)": "Central",
  "claysburg kimmel high school": "Claysburg-Kimmel",
  "forest hills senior high school": "Forest Hills",
  "greater johnstown high school": "Greater Johnstown",
  "h ollidaysburg": "Hollidaysburg",
  "hollidaysburg area senior high school": "Hollidaysburg",
  "johnstown": "Greater Johnstown",
  "homer center": "Homer-Center",
  "homer center high school": "Homer-Center",
  "homer-center senior high school": "Homer-Center",
  "huntingdon area high school": "Huntingdon",
  "marion center area high school": "Marion Center",
  "mount union area high school": "Mount Union",
  "northern bedford": "Northern Bedford County",
  "penns valley": "Penns Valley Area",
  "penns manor area high school": "Penns Manor",
  "penns valley area high school": "Penns Valley Area",
  "philipsburg osceola area high school": "Philipsburg-Osceola",
  "portage area": "Portage",
  "southern huntingdon": "Southern Huntingdon County",
  "southern huntingdon county high school/middle school": "Southern Huntingdon County",
  "southern huntingdon county senior high school": "Southern Huntingdon County",
  "state college area high school": "State College",
  "tyrone area high school": "Tyrone",
  "united": "United Valley co-op [Blacklick Valley/United]",
  "united high school": "United Valley co-op [Blacklick Valley/United]",
  "west branch area jr/sr high school": "West Branch",
  "west shamokin jr-sr high school": "West Shamokin"
});

export function decodeEntities(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function htmlToText(value) {
  return decodeEntities(String(value ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|li|div|h[1-6]|tr)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " "))
    .replace(/\r/g, "")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function canonicalizeTeamName(value) {
  const cleaned = htmlToText(value)
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  const key = cleaned
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (TEAM_ALIASES[key]) return TEAM_ALIASES[key];
  return cleaned
    .replace(/\s+High School$/i, "")
    .replace(/\s+Senior High School$/i, "")
    .replace(/\s+Area High School$/i, " Area")
    .trim();
}

export function slugify(value) {
  return canonicalizeTeamName(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function tableRows(html) {
  const rows = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(String(html ?? "")))) {
    const cells = [];
    const cellPattern = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[1]))) {
      cells.push(htmlToText(cellMatch[1]));
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

export function parsePiaaClassifications(html) {
  const teams = [];
  for (const cells of tableRows(html)) {
    const classIndex = cells.findIndex((cell, index) => index > 0 && VALID_CLASSES.has(cell));
    if (classIndex < 1) continue;
    const rawName = cells[classIndex - 1];
    if (!rawName || /school classifications/i.test(rawName)) continue;
    const name = canonicalizeTeamName(rawName);
    if (!name) continue;
    teams.push({
      id: slugify(name),
      name,
      sourceName: rawName,
      cls: cells[classIndex],
      district: 6
    });
  }
  return dedupeBy(teams, (team) => team.id);
}

export function parseBlacklineRankings(html) {
  const rankings = [];
  for (const cells of tableRows(html)) {
    if (cells.length < 10 || !VALID_CLASSES.has(cells[0])) continue;
    const district = Number.parseInt(cells[3], 10);
    const wins = Number.parseInt(cells[4], 10);
    const losses = Number.parseInt(cells[5], 10);
    const ties = Number.parseInt(cells[6], 10);
    if (![district, wins, losses, ties].every(Number.isFinite)) continue;
    const name = canonicalizeTeamName(cells[2]);
    rankings.push({
      id: slugify(name),
      name,
      cls: cells[0],
      averagePoints: numberOrNull(cells[1]),
      district,
      wins,
      losses,
      ties,
      averageScore: numberOrNull(cells[7]),
      averageAllowed: numberOrNull(cells[8]),
      rankingPoints: numberOrNull(cells[9])
    });
  }
  const updatedMatch = htmlToText(html).match(/Updated:\s*([^\n]+)/i);
  return {
    updatedAtLabel: updatedMatch ? updatedMatch[1].trim() : null,
    rankings: dedupeBy(rankings, (row) => row.id)
  };
}

export function parseScoreboardPost(post) {
  const text = htmlToText(post?.content?.rendered ?? post?.content ?? "");
  const lines = text.split("\n").map((line) => line.replace(/^\s*[.•]+\s*/, "").trim()).filter(Boolean);
  const games = [];
  let currentDate = "";
  for (const line of lines) {
    const dateMatch = line.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dateMatch) {
      currentDate = `${dateMatch[3]}-${dateMatch[1].padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}`;
      continue;
    }
    const parsed = parseScoreLine(line);
    if (!parsed || !currentDate) continue;
    const a = canonicalizeTeamName(parsed.a.name);
    const b = canonicalizeTeamName(parsed.b.name);
    const id = gameId(Number(currentDate.slice(0, 4)), currentDate, a, b);
    games.push({
      id,
      sourceGameId: id,
      season: Number(currentDate.slice(0, 4)),
      date: currentDate,
      a,
      b,
      scoreA: parsed.a.score,
      scoreB: parsed.b.score,
      winner: parsed.a.score === parsed.b.score ? "" : parsed.a.score > parsed.b.score ? a : b,
      status: "final",
      source: "piaa-d6-scoreboard",
      sourceUrl: post?.link ?? "",
      sourcePostId: post?.id ?? null,
      observedRecords: {
        [a]: parsed.a.record,
        [b]: parsed.b.record
      },
      observedTeams: {
        [a]: { district: parsed.a.district, cls: parsed.a.cls },
        [b]: { district: parsed.b.district, cls: parsed.b.cls }
      }
    });
  }
  return dedupeBy(games, (game) => game.id);
}

export function parseScoreLine(line) {
  const pattern = /^(.+?)\s+\(Dist\s+(\d+)\s+(A{1,6})\s+(\d+)-(\d+)-(\d+)\)\s+(\d+)\s+(.+?)\s+\(Dist\s+(\d+)\s+(A{1,6})\s+(\d+)-(\d+)-(\d+)\)\s+(\d+)(?:\s|$)/i;
  const match = String(line ?? "").replace(/\s+/g, " ").trim().match(pattern);
  if (!match) return null;
  const aClass = match[3].toUpperCase();
  const bClass = match[10].toUpperCase();
  if (!VALID_CLASSES.has(aClass) || !VALID_CLASSES.has(bClass)) return null;
  return {
    a: {
      name: match[1].trim(),
      district: Number(match[2]),
      cls: aClass,
      record: { wins: Number(match[4]), losses: Number(match[5]), ties: Number(match[6]) },
      score: Number(match[7])
    },
    b: {
      name: match[8].trim(),
      district: Number(match[9]),
      cls: bClass,
      record: { wins: Number(match[11]), losses: Number(match[12]), ties: Number(match[13]) },
      score: Number(match[14])
    }
  };
}

export function isPostseasonScoreboardPost(post) {
  const title = htmlToText(post?.title?.rendered ?? post?.title ?? "");
  const week = title.match(/\bweek\s+(\d+)\b/i);
  return /\bplayoffs?\b|\bpostseason\b|\bsemi[- ]?finals?\b|\bquarter[- ]?finals?\b|\bchampionship\b|\bstate\s+football\b/i.test(title) || (week && Number(week[1]) >= 10);
}

export function buildFeed({ season, generatedAt, classifications, rankingReport, posts, sourceUrls }) {
  const teamMap = new Map();
  const rankingTeamIds = new Set(rankingReport.rankings.map((team) => slugify(canonicalizeTeamName(team.name))));
  const putTeam = (incoming, precedence) => {
    if (!incoming?.name) return;
    const name = canonicalizeTeamName(incoming.name);
    const id = slugify(name);
    const existing = teamMap.get(id) ?? { id, name, aliases: [] };
    const next = { ...existing };
    if (!next.name) next.name = name;
    if (incoming.sourceName && incoming.sourceName !== name) {
      next.aliases = [...new Set([...(next.aliases ?? []), incoming.sourceName])];
    }
    for (const key of ["cls", "district", "wins", "losses", "ties", "rankingPoints", "averagePoints", "averageScore", "averageAllowed"]) {
      if (incoming[key] !== undefined && incoming[key] !== null) {
        const marker = `_${key}Precedence`;
        if ((next[marker] ?? -1) <= precedence) {
          next[key] = incoming[key];
          next[marker] = precedence;
        }
      }
    }
    teamMap.set(id, next);
  };

  for (const team of classifications) putTeam(team, 30);
  for (const ranking of rankingReport.rankings) putTeam(ranking, 20);

  const gameMap = new Map();
  const postCoverage = [];
  const regularSeasonCutoff = `${season}-10-31`;
  const orderedPosts = [...posts].filter((post) => !isPostseasonScoreboardPost(post)).sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
  for (const post of orderedPosts) {
    const postText = htmlToText(post?.content?.rendered ?? post?.content ?? "");
    const scoreLineCount = postText.split("\n").filter((line) => /\(Dist\s+\d+\s+A{1,6}\b/i.test(line)).length;
    const parsedPostGames = parseScoreboardPost(post);
    let district6GamesInPost = 0;
    for (const game of parsedPostGames) {
      if (game.date > regularSeasonCutoff) continue;
      const observed = game.observedTeams ?? {};
      const records = game.observedRecords ?? {};
      for (const name of [game.a, game.b]) {
        putTeam({ name, ...observed[name], ...(records[name] ?? {}) }, 10);
      }
      const isDistrict6Game = (observed[game.a]?.district === 6) || (observed[game.b]?.district === 6);
      if (!isDistrict6Game) continue;
      district6GamesInPost += 1;
      gameMap.set(game.id, game);
    }
    postCoverage.push({ id: post.id, title: htmlToText(post?.title?.rendered ?? post?.title ?? ""), scoreLineCount, parsedGameCount: parsedPostGames.length, district6GameCount: district6GamesInPost });
  }

  const teams = [...teamMap.values()].map((team) => {
    const cleaned = {};
    for (const [key, value] of Object.entries(team)) {
      if (!key.startsWith("_") && value !== undefined) cleaned[key] = value;
    }
    if (Number.isFinite(cleaned.wins)) {
      cleaned.recordSource = rankingTeamIds.has(cleaned.id) ? "blackline-rankings" : "piaa-scoreboard-observed";
      cleaned.recordProvisional = !rankingTeamIds.has(cleaned.id);
    }
    return cleaned;
  }).sort((a, b) => a.name.localeCompare(b.name));
  const games = [...gameMap.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  validateFeed({ season, classifications, rankingReport, posts: orderedPosts, postCoverage, teams, games });

  return {
    schemaVersion: 2,
    season,
    generatedAt,
    sourcePriority: ["piaa-d6-scoreboard", "piaa-classifications", "blackline-rankings"],
    sources: {
      scoreboard: sourceUrls.scoreboard,
      classifications: sourceUrls.classifications,
      rankings: sourceUrls.rankings,
      regularSeasonCutoff,
      rankingsUpdatedAt: rankingReport.updatedAtLabel,
      scoreboardPosts: orderedPosts.map((post) => {
        const coverage = postCoverage.find((item) => item.id === post.id);
        return { id: post.id, modified: post.modified, link: post.link, title: htmlToText(post?.title?.rendered ?? post?.title ?? ""), scoreLineCount: coverage?.scoreLineCount ?? 0, parsedGameCount: coverage?.parsedGameCount ?? 0, district6GameCount: coverage?.district6GameCount ?? 0 };
      })
    },
    teams,
    games,
    validation: {
      officialDistrict6TeamCount: classifications.length,
      rankingRowCount: rankingReport.rankings.length,
      scoreboardPostCount: orderedPosts.length,
      district6GameCount: games.length
    }
  };
}

export function gameId(season, date, a, b) {
  const pair = [slugify(a), slugify(b)].sort();
  return `${season}:${date}:${pair[0]}:${pair[1]}`;
}

function validateFeed({ season, classifications, rankingReport, posts, postCoverage, teams, games }) {
  if (!Number.isInteger(season) || season < 2020 || season > 2100) throw new Error("Invalid season");
  const baseline = season === 2026
    ? { classifications: 40, rankings: 40, games: 26, classes: 6 }
    : { classifications: 35, rankings: 20, games: 1, classes: 4 };
  if (classifications.length < baseline.classifications) throw new Error(`Classification coverage too low: ${classifications.length}`);
  if (rankingReport.rankings.length < baseline.rankings) throw new Error(`Ranking coverage too low: ${rankingReport.rankings.length}`);
  if (!posts.length) throw new Error("No scoreboard posts found");
  const emptyScoreboardPost = postCoverage.find((post) => post.district6GameCount < 1);
  if (emptyScoreboardPost) throw new Error(`No District 6 final scores parsed from scoreboard post ${emptyScoreboardPost.id}: ${emptyScoreboardPost.title}`);
  const partialScoreboardPost = postCoverage.find((post) => post.scoreLineCount > post.parsedGameCount);
  if (partialScoreboardPost) throw new Error(`Only ${partialScoreboardPost.parsedGameCount} of ${partialScoreboardPost.scoreLineCount} score lines parsed from scoreboard post ${partialScoreboardPost.id}: ${partialScoreboardPost.title}`);
  if (games.length < baseline.games) throw new Error(`District 6 game coverage too low: ${games.length}`);
  if (new Set(classifications.map((team) => team.cls)).size < baseline.classes) throw new Error("Classification coverage is missing one or more expected classes");
  if (new Set(classifications.map((team) => canonicalizeTeamName(team.name).toLowerCase())).size !== classifications.length) throw new Error("Duplicate classified teams");
  if (new Set(teams.map((team) => team.id)).size !== teams.length) throw new Error("Duplicate team ids");
  if (new Set(games.map((game) => game.id)).size !== games.length) throw new Error("Duplicate game ids");
  const badClass = teams.find((team) => team.cls && !VALID_CLASSES.has(team.cls));
  if (badClass) throw new Error(`Invalid class for ${badClass.name}: ${badClass.cls}`);
  const badGame = games.find((game) => Number(game.season) !== season
    || !/^\d{4}-\d{2}-\d{2}$/.test(game.date)
    || !game.a || !game.b || game.a === game.b
    || !Number.isFinite(game.scoreA) || !Number.isFinite(game.scoreB)
    || ![game.a, game.b].includes(game.winner)
    || game.status !== "final"
    || !game.sourceGameId);
  if (badGame) throw new Error(`Invalid final game row: ${badGame.id ?? "unknown"}`);
}

function dedupeBy(items, keyFn) {
  const map = new Map();
  for (const item of items) map.set(keyFn(item), item);
  return [...map.values()];
}

function numberOrNull(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
