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
  assert.doesNotThrow(() => new Function(app));
});

test("all six dashboard views and navigation targets exist", () => {
  for (const view of ["overview","matches","rankings","teams","skills","sources"]) {
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
  assert.match(app, /sourceAvailability?\.skills === false/);
  assert.match(app, /team roster could not be loaded/);
});
