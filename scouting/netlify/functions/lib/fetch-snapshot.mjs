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
    const sourceAvailability = {teams:null,skills:null,awards:null,matches:{},rankings:{}};
    const collect = async (label, request, statusMap, statusKey) => {
      try {
        const value = await request;
        if (statusMap) statusMap[statusKey] = true;
        return value;
      } catch (error) {
        if (statusMap) statusMap[statusKey] = false;
        errors.push({source:label,status:error?.status || null,message:error?.message || "Request failed"});
        return [];
      }
    };

    let [teams,skills,awards] = await Promise.all([
      collect("event teams",robot.events.teams(event.id,{registered:true}),sourceAvailability,"teams"),
      collect("skills",robot.events.skills(event.id),sourceAvailability,"skills"),
      collect("awards",robot.events.awards(event.id),sourceAvailability,"awards")
    ]);

    const sourceRecoveries = [];
    if (!sourceAvailability.teams || teams.length === 0) {
      try {
        const searchedTeams = await robot.teams.search({events:[event.id],registered:true});
        if (searchedTeams.length > 0) {
          teams = searchedTeams;
          sourceAvailability.teams = true;
          sourceRecoveries.push({source:"event teams",method:"registered team search filtered to this event",count:searchedTeams.length});
          for (let index=errors.length-1; index>=0; index--) {
            if (errors[index].source === "event teams") errors.splice(index,1);
          }
        }
      } catch (error) {
        if (!sourceAvailability.teams) errors.push({source:"event team search fallback",status:error?.status || null,message:error?.message || "Fallback team search failed"});
      }
    }

    const divisions = await mapLimit(event.divisions || [],3,async division => {
      const divisionKey = division.name || String(division.id || "unknown");
      if (!Number.isInteger(division.id)) {
        sourceAvailability.matches[divisionKey] = false;
        sourceAvailability.rankings[divisionKey] = false;
        errors.push({source:"division " + divisionKey,status:null,message:"Division ID not supplied by VEX"});
        return {division,matches:[],rankings:[]};
      }
      const [matches,rankings] = await Promise.all([
        collect("matches · " + divisionKey,robot.events.matches(event.id,division.id),sourceAvailability.matches,divisionKey),
        collect("rankings · " + divisionKey,robot.events.rankings(event.id,division.id),sourceAvailability.rankings,divisionKey)
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
    snapshot.sourceRecoveries = sourceRecoveries;
    snapshot.sourceAvailability = sourceAvailability;
    snapshot.liveStatus = event.ongoing === true ? "in_progress" : "event_feed";
    return snapshot;
  };
}
