import { Robot } from "@v5x/events";
import { createSnapshotLoader } from "./lib/fetch-snapshot.mjs";

const EVENT_SKU = "VE-V5-26-66512";
const SNAPSHOT_TTL_MS = 20_000;

let cachedSnapshot = null;
let cachedAt = 0;
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

  const sourceDiagnostics = [];
  const diagnosticFetch = async (input, init) => {
    const response = await fetch(input, init);
    const url = new URL(input);
    if (url.pathname.endsWith("/teams")) {
      const body = await response.clone().json().catch(() => null);
      const data = Array.isArray(body?.data) ? body.data : [];
      const meta = body?.meta && typeof body.meta === "object" ? body.meta : {};
      sourceDiagnostics.push({
        path:url.pathname,
        status:response.status,
        contentType:response.headers.get("content-type") || "",
        bodyType:Array.isArray(body) ? "array" : body === null ? "null" : typeof body,
        topLevelKeys:body && typeof body === "object" ? Object.keys(body) : [],
        dataType:Array.isArray(body?.data) ? "array" : typeof body?.data,
        dataCount:data.length,
        metaType:body?.meta === null ? "null" : Array.isArray(body?.meta) ? "array" : typeof body?.meta,
        metaKeys:Object.keys(meta),
        metaFieldTypes:Object.fromEntries(Object.entries(meta).map(([key,value]) => [key,value === null ? "null" : Array.isArray(value) ? "array" : typeof value])),
        firstItemKeys:data[0] && typeof data[0] === "object" ? Object.keys(data[0]) : [],
        firstItemFieldTypes:data[0] && typeof data[0] === "object" ? Object.fromEntries(Object.entries(data[0]).map(([key,value]) => [key,value === null ? "null" : Array.isArray(value) ? "array" : typeof value])) : {},
        firstItemGrade:data[0]?.grade ?? null,
        firstItemLocationFieldTypes:data[0]?.location && typeof data[0].location === "object" ? Object.fromEntries(Object.entries(data[0].location).map(([key,value]) => [key,value === null ? "null" : Array.isArray(value) ? "array" : typeof value])) : {},
        firstItemCoordinatesFieldTypes:data[0]?.location?.coordinates && typeof data[0].location.coordinates === "object" ? Object.fromEntries(Object.entries(data[0].location.coordinates).map(([key,value]) => [key,value === null ? "null" : Array.isArray(value) ? "array" : typeof value])) : {},
        invalidTeamRows:data.map((team,index) => {
          const issues=[];
          if(typeof team.id!=="number")issues.push("id");
          if(typeof team.number!=="string")issues.push("number");
          if(!team.program||typeof team.program!=="object"||typeof team.program.id!=="number"||typeof team.program.name!=="string")issues.push("program");
          for(const key of ["team_name","robot_name","organization"])if(team[key]!==undefined&&typeof team[key]!=="string")issues.push(key);
          if(team.registered!==undefined&&typeof team.registered!=="boolean")issues.push("registered");
          if(team.grade!==undefined&&!["College","High School","Middle School","Elementary School"].includes(team.grade))issues.push("grade");
          if(team.location!==undefined&&team.location!==null){
            if(typeof team.location!=="object"||Array.isArray(team.location))issues.push("location");
            else {
              for(const key of ["venue","address_1","city","country"])if(team.location[key]!==undefined&&typeof team.location[key]!=="string")issues.push("location."+key);
              for(const key of ["address_2","region","postcode"])if(team.location[key]!==undefined&&team.location[key]!==null&&typeof team.location[key]!=="string")issues.push("location."+key);
              if(team.location.coordinates!==undefined&&team.location.coordinates!==null){
                const coordinates=team.location.coordinates;
                if(typeof coordinates!=="object"||Array.isArray(coordinates))issues.push("location.coordinates");
                else for(const key of ["lat","lon"])if(coordinates[key]!==undefined&&coordinates[key]!==null&&typeof coordinates[key]!=="number")issues.push("location.coordinates."+key);
              }
            }
          }
          return issues.length?{index,issues}:null;
        }).filter(Boolean).slice(0,12),
        firstItemProgramType:data[0]?.program === null ? "null" : Array.isArray(data[0]?.program) ? "array" : typeof data[0]?.program,
        firstItemProgramKeys:data[0]?.program && typeof data[0].program === "object" ? Object.keys(data[0].program) : []
      });
    }
    return response;
  };
  const robot = new Robot({
    token,
    fetch:diagnosticFetch,
    retry:{maxAttempts:2,maxDelayMs:8_000}
  });

  inFlight = loadSnapshot(robot, EVENT_SKU);
  try {
    const snapshot = await inFlight;
    snapshot.sourceDiagnostics = sourceDiagnostics;
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
