import test from "node:test";
import assert from "node:assert/strict";
import { calculateTeamAnalytics, buildMatchRows, buildSkillsBoard } from "../netlify/functions/lib/analytics.mjs";

const teams = [
  {id:1,number:"1831M",team_name:"Mike",organization:"The King's School"},
  {id:2,number:"1940H",team_name:"",organization:"Knox Grammar"}
];
const divisions = [{
  division:{id:1,name:"Main"},
  rankings:[{team:{name:"1831M"},rank:1,wins:2,losses:0,ties:0,wp:4,ap:6,sp:90,average_points:80,high_score:100}],
  matches:[
    {id:10,round:2,instance:1,matchnum:1,name:"Qualification 1",scored:true,alliances:[
      {color:"red",score:80,teams:[{team:{name:"1831M"}},{team:{name:"1940H"}}]},
      {color:"blue",score:60,teams:[{team:{name:"999A"}}]}
    ]},
    {id:11,round:2,instance:1,matchnum:2,name:"Qualification 2",scored:false,alliances:[
      {color:"red",score:0,teams:[{team:{name:"1831M"}}]},
      {color:"blue",score:0,teams:[{team:{name:"999A"}}]}
    ]}
  ]
}];
const skills = [
  {team:{name:"1831M"},type:"driver",score:60},
  {team:{name:"1831M"},type:"driver",score:55},
  {team:{name:"1831M"},type:"programming",score:40}
];

test("team analytics separates scored matches from unscored fixtures", () => {
  const rows = calculateTeamAnalytics(teams, divisions, skills);
  const mike = rows.find(t => t.number === "1831M");
  assert.equal(mike.matches, 2);
  assert.equal(mike.scoredMatches, 1);
  assert.equal(mike.wins, 1);
  assert.equal(mike.allianceForAvg, 80);
  assert.equal(mike.allianceAgainstAvg, 60);
  assert.equal(mike.allianceDiffAvg, 20);
  assert.equal(mike.rank, 1);
  assert.equal(mike.skillsTotal, 100);
});

test("match rows keep unscored fixtures separate from completed scores", () => {
  const rows = buildMatchRows(divisions);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].scored, true);
  assert.equal(rows[1].scored, false);
  assert.deepEqual(rows[0].redTeams, ["1831M", "1940H"]);
});

test("skills board uses best driver and programming runs, not sums of every attempt", () => {
  const rows = buildSkillsBoard(skills, teams);
  assert.equal(rows[0].driver, 60);
  assert.equal(rows[0].programming, 40);
  assert.equal(rows[0].total, 100);
  assert.equal(rows[0].attempts, 3);
});
