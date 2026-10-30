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
  parseScoreboardPost,
  readScoreboardPost
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

test("names the score lines a scoreboard post could not use", () => {
  const post = {
    id: 10434,
    title: { rendered: "2026 D6 Football Scoreboard Week 8" },
    content: { rendered: `<ul><li>Early (Dist 6 A 1-0-0) 7 Undated (Dist 6 A 0-1-0) 0</li></ul>
      <p>10/23/2026</p><ul>
      <li>Homer Center (Dist 6 A 1-0-0) 35 Northern Cambria (Dist 6 A 0-1-0) 28</li>
      <li>Homer-Center (Dist 6 A 1-0-0) 35 Northern Cambria (Dist 6 A 0-1-0) 28</li>
      <li>Penns Manor (Dist 6 A 5\u20133\u20130) 21 Purchase Line (Dist 6 A 2-6-0) 14</li>
    </ul>` }
  };
  const { games, scoreLineCount, unparsedLines } = readScoreboardPost(post);
  assert.equal(scoreLineCount, 4);
  assert.equal(games.length, 1);
  assert.deepEqual(unparsedLines.map(({ reason }) => reason), ["before any date line", "repeats an earlier game", "does not match the score pattern"]);

  const classes = ["A", "AA", "AAA", "AAAA", "AAAAA", "AAAAAA"];
  const classifications = Array.from({ length: 40 }, (_, index) => ({ id: `team-${index}`, name: `Team ${index}`, sourceName: `Team ${index}`, cls: classes[index % 6], district: 6 }));
  const rankingReport = { updatedAtLabel: null, rankings: classifications.map((team) => ({ ...team, wins: 0, losses: 0, ties: 0 })) };
  assert.throws(() => buildFeed({ season: 2026, generatedAt: "", classifications, rankingReport, posts: [post], sourceUrls: {} }), (error) => {
    assert.match(error.message, /^Only 1 of 4 score lines parsed from scoreboard post 10434: 2026 D6 Football Scoreboard Week 8$/m);
    assert.ok(error.message.includes(String.raw`does not match the score pattern: "Penns Manor (Dist 6 A 5\u20133\u20130) 21 Purchase Line (Dist 6 A 2-6-0) 14"`), error.message);
    assert.ok(error.message.includes(`before any date line: "Early (Dist 6 A 1-0-0) 7 Undated (Dist 6 A 0-1-0) 0"`), error.message);
    return true;
  });
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
