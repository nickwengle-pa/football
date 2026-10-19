import { parsePiaaClassifications, slugify } from "./d6-feed-lib.mjs";

const CLASSES = new Set(["A", "AA", "AAA", "AAAA", "AAAAA", "AAAAAA"]);

export function validateClassificationCache(cache, { season, sourceUrl, now = new Date() }) {
  if (cache?.schemaVersion !== 1 || cache.season !== season || cache.sourceUrl !== sourceUrl) {
    throw new Error("Classification cache does not match the requested season and official source");
  }
  const checkedAt = Date.parse(cache.checkedAt);
  const month = now.toISOString().slice(0, 7);
  if (!Number.isFinite(checkedAt) || checkedAt > now.getTime()
      || !/^\d{4}-(0[1-9]|1[0-2])$/.test(cache.lastAttemptMonth ?? "")
      || cache.lastAttemptMonth < new Date(checkedAt).toISOString().slice(0, 7)
      || cache.lastAttemptMonth > month) {
    throw new Error("Classification cache has invalid check dates");
  }
  const minimumTeams = season === 2026 ? 40 : 35;
  const minimumClasses = season === 2026 ? 6 : 4;
  if (!Array.isArray(cache.teams) || cache.teams.length < minimumTeams
      || cache.teams.some(team => !team || !team.name || !team.sourceName || team.id !== slugify(team.name)
        || team.district !== 6 || !CLASSES.has(team.cls))
      || new Set(cache.teams.map(team => team.id)).size !== cache.teams.length
      || new Set(cache.teams.map(team => team.cls)).size < minimumClasses) {
    throw new Error("Classification cache is incomplete or contains invalid teams");
  }
  return cache;
}

// Only the first scheduled refresh each UTC month contacts PIAA. Failed monthly
// checks keep the previous classifications and do not block fresh scores.
export async function refreshClassificationCache({ cache, season, sourceUrl, fetchText, now = new Date(), force = false, allowShrink = false }) {
  const context = { season, sourceUrl, now };
  if (cache) validateClassificationCache(cache, context);
  const month = now.toISOString().slice(0, 7);
  if (cache && !force && cache.lastAttemptMonth === month) return { cache };
  try {
    const teams = parsePiaaClassifications(await fetchText(sourceUrl));
    const updated = validateClassificationCache({
      schemaVersion: 1,
      season,
      sourceUrl,
      checkedAt: now.toISOString(),
      lastAttemptMonth: month,
      teams
    }, context);
    if (cache && !allowShrink && updated.teams.length < cache.teams.length) {
      throw new Error(`Refusing classification shrink: ${cache.teams.length} -> ${updated.teams.length}`);
    }
    return { cache: updated };
  } catch (error) {
    if (!cache) throw new Error(`No saved classifications are available: ${error.message}`, { cause: error });
    return {
      cache: { ...cache, lastAttemptMonth: month },
      warning: `Monthly PIAA classifications check failed: ${error.message}. Keeping classifications checked ${cache.checkedAt}; scores and rankings will still refresh.`
    };
  }
}
