# Heritage / District 6 Power Points Simulator

The root HTML file is a standalone simulator. Version 1.7 keeps the archived 2025 data, isolates calculations by season, supports all six PIAA football classes, persists browser edits, and can reconcile the current 2026 official feed.

## Official data refresh

`scripts/sync-d6-data.mjs` builds `data/football-2026.json` and its direct-file JavaScript fallback, `data/football-2026.js`, from:

- PIAA District 6's WordPress scoreboard posts for final scores.
- PIAA's official District 6 classification table for the 2026-27 classes.
- The District 6-linked Blackline ranking report for current records and ranking points.

Every parseable scoreboard result is used to refresh opponent records. Only games involving a District 6 team are added to the simulator schedule, so Week 0 contributes 26 D6 games while the page's other-district results improve PP win totals without polluting D6 standings.

The GitHub Actions workflow runs parser tests and performs four low-impact refresh checks per day from August through October, followed by final catch-up checks on November 1-2. It only commits the feed artifacts when source data changes. Week 10+ playoff posts are excluded, and any reviewed refresh after the final catch-up preserves the last pre-playoff Blackline records. The simulator preloads the JavaScript fallback so opening the HTML directly from disk works, checks both the raw GitHub and same-origin feeds, and applies the newest valid copy. It retains the last good local data when offline or when a source fails.

Run locally with Node 20 or newer:

```powershell
node --test --test-isolation=none
$env:D6_SEASON='2026'
node scripts/sync-d6-data.mjs
```

Node 20 on GitHub Actions can use `node --test` directly; `--test-isolation=none` avoids a Windows sandbox child-process restriction in the local Codex environment.

## Schedule source boundary

The official PIAA feed publishes results, not a complete future master schedule. The simulator therefore retains manual bulk/MaxPreps paste imports for future games and is ready for an official BOUND/CSV schedule adapter.

MaxPreps is intentionally not scraped. Its [Terms of Use](https://www.maxpreps.com/terms-of-use/) prohibit automated scraping, and its [partner documentation](https://support.maxpreps.com/hc/en-us/articles/202266384-Stat-Import-Partners) says it does not provide a general partner API. Add unattended MaxPreps access only after written authorization.
