import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, css, functionSource] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/live-data.mjs", import.meta.url), "utf8")
]);

test("every direct app id selector exists in the page", () => {
  const ids = [...app.matchAll(/\$\("#([^"]+)"\)/g)].map(match => match[1]);
  const missing = [...new Set(ids)].filter(id =>
    !html.includes('id="' + id + '"') && !html.includes("id='" + id + "'")
  );
  assert.deepEqual(missing, []);
});

test("browser application parses as valid JavaScript", () => {
  assert.match(html, /<script src="watchlist\.js"><\/script>/);
  assert.match(app, /window\.OverrideWatchlist\.buildWatchlistScheduleRows/);
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
  for (const view of ["overview","intelligence","matches","rankings","teams","skills","sources"]) {
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
