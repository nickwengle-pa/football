import test from "node:test";
import assert from "node:assert/strict";
import {
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
