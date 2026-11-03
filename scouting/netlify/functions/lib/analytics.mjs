export function roundLabel(round) {
  const names = {1:"Practice",2:"Qualification",3:"Quarter-final",4:"Semi-final",5:"Final",6:"Round of 16",15:"Top N final",16:"Round robin"};
  return names[Number(round)] || "Other";
}

export function shortMatchName(match) {
  const round = Number(match.round);
  const number = Number(match.matchnum);
  const instance = Number(match.instance);
  const prefix = round === 1 ? "P" : round === 2 ? "Q" : round === 3 ? "QF" : round === 4 ? "SF" : round === 5 ? "F" : round === 6 ? "R16" : round === 16 ? "RR" : "M";
  return [1,2,15].includes(round) ? prefix + " " + number : prefix + " " + instance + "-" + number;
}

const allianceOf = (match, color) => (match.alliances || []).find(a => a.color === color);
const teamNumber = entry => entry && entry.team && entry.team.name ? String(entry.team.name) : null;

export function calculateTeamAnalytics(teams, divisions, skills) {
  const stats = new Map();
  for (const team of teams || []) {
    stats.set(String(team.number), {
      number:String(team.number), id:team.id, name:team.team_name || "", school:team.organization || "",
      grade:team.grade || null, matches:0, scoredMatches:0, wins:0, losses:0, ties:0,
      allianceForTotal:0, allianceAgainstTotal:0, driverSkills:null, programmingSkills:null,
      skillAttempts:0, rank:null, wp:null, ap:null, sp:null, averagePoints:null, highScore:null,
      eventHistory:[]
    });
  }

  for (const divisionData of divisions || []) {
    for (const ranking of divisionData.rankings || []) {
      const number = ranking.team && ranking.team.name ? String(ranking.team.name) : null;
      const current = number && stats.get(number);
      if (!current) continue;
      if (ranking.rank != null && (current.rank == null || Number(ranking.rank) < current.rank)) {
        current.rank = Number(ranking.rank);
        current.wp = ranking.wp ?? null;
        current.ap = ranking.ap ?? null;
        current.sp = ranking.sp ?? null;
        current.averagePoints = ranking.average_points ?? null;
        current.highScore = ranking.high_score ?? null;
      }
    }

    for (const match of divisionData.matches || []) {
      const red = allianceOf(match, "red");
      const blue = allianceOf(match, "blue");
      for (const alliance of [red, blue]) {
        if (!alliance) continue;
        const opponent = alliance === red ? blue : red;
        for (const entry of alliance.teams || []) {
          if (entry.sitting === true) continue;
          const number = teamNumber(entry);
          const current = number && stats.get(number);
          if (!current) continue;
          current.matches += 1;
          if (match.scored === true && opponent && Number.isFinite(alliance.score) && Number.isFinite(opponent.score)) {
            current.scoredMatches += 1;
            current.allianceForTotal += alliance.score;
            current.allianceAgainstTotal += opponent.score;
            if (alliance.score > opponent.score) current.wins += 1;
            else if (alliance.score < opponent.score) current.losses += 1;
            else current.ties += 1;
          }
        }
      }
    }
  }

  for (const run of skills || []) {
    const number = run.team && run.team.name ? String(run.team.name) : null;
    const current = number && stats.get(number);
    if (!current || !Number.isFinite(run.score)) continue;
    current.skillAttempts += 1;
    if (run.type === "driver") current.driverSkills = Math.max(current.driverSkills ?? 0, run.score);
    if (run.type === "programming") current.programmingSkills = Math.max(current.programmingSkills ?? 0, run.score);
  }

  return [...stats.values()].map(team => {
    const n = team.scoredMatches;
    team.allianceForAvg = n ? Number((team.allianceForTotal / n).toFixed(1)) : null;
    team.allianceAgainstAvg = n ? Number((team.allianceAgainstTotal / n).toFixed(1)) : null;
    team.allianceDiffAvg = n ? Number(((team.allianceForTotal - team.allianceAgainstTotal) / n).toFixed(1)) : null;
    team.winRate = n ? Number((team.wins / n * 100).toFixed(1)) : null;
    team.skillsTotal = team.driverSkills != null || team.programmingSkills != null
      ? (team.driverSkills || 0) + (team.programmingSkills || 0) : null;
    delete team.allianceForTotal;
    delete team.allianceAgainstTotal;
    return team;
  });
}

export function buildMatchRows(divisions) {
  return (divisions || []).flatMap(divisionData =>
    (divisionData.matches || []).map(match => {
      const red = allianceOf(match, "red");
      const blue = allianceOf(match, "blue");
      return {
        id:match.id, division:divisionData.division.name || "Division",
        round:Number(match.round), roundLabel:roundLabel(match.round),
        name:shortMatchName(match), scheduled:match.scheduled || match.started || null,
        started:match.started || null, field:match.field || null, scored:match.scored === true,
        redScore:red ? red.score : null, blueScore:blue ? blue.score : null,
        redTeams:(red?.teams || []).filter(t => t.sitting !== true).map(teamNumber).filter(Boolean),
        blueTeams:(blue?.teams || []).filter(t => t.sitting !== true).map(teamNumber).filter(Boolean)
      };
    })
  ).sort((a,b) => {
    const timeA = a.scheduled ? Date.parse(a.scheduled) : NaN;
    const timeB = b.scheduled ? Date.parse(b.scheduled) : NaN;
    if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) return timeA - timeB;
    return a.round - b.round || a.name.localeCompare(b.name, undefined, {numeric:true});
  });
}

export function buildSkillsBoard(skills, teams) {
  const names = new Map((teams || []).map(t => [String(t.number), t.team_name || t.organization || ""]));
  const board = new Map();
  for (const run of skills || []) {
    const number = run.team && run.team.name ? String(run.team.name) : null;
    if (!number || !Number.isFinite(run.score)) continue;
    if (!board.has(number)) board.set(number, {team:number, name:names.get(number) || "", driver:null, programming:null, attempts:0});
    const row = board.get(number);
    row.attempts += 1;
    if (run.type === "driver") row.driver = Math.max(row.driver ?? 0, run.score);
    if (run.type === "programming") row.programming = Math.max(row.programming ?? 0, run.score);
  }
  return [...board.values()].map(row => ({
    ...row,
    total:row.driver != null || row.programming != null ? (row.driver || 0) + (row.programming || 0) : null
  })).sort((a,b) => (b.total ?? -1) - (a.total ?? -1));
}

export function summarizeEvent(event, teams, divisions, skills, awards, teamHistory) {
  const teamAnalytics = calculateTeamAnalytics(teams, divisions, skills);
  const matches = buildMatchRows(divisions);
  const rankings = (divisions || []).flatMap(d => (d.rankings || []).map(r => ({
    division:d.division.name || "Division", rank:r.rank ?? null,
    team:r.team?.name || "Unknown", wins:r.wins ?? null, losses:r.losses ?? null,
    ties:r.ties ?? null, wp:r.wp ?? null, ap:r.ap ?? null, sp:r.sp ?? null,
    averagePoints:r.average_points ?? null, highScore:r.high_score ?? null
  }))).sort((a,b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  const history = teamHistory || {};
  for (const stat of teamAnalytics) stat.eventHistory = history[stat.number] || [];
  return {
    event:{
      id:event.id, sku:event.sku, name:event.name, start:event.start || null, end:event.end || null,
      season:event.season, program:event.program, location:event.location,
      divisions:event.divisions || [], ongoing:event.ongoing === true,
      eventUrl:"https://events.vex.com/" + event.sku + ".html"
    },
    teams:(teams || []).map(t => ({
      id:t.id, number:t.number, team_name:t.team_name || "", robot_name:t.robot_name || "",
      organization:t.organization || "", grade:t.grade || null, registered:t.registered ?? null
    })),
    stats:teamAnalytics,
    matches,
    rankings,
    skills:buildSkillsBoard(skills, teams),
    awards:(awards || []).map(a => ({
      id:a.id ?? null, title:a.title || "Award", designation:a.designation || null,
      classification:a.classification || null,
      teams:(a.teamWinners || []).map(w => w.team?.name).filter(Boolean),
      individuals:a.individualWinners || []
    })),
    source:{name:"VEX Events API v2",url:"https://events.vex.com/api/v2",client:"@v5x/events"}
  };
}
