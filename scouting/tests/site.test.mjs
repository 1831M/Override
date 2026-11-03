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
  const missing = [...new Set(ids)].filter(id => !new RegExp('id=["\\\\\\']' + id + '["\\\\\\']').test(html));
  assert.deepEqual(missing, []);
});

test("all six dashboard views and navigation targets exist", () => {
  for (const view of ["overview","matches","rankings","teams","skills","sources"]) {
    assert.match(html, new RegExp('id=["\\\\\\']' + view + '["\\\\\\']'));
    assert.match(html, new RegExp('data-view=["\\\\\\']' + view + '["\\\\\\']'));
  }
});

test("page has accessible labels and responsive styling", () => {
  assert.match(html, /aria-label=/);
  assert.match(html, /aria-live=/);
  assert.match(css, /@media\\(max-width:700px\\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test("live endpoint uses the VEX Events package and keeps token server-side", () => {
  assert.match(functionSource, /from "@v5x\\/events"/);
  assert.match(functionSource, /VEX_EVENTS_TOKEN/);
  assert.doesNotMatch(app, /VEX_EVENTS_TOKEN/);
  assert.match(app, /POLL_MS = 60_000/);
});
