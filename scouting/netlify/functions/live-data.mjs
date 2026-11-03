import { Robot } from "@v5x/events";
import { createSnapshotLoader } from "./lib/fetch-snapshot.mjs";

const EVENT_SKU = "VE-V5-26-66512";
const SNAPSHOT_TTL_MS = 20_000;
const HISTORY_TTL_MS = 10 * 60_000;

let cachedSnapshot = null;
let cachedAt = 0;
let historyCache = null;
let historyCachedAt = 0;
let inFlight = null;

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
});

const loadSnapshot = createSnapshotLoader();

export default async function handler(request) {
  if (request.method !== "GET") return json({ok:false,code:"METHOD_NOT_ALLOWED"},405);

  const token = globalThis.Netlify?.env?.get?.("VEX_EVENTS_TOKEN") || process.env.VEX_EVENTS_TOKEN || "";
  if (!token.trim()) {
    return json({
      ok:false, code:"TOKEN_REQUIRED",
      message:"The VEX Events API connection is not configured yet. Add VEX_EVENTS_TOKEN as a secret Netlify environment variable with Functions scope."
    },503);
  }

  const now = Date.now();
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force && cachedSnapshot && now - cachedAt < SNAPSHOT_TTL_MS) {
    return json({ok:true,cached:true,snapshot:cachedSnapshot});
  }
  if (!force && inFlight) {
    try { return json({ok:true,cached:true,snapshot:await inFlight}); }
    catch {}
  }

  const robot = new Robot({
    token,
    retry:{maxAttempts:2,maxDelayMs:8_000}
  });

  inFlight = loadSnapshot(robot, EVENT_SKU);
  try {
    const snapshot = await inFlight;
    cachedSnapshot = snapshot;
    cachedAt = Date.now();
    return json({ok:true,cached:false,snapshot});
  } catch (error) {
    console.error("VEX Events refresh failed:", error?.status || "", error?.message || error);
    if (cachedSnapshot) {
      return json({ok:true,cached:true,stale:true,warning:"VEX Events is temporarily unavailable. Showing the last successful official snapshot.",snapshot:cachedSnapshot});
    }
    const status = Number.isInteger(error?.status) ? error.status : 502;
    return json({
      ok:false,code:status === 401 ? "VEX_AUTH_FAILED" : status === 404 ? "EVENT_NOT_FOUND" : "VEX_API_ERROR",
      message:status === 401
        ? "VEX Events rejected the API token. Check that the token is current and has API access."
        : error?.message || "The VEX Events API could not be reached.",
      source:"https://events.vex.com/api/v2"
    },status >= 400 && status < 600 ? status : 502);
  } finally {
    inFlight = null;
  }
}
