import test from "node:test";
import assert from "node:assert/strict";
import {
  applyScoreCorrections,
  buildFeed,
  canonicalizeTeamName,
  gameId,
  isPostseasonScoreboardPost,
  parseBlacklineRankings,
  parsePiaaClassifications,
  parseScoreboardPost
} from "../scripts/d6-feed-lib.mjs";

test("separates regular-season scoreboard posts from playoffs", () => {
  assert.equal(isPostseasonScoreboardPost({ title: { rendered: "2026 D6 Football Scoreboard Week 9" } }), false);
  assert.equal(isPostseasonScoreboardPost({ title: { rendered: "2026 D6 Football Scoreboard Week 10" } }), true);
  assert.equal(isPostseasonScoreboardPost({ title: { rendered: "District VI playoff scoreboard" } }), true);
  assert.equal(isPostseasonScoreboardPost({ title: { rendered: "PIAA State Football Semi-Final RESULTS" } }), true);
});

test("normalizes simulator aliases", () => {
  assert.equal(canonicalizeTeamName("Homer Center"), "Homer-Center");
  assert.equal(canonicalizeTeamName("Central (Martinsburg)"), "Central");
  assert.equal(canonicalizeTeamName("United"), "United Valley co-op [Blacklick Valley/United]");
});

test("parses all six PIAA classifications", () => {
  const html = `<table>
    <tr><th>School</th><th>Classification</th></tr>
    <tr><td>Bishop Guilfoyle Academy</td><td>A</td><td>82</td></tr>
    <tr><td>Altoona Area High School</td><td>AAAAAA</td><td>899</td></tr>
  </table>`;
  assert.deepEqual(parsePiaaClassifications(html).map(({ name, cls }) => ({ name, cls })), [
    { name: "Bishop Guilfoyle", cls: "A" },
    { name: "Altoona", cls: "AAAAAA" }
  ]);
});

test("parses Blackline ranking rows", () => {
  const html = `<h3>Updated: 08/31/2026 20:15</h3><table>
    <tr><td>AA</td><td>90</td><td>Marion Center</td><td>6</td><td>1</td><td>0</td><td>0</td><td>56</td><td>0</td><td>90</td><td></td></tr>
  </table>`;
  const report = parseBlacklineRankings(html);
  assert.equal(report.updatedAtLabel, "08/31/2026 20:15");
  assert.equal(report.rankings[0].wins, 1);
  assert.equal(report.rankings[0].cls, "AA");
});

test("parses scoreboard dates, records, scores, and deterministic ids", () => {
  const post = {
    id: 9980,
    link: "https://piaad6.org/example",
    content: { rendered: `<p><strong>08/28/2026</strong></p><ul>
      <li>Homer Center (Dist 6 A 1-0-0) 35 Northern Cambria (Dist 6 A 0-1-0) 28</li>
      <li>State College (Dist 6 AAAAAA 1-0-0) 35 Central York (Dist 3 AAAAAA 0-1-0) 28</li>
    </ul>` }
  };
  const games = parseScoreboardPost(post);
  assert.equal(games.length, 2);
  assert.equal(games[0].a, "Homer-Center");
  assert.equal(games[0].winner, "Homer-Center");
  assert.equal(games[0].date, "2026-08-28");
  assert.equal(games[0].id, gameId(2026, "2026-08-28", "Homer-Center", "Northern Cambria"));
});

test("applies confirmed score corrections regardless of team order", () => {
  const games = [{ id: "g1", a: "West Shamokin", b: "Northern Cambria", scoreA: 7, scoreB: 0, winner: "West Shamokin" }];
  const result = applyScoreCorrections(games, [
    { id: "g1", scores: { "Northern Cambria": 26, "West Shamokin": 14 }, note: "fix" },
    { id: "missing", scores: {} }
  ]);
  assert.deepEqual(result, { applied: ["g1"], unmatched: ["missing"] });
  assert.equal(games[0].scoreA, 14);
  assert.equal(games[0].scoreB, 26);
  assert.equal(games[0].winner, "Northern Cambria");
  assert.deepEqual(games[0].correction.original, { scoreA: 7, scoreB: 0, winner: "West Shamokin" });
});

test("reads Week 9 style \"Results 10/30/2026\" headings and a trailing period on a date", () => {
  const post = {
    id: 10544,
    content: { rendered: `<ul><li><strong>Results 10/30/2026</strong></li>
      <li><strong>Hollidaysburg (Dist 6 AAAAA 7-2-0) 51 DuBois (Dist 9 AAAAA 6-4-0) 14</strong></li>
      <li><strong>Results 10/29/2026</strong></li>
      <li><strong>Bishop McCort (Dist 6 A 7-3-0) 42 Bellefonte (Dist 6 AAAA 5-5-0) 16</strong></li>
      <li>10/22/2026.</li>
      <li>West Branch (Dist 6 A 3-6-0) 36 Glendale (Dist 6 A 4-5-0) 22</li></ul>` }
  };
  const games = parseScoreboardPost(post);
  assert.deepEqual(games.map(({ date, a, b }) => [date, a, b]), [
    ["2026-10-30", "Hollidaysburg", "DuBois"],
    ["2026-10-29", "Bishop McCort", "Bellefonte"],
    ["2026-10-22", "West Branch", "Glendale"]
  ]);
});

test("a score line posted twice does not count as an unparsed line", () => {
  const classes = ["A", "AA", "AAA", "AAAA"];
  const classifications = Array.from({ length: 36 }, (_, i) => ({ id: `team-${i}`, name: `Team ${i}`, cls: classes[i % 4], district: 6 }));
  const rankings = classifications.slice(0, 20).map((team) => ({ ...team, wins: 1, losses: 0, ties: 0, averagePoints: 10, rankingPoints: 10 }));
  const line = "West Branch (Dist 6 A 3-6-0) 36 Glendale (Dist 6 A 4-5-0) 22";
  const feed = buildFeed({
    season: 2025,
    generatedAt: "2025-10-26T00:00:00.000Z",
    classifications,
    rankingReport: { updatedAtLabel: null, rankings },
    posts: [{ id: 1, date: "2025-10-25", title: { rendered: "2025 D6 Football Scoreboard Week 8" },
      content: { rendered: `<p>10/24/2025</p><ul><li>${line}</li><li>${line}</li></ul>` } }],
    sourceUrls: {}
  });
  assert.equal(feed.games.length, 1);
  assert.equal(feed.sources.scoreboardPosts[0].scoreLineCount, 1);
});
