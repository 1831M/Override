import { summarizeEvent } from "./analytics.mjs";

async function mapLimit(items, limit, task) {
  const output = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({length:Math.min(limit, items.length)}, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

export function createSnapshotLoader({historyTtlMs = 10 * 60_000, now = () => Date.now()} = {}) {
  let historyCache = null;
  let historyCachedAt = 0;

  async function getTeamHistory(robot, teams, seasonId) {
    const currentTime = now();
    const signature = teams.map(team => team.id).sort((a,b) => a-b).join(",");
    if (historyCache && historyCache.signature === signature && currentTime - historyCachedAt < historyTtlMs) {
      return historyCache;
    }

    const results = await mapLimit(teams, 3, async team => {
      try {
        const events = await robot.teams.events(
          team.id,
          {seasons:[seasonId],includeCancelled:false},
          {maxPages:3}
        );
        return {
          number:String(team.number),
          events:events.map(event => ({
            id:event.id,sku:event.sku,name:event.name,
            start:event.start || null,end:event.end || null,
            url:"https://events.vex.com/" + encodeURIComponent(event.sku) + ".html"
          })).sort((a,b) => String(a.start || "").localeCompare(String(b.start || ""))),
          checked:true
        };
      } catch (error) {
        return {number:String(team.number),events:[],checked:false,error};
      }
    });

    historyCache = {
      signature,
      byTeam:Object.fromEntries(results.map(row => [row.number,row.events])),
      uncheckedTeams:results.filter(row => !row.checked).map(row => row.number),
      checkedTeams:results.filter(row => row.checked).length
    };
    historyCachedAt = now();
    return historyCache;
  }

  return async function loadSnapshot(robot, eventSku) {
    const event = await robot.events.getBySku(eventSku);
    if (!event) {
      const error = new Error("VEX Events could not find event " + eventSku);
      error.status = 404;
      throw error;
    }

    const errors = [];
    const collect = async (label, request) => {
      try { return await request; }
      catch (error) {
        errors.push({source:label,status:error?.status || null,message:error?.message || "Request failed"});
        return [];
      }
    };

    const [teams,skills,awards] = await Promise.all([
      collect("event teams",robot.events.teams(event.id,{registered:true})),
      collect("skills",robot.events.skills(event.id)),
      collect("awards",robot.events.awards(event.id))
    ]);

    const divisions = await mapLimit(event.divisions || [],3,async division => {
      if (!Number.isInteger(division.id)) {
        errors.push({source:"division " + (division.name || "unknown"),status:null,message:"Division ID not supplied by VEX"});
        return {division,matches:[],rankings:[]};
      }
      const [matches,rankings] = await Promise.all([
        collect("matches · " + (division.name || division.id),robot.events.matches(event.id,division.id)),
        collect("rankings · " + (division.name || division.id),robot.events.rankings(event.id,division.id))
      ]);
      return {division,matches,rankings};
    });

    let history = {byTeam:{},uncheckedTeams:teams.map(team => String(team.number)),checkedTeams:0};
    if (teams.length && event.season?.id) {
      history = await getTeamHistory(robot,teams,event.season.id);
      for (const number of history.uncheckedTeams) {
        errors.push({source:"season history · " + number,status:null,message:"Team event history could not be checked"});
      }
    } else if (teams.length) {
      errors.push({source:"team season history",status:null,message:"The VEX event response did not include a season ID"});
    }

    const snapshot = summarizeEvent(event,teams,divisions,skills,awards,history.byTeam);
    snapshot.fetchedAt = new Date(now()).toISOString();
    snapshot.seasonHistory = {
      checkedTeams:history.checkedTeams || 0,
      totalTeams:teams.length,
      uncheckedTeams:history.uncheckedTeams || [],
      eventCount:Object.values(history.byTeam || {}).reduce((sum,items) => sum + items.length,0)
    };
    snapshot.sourceErrors = errors;
    snapshot.liveStatus = event.ongoing === true ? "in_progress" : "event_feed";
    return snapshot;
  };
}
