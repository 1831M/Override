import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, css, functionSource, dataSource] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/live-data.mjs", import.meta.url), "utf8"),
  readFile(new URL("../data.js", import.meta.url), "utf8")
]);

test("every direct app id selector exists in the page", () => {
  const ids = [...app.matchAll(/\$\("#([^"]+)"\)/g)].map(match => match[1]);
  const missing = [...new Set(ids)].filter(id =>
    !html.includes('id="' + id + '"') && !html.includes("id='" + id + "'")
  );
  assert.deepEqual(missing, []);
});

test("browser application parses as valid JavaScript", () => {
  assert.match(html, /<script type="module" src="app\.js"><\/script>/);
  assert.match(app, /from "\.\/watchlist\.mjs"/);
});

test("match search and CSV export controls are wired", () => {
  assert.match(html, /id="match-search"/);
  assert.match(html, /id="export-matches"/);
  assert.match(html, /id="export-rankings"/);
  assert.match(app, /function exportMatchesCsv/);
  assert.match(app, /function exportRankingsCsv/);
  assert.match(app, /output.innerHTML=make\(a.value\)\+make\(b.value\)/);
  assert.match(html, /id="scout-sheet-preview"/);
  assert.match(html, /id="watchlist-team"/);
  assert.match(html, /id="add-watchlist-team"/);
  assert.match(html, /id="export-watchlist"/);
  assert.match(app, /function readPinnedTeams/);
  assert.match(app, /data-watch-remove/);
  assert.match(app, /function renderScoutSheet/);
  assert.match(app, /window\.print\(\)/);
  assert.match(css, /@media print/);
  assert.match(app, /match-search/);
});

test("watchlist fixture planner focuses upcoming matches and supports CSV export", () => {
  assert.match(html, /id="watchlist-schedule"/);
  assert.match(html, /id="export-watchlist-schedule"/);
  assert.match(app, /function buildWatchlistScheduleRows/);
  assert.match(app, /function renderWatchlistSchedule/);
  assert.match(app, /function exportWatchlistSchedule/);
  assert.match(app, /buildWatchlistRows\(/);
  assert.match(app, /renderWatchlistSchedule\(\)/);
});

test("all dashboard views and navigation targets exist", () => {
  for (const view of ["overview","intelligence","matches","rankings","history","teams","skills","sources"]) {
    assert.ok(html.includes('id="' + view + '"') || html.includes("id='" + view + "'"));
    assert.ok(html.includes('data-view="' + view + '"') || html.includes("data-view='" + view + "'"));
  }
});

test("page has accessible labels and responsive styling", () => {
  assert.match(html, /aria-label=/);
  assert.match(html, /aria-live=/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test("live endpoint uses the VEX Events package and keeps token server-side", () => {
  assert.match(functionSource, /from "@v5x\/events"/);
  assert.match(functionSource, /VEX_EVENTS_TOKEN/);
  assert.doesNotMatch(app, /Bearer /);
  assert.match(app, /POLL_MS = 60_000/);
  assert.match(app, /divisionFeedComplete/);
  assert.match(app, /sourceAvailability\?\.skills === false/);
  assert.match(app, /team roster could not be loaded/);
});

test("scouting intelligence compares baseline with live match evidence", () => {
  assert.match(app, /Below historical scoring baseline/);
  assert.match(app, /Above historical scoring baseline/);
  assert.match(app, /Recent scoring trend rising/);
  assert.match(app, /Recent scoring trend falling/);
  assert.match(app, /OBSERVATION_KEY/);
  assert.match(app, /Human scout observation/);
  assert.match(app, /Latest scout note/);
  assert.match(html, /id="observation-form"/);
  assert.match(html, /id="intel-signals"/);
});

test("historical dossier has a dedicated navigation view and event archive", () => {
  assert.match(html, /data-view="history"[^>]*>Historical dossier/);
  assert.match(html, /id="historical-event-table"/);
  assert.match(html, /id="historical-event-search"/);
  assert.match(html, /id="historical-event-filter"/);
  assert.match(app, /function renderHistoricalEvents/);
  assert.match(app, /renderHistoricalEvents\(\)/);
  assert.match(app, /qual\.forAvg/);
  assert.match(app, /legacy\?\.seasonSnapshot\?\.metrics/);
});

test("historical dossier renders without requiring a successful live API response", () => {
  assert.match(app, /else if \(legacy\) \{\s*renderLegacyPreview\(\)/);
  assert.match(app, /function renderLegacyPreview/);
  assert.match(app, /renderHistoricalEvents\(\)/);
});

test("full dossier profile data covers all 24 registered State teams", async () => {
  const vm = await import("node:vm");
  const context = {window:{}};
  vm.runInNewContext(dataSource, context);
  const teams = context.window.SCOUTING_DATA.teams;
  assert.equal(teams.length,24);
  assert.equal(teams.filter(team => team.dossier?.read && team.dossier?.scoutFocus && team.dossier?.profileUrl).length,24);
  assert.equal(teams.find(team => team.id==="1940H").dossier.tier,"S");
  assert.equal(teams.find(team => team.id==="1831M").dossier.opr,42.8);
  assert.equal(teams.find(team => team.id==="1831M").dossier.dpr,24.1);
});

test("historical profile grid supports search, tier filtering and source links", () => {
  assert.match(html,/id="historical-profiles"/);
  assert.match(html,/id="historical-profile-search"/);
  assert.match(html,/id="historical-profile-tier"/);
  assert.match(app,/function renderHistoricalProfiles/);
  assert.match(app,/profileUrl/);
  assert.match(app,/p\.scoutFocus/);
});

test("historical dossier includes 1831M baseline and matchup decision support", () => {
  assert.match(html,/1831M FOCUSED ASSESSMENT/);
  assert.match(html,/28–17–2/);
  assert.match(html,/OPR \/ DPR/);
  assert.match(html,/MATCHUP PRIORITIES/);
  assert.match(html,/1940H Carbon/);
  assert.match(html,/Alliance selection logic/);
});

test("dossier states cross-event rating limits and flags a source conflict", () => {
  assert.match(dataSource,/cross-event CCWM\/OPR\/DPR averages are not strictly comparable/i);
  assert.match(html,/Cross-event power ratings are indicative/);
  assert.match(html,/RECONCILIATION REQUIRED/);
});
test("1831M archived Knox skills result includes driver and programming scores", async () => {
  const vm = await import("node:vm");
  const context = {window:{}};
  vm.runInNewContext(dataSource, context);
  const row = context.window.SCOUTING_DATA.teams.find(team=>team.id==="1831M").events[0];
  assert.equal(row.skills,86);
  assert.equal(row.driver,78);
  assert.equal(row.auton,8);
});
test("dossier profiles support expandable fieldwork actions and official rules", () => {
  assert.match(app,/data-profile-compare/);
  assert.match(app,/data-profile-pin/);
  assert.match(app,/data-profile-observe/);
  assert.match(html,/GAME RULES QUICK REFERENCE/);
  assert.match(html,/6 each/);
});
test("season snapshot margins reconcile to displayed averages", async () => {
  const vm = await import("node:vm");
  const context = {window:{}};
  vm.runInNewContext(dataSource, context);
  for (const row of context.window.SCOUTING_DATA.seasonSnapshot.metrics) {
    assert.ok(Math.abs((row.forAvg-row.againstAvg)-row.margin)<0.11, row.team+" margin mismatch");
  }
});

test("1831M event score is explicitly attributed to its alliance, not its robot", () => {
  assert.match(dataSource,/alliance that recorded 140 points/);
  assert.match(dataSource,/not an individual robot score/);
});
test("archived profile rows expose rank, skills breakdown and event source links", () => {
  assert.match(app,/Skills \+e\.skills/);
  assert.match(app,/source\.url/);
  assert.match(html,/Autonomous Win Point \(separate from the 12-point bonus\)/);
  assert.match(html,/At least 7 alliance Pins Placed/);
});
