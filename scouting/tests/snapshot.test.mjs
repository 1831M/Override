import test from "node:test";
import assert from "node:assert/strict";
import {createSnapshotLoader} from "../netlify/functions/lib/fetch-snapshot.mjs";

const fixtureEvent = {
  id:66512, sku:"VE-V5-26-66512", name:"NSW State Championships",
  start:"2026-11-08T09:00:00+11:00", end:"2026-11-08T17:00:00+11:00",
  season:{id:77,name:"2026-2027"}, program:{id:1,name:"V5RC"},
  location:{venue:"Knox Grammar School",city:"Wahroonga",country:"Australia"},
  divisions:[{id:3,name:"Main"}], ongoing:false
};
const fixtureTeams = [
  {id:1,number:"1831M",team_name:"Mike",organization:"The King's School",grade:"Middle School",program:{id:1,name:"V5RC"}},
  {id:2,number:"1940H",team_name:"Knox",organization:"Knox Grammar School",grade:"Middle School",program:{id:1,name:"V5RC"}}
];
const fixtureMatches = [
  {id:101,event:{id:66512,name:fixtureEvent.name},division:{id:3,name:"Main"},round:2,instance:1,matchnum:1,
   name:"Qualification 1",scored:true,alliances:[
     {color:"red",score:80,teams:[{team:{id:1,name:"1831M"}},{team:{id:2,name:"1940H"}}]},
     {color:"blue",score:60,teams:[{team:{id:3,name:"999A"}}]}
   ]},
  {id:102,event:{id:66512,name:fixtureEvent.name},division:{id:3,name:"Main"},round:2,instance:1,matchnum:2,
   name:"Qualification 2",scored:false,alliances:[
     {color:"red",score:0,teams:[{team:{id:1,name:"1831M"}}]},
     {color:"blue",score:0,teams:[{team:{id:3,name:"999A"}}]}
   ]}
];

function fakeRobot(overrides = {}) {
  const calls = {sku:[],teams:[],teamOptions:null,skills:0,awards:0,matches:[],rankings:[],history:[]};
  const robot = {
    events:{
      getBySku:async sku => {calls.sku.push(sku);return fixtureEvent;},
      teams:async (id,options) => {calls.teams.push(id);calls.teamOptions=options;return fixtureTeams;},
      skills:async () => {calls.skills++;return [
        {team:{id:1,name:"1831M"},type:"driver",score:60,attempts:1},
        {team:{id:1,name:"1831M"},type:"driver",score:55,attempts:1},
        {team:{id:1,name:"1831M"},type:"programming",score:40,attempts:1}
      ];},
      awards:async () => {calls.awards++;return [
        {id:8,title:"Excellence Award",designation:"tournament",classification:"champion",teamWinners:[{team:{id:1,name:"1831M"}}]}
      ];},
      matches:async (eventId, divisionId) => {calls.matches.push([eventId,divisionId]);return fixtureMatches;},
      rankings:async (eventId, divisionId) => {calls.rankings.push([eventId,divisionId]);return [
        {rank:1,team:{id:1,name:"1831M"},wins:1,losses:0,ties:0,wp:2,ap:3,sp:80,average_points:80,high_score:80},
        {rank:2,team:{id:2,name:"1940H"},wins:0,losses:1,ties:0,wp:0,ap:0,sp:60,average_points:60,high_score:60}
      ];},
      ...overrides.events
    },
    teams:{
      events:async (teamId, options, request) => {
        calls.history.push({teamId,options,request});
        return [{id:900+teamId,sku:"VE-V5-26-60000",name:"Override Tournament",start:"2026-09-01T09:00:00+10:00"}];
      },
      ...overrides.teams
    }
  };
  return {robot,calls};
}

test("fetches one official event snapshot across all competition data sources",async()=>{
  const {robot,calls}=fakeRobot();
  const load=createSnapshotLoader({now:()=>Date.parse("2026-11-08T10:00:00Z")});
  const snapshot=await load(robot,"VE-V5-26-66512");
  assert.equal(calls.sku[0],"VE-V5-26-66512");
  assert.deepEqual(calls.teams,[66512]);
  assert.deepEqual(calls.teamOptions,{registered:true});
  assert.deepEqual(calls.matches,[[66512,3]]);
  assert.deepEqual(calls.rankings,[[66512,3]]);
  assert.equal(calls.skills,1);
  assert.equal(calls.awards,1);
  assert.equal(calls.history.length,2);
  assert.ok(calls.history.every(call=>call.options.seasons[0]===77));
  assert.ok(calls.history.every(call=>call.options.includeCancelled===false));
  assert.ok(calls.history.every(call=>call.request.maxPages===3));
  assert.equal(snapshot.teams.length,2);
  assert.equal(snapshot.matches.length,2);
  assert.equal(snapshot.rankings[0].team,"1831M");
  assert.equal(snapshot.stats.find(team=>team.number==="1831M").scoredMatches,1);
  assert.equal(snapshot.stats.find(team=>team.number==="1831M").skillsTotal,100);
  assert.equal(snapshot.skills[0].total,100);
  assert.equal(snapshot.awards[0].teams[0],"1831M");
  assert.equal(snapshot.seasonHistory.checkedTeams,2);
  assert.equal(snapshot.seasonHistory.eventCount,2);
  assert.equal(snapshot.sourceErrors.length,0);
  assert.equal(snapshot.liveStatus,"event_feed");
  assert.equal(new Date(snapshot.fetchedAt).toISOString(),"2026-11-08T10:00:00.000Z");
});

test("one failing source stays visible as a warning without discarding good event data",async()=>{
  const {robot,calls}=fakeRobot({events:{skills:async()=>{calls.skills++;throw new Error("skills temporarily unavailable");}}});
  const load=createSnapshotLoader();
  const snapshot=await load(robot,"VE-V5-26-66512");
  assert.equal(snapshot.teams.length,2);
  assert.equal(snapshot.matches.length,2);
  assert.equal(snapshot.skills.length,0);
  assert.ok(snapshot.sourceErrors.some(error=>error.source==="skills"&&error.message==="skills temporarily unavailable"));
});

test("failed team-history lookups are marked unchecked, not treated as no events",async()=>{
  const {robot}=fakeRobot({teams:{events:async teamId=>{
    if(teamId===2) throw new Error("history timeout");
    return [{id:901,sku:"VE-V5-26-60000",name:"Prior event",start:"2026-09-01T09:00:00+10:00"}];
  }}});
  const load=createSnapshotLoader();
  const snapshot=await load(robot,"VE-V5-26-66512");
  assert.equal(snapshot.seasonHistory.checkedTeams,1);
  assert.deepEqual(snapshot.seasonHistory.uncheckedTeams,["1940H"]);
  assert.equal(snapshot.stats.find(team=>team.number==="1831M").eventHistory.length,1);
  assert.equal(snapshot.stats.find(team=>team.number==="1940H").eventHistory.length,0);
  assert.ok(snapshot.sourceErrors.some(error=>error.source==="season history · 1940H"));
});

test("unknown event SKU fails clearly instead of returning an empty fake snapshot",async()=>{
  const {robot}=fakeRobot({events:{getBySku:async()=>null}});
  const load=createSnapshotLoader();
  await assert.rejects(()=>load(robot,"NOT-A-REAL-EVENT"),error=>error.status===404&&/could not find event/.test(error.message));
});

test("current-season history cache avoids repeatedly querying team event histories",async()=>{
  let clock=1000;
  const {robot,calls}=fakeRobot();
  const load=createSnapshotLoader({historyTtlMs:600_000,now:()=>clock});
  await load(robot,"VE-V5-26-66512");
  const firstHistoryCalls=calls.history.length;
  clock+=60_000;
  await load(robot,"VE-V5-26-66512");
  assert.equal(firstHistoryCalls,2);
  assert.equal(calls.history.length,firstHistoryCalls);
});
