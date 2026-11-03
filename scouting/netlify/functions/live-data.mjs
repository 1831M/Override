import { Robot } from "@v5x/events";
import { summarizeEvent } from "./lib/analytics.mjs";

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

async function mapLimit(items, limit, task) {
  const output = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

async function getTeamHistory(robot, teams, seasonId) {
  const now = Date.now();
  const teamSignature = teams.map(team => team.id).sort((a,b) => a-b).join(",");
  if (historyCache && historyCache.signature === teamSignature && now - historyCachedAt < HISTORY_TTL_MS) {
    return historyCache;
  }

  const results = await mapLimit(teams, 3, async team => {
    try {
      const events = await robot.teams.events(
        team.id,
        { seasons: seasonId ? [seasonId] : [], includeCancelled: false },
        { maxPages: 3 }
      );
      return {
        number: String(team.number),
        events: events.map(event => ({
          id:event.id, sku:event.sku, name:event.name,
          start:event.start || null, end:event.end || null,
          url:"https://events.vex.com/" + event.sku + ".html"
        })).sort((a,b) => String(a.start || "").localeCompare(String(b.start || ""))),
        checked:true
      };
    } catch (error) {
      console.warn("Team event history unavailable for", team.number, error?.message || error);
      return { number:String(team.number), events:[], checked:false };
    }
  });

  const byTeam = Object.fromEntries(results.map(row => [row.number, row.events]));
  const uncheckedTeams = results.filter(row => !row.checked).map(row => row.number);
  historyCache = { signature:teamSignature, byTeam, uncheckedTeams, checkedTeams:results.length - uncheckedTeams.length };
  historyCachedAt = now;
  return historyCache;
}

async function buildSnapshot(robot) {
  const event = await robot.events.getBySku(EVENT_SKU);
  if (!event) {
    const error = new Error("VEX Events could not find event " + EVENT_SKU);
    error.status = 404;
    throw error;
  }

  const errors = [];
  const collect = async (label, request) => {
    try { return await request; }
    catch (error) {
      errors.push({source:label,status:error?.status || null,message:error?.message || "Request failed"});
      console.warn("VEX feed source failed:", label, error?.message || error);
      return [];
    }
  };

  const [teams, skills, awards] = await Promise.all([
    collect("event teams", robot.events.teams(event.id)),
    collect("skills", robot.events.skills(event.id)),
    collect("awards", robot.events.awards(event.id))
  ]);

  const divisions = await mapLimit(event.divisions || [], 3, async division => {
    if (!Number.isInteger(division.id)) {
      errors.push({source:"division " + (division.name || "unknown"),status:null,message:"Division ID not supplied by VEX"});
      return {division,matches:[],rankings:[]};
    }
    const [matches, rankings] = await Promise.all([
      collect("matches · " + (division.name || division.id), robot.events.matches(event.id, division.id)),
      collect("rankings · " + (division.name || division.id), robot.events.rankings(event.id, division.id))
    ]);
    return {division,matches,rankings};
  });

  let history = {byTeam:{},uncheckedTeams:teams.map(t => String(t.number)),checkedTeams:0};
  if (teams.length && event.season?.id) {
    try { history = await getTeamHistory(robot, teams, event.season.id); }
    catch (error) {
      errors.push({source:"team season history",status:error?.status || null,message:error?.message || "Request failed"});
    }
  }

  const snapshot = summarizeEvent(event, teams, divisions, skills, awards, history.byTeam);
  snapshot.fetchedAt = new Date().toISOString();
  snapshot.seasonHistory = {
    checkedTeams:history.checkedTeams || 0,
    totalTeams:teams.length,
    uncheckedTeams:history.uncheckedTeams || [],
    eventCount:Object.values(history.byTeam || {}).reduce((sum, items) => sum + items.length, 0)
  };
  snapshot.sourceErrors = errors;
  snapshot.liveStatus = event.ongoing === true ? "in_progress" : "event_feed";
  return snapshot;
}

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

  inFlight = buildSnapshot(robot);
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
