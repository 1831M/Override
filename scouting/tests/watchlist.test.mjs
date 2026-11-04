import test from "node:test";
import assert from "node:assert/strict";
import { buildWatchlistScheduleRows } from "../watchlist.mjs";

const matches = [
  {name:"Q4",division:"Main",scored:false,scheduled:"2026-11-08T10:30:00+11:00",redTeams:["1831M","1940H"],blueTeams:["4613G","999A"]},
  {name:"Q2",division:"Main",scored:false,scheduled:"2026-11-08T09:30:00+11:00",redTeams:["1831M"],blueTeams:["123A"]},
  {name:"Q6",division:"Main",scored:true,scheduled:"2026-11-08T11:00:00+11:00",redTeams:["1831M"],blueTeams:["1940H"]},
  {name:"Q8",division:"Main",scored:false,redTeams:["999A"],blueTeams:["888A"]},
  {name:"Unknown",division:"Main",redTeams:["1831M"],blueTeams:["888A"]}
];

test("pinned teams override baseline and only matching unscored fixtures are planned", () => {
  const rows = buildWatchlistScheduleRows(matches, ["1831M"], [{team:"4613G",tier:"S",ccwm:50}]);
  assert.deepEqual(rows.map(row => row.match), ["Q2", "Q4"]);
  assert.deepEqual(rows[0].watched, ["1831M"]);
  assert.equal(rows[0].source, "Manually pinned");
  assert.equal(rows[0].focus, "Red alliance");
});

test("baseline priorities are ranked S before A and then by CCWM", () => {
  const baseline = [
    {team:"A1",tier:"A",ccwm:90},
    {team:"S1",tier:"S",ccwm:10},
    {team:"S2",tier:"S",ccwm:20}
  ];
  const rows = buildWatchlistScheduleRows(matches, [], baseline);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].source, "S/A baseline priority");
  assert.ok(rows.every(row => row.watched.some(team => ["A1","S1","S2"].includes(team))));
});

test("unknown score state is excluded rather than assumed to be an upcoming match", () => {
  const rows = buildWatchlistScheduleRows(matches, ["1831M"], []);
  assert.ok(rows.every(row => row.match !== "Unknown" && row.match !== "Q6"));
});

test("invalid and missing scheduled times sort after valid fixtures without crashing", () => {
  const rows = buildWatchlistScheduleRows([
    {name:"No time",scored:false,redTeams:["1831M"],blueTeams:[]},
    {name:"Invalid time",scored:false,scheduled:"not-a-date",redTeams:["1831M"],blueTeams:[]},
    {name:"Timed",scored:false,scheduled:"2026-11-08T09:00:00+11:00",redTeams:["1831M"],blueTeams:[]}
  ], ["1831M"], []);
  assert.deepEqual(rows.map(row => row.match), ["Timed", "No time", "Invalid time"]);
});

test("bad optional inputs return an empty plan instead of throwing", () => {
  assert.deepEqual(buildWatchlistScheduleRows(null, null, null), []);
  assert.deepEqual(buildWatchlistScheduleRows([{scored:false,redTeams:["A"],blueTeams:[]}], ["A"]), [
    {match:"Match",division:"Division not listed",field:"",scheduled:"",red:["A"],blue:[],watched:["A"],focus:"Red alliance",source:"Manually pinned",_index:0}
  ]);
});
