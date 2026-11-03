const data = window.SCOUTING_DATA;
const $ = s => document.querySelector(s);
const eventById = Object.fromEntries(data.sources.map(s => [s.id, s]));
const schools = [...new Set(data.teams.map(t => t.school))];
const verifiedTeams = data.teams.filter(t => t.events.length > 0);
const appearances = data.teams.reduce((n, t) => n + t.events.length, 0);

// Evidence coverage only, not a measure of robot strength.
function reliability(t) {
  const hasSkills = t.events.some(e => e.skills !== undefined);
  return Math.min(10, 1 + Math.min(2, t.events.length) * 1.5 + (hasSkills ? 1 : 0) + (t.footage ? 2 : 0) + (t.notebook ? 2 : 0) + (t.independentConfirmation ? 1 : 0));
}
$("#summary").innerHTML = [
  [data.teams.length, "REGISTERED TEAMS"],
  [schools.length, "SCHOOLS / PROGRAMMES"],
  [verifiedTeams.length + "/24", "WITH EVENT RESULT DATA"],
  [appearances, "RESULTS RECORDS LOGGED"]
].map(([v, l]) => '<div class="stat"><strong>' + v + '</strong><span>' + l + '</span></div>').join("");

$("#school-bars").innerHTML = schools.map(s => {
  const n = data.teams.filter(t => t.school === s).length;
  return '<div class="school-row"><span>' + s + '</span><div class="bar"><i style="width:' + (n / data.teams.length * 100) + '%"></i></div><b>' + n + '</b></div>';
}).join("");

$(".coverage-number").innerHTML = verifiedTeams.length + '<span>/24</span>';
$(".coverage p").textContent = "teams with at least one event-result record in the two reviewed third-party summaries";
$(".progress i").style.width = (verifiedTeams.length / data.teams.length * 100) + "%";

const bestRecord = t => t.events.length ? t.events.slice().sort((a, b) => {
  const [aw, al] = a.record.split("-").map(Number);
  const [bw, bl] = b.record.split("-").map(Number);
  return bw / (bw + bl) - aw / (aw + al);
})[0] : null;

$("#priority-table").innerHTML = data.teams.slice().sort((a, b) => reliability(b) - reliability(a)).slice(0, 10).map(t => {
  const e = bestRecord(t);
  return '<tr><td class="team-code">' + t.id + '</td><td>' + t.school + '</td><td>' + (e ? e.record + ' · ' + eventById[e.event].date : 'NOT VERIFIED') + '</td><td>' + t.style + '</td><td>' + reliability(t).toFixed(1) + '/10</td></tr>';
}).join("");

$("#school-filter").innerHTML += schools.slice().sort().map(s => '<option>' + s + '</option>').join("");

function renderTeams() {
  const q = $("#search").value.toLowerCase(), school = $("#school-filter").value;
  const rows = data.teams.filter(t => (!school || t.school === school) && (t.id.toLowerCase().includes(q) || t.school.toLowerCase().includes(q)));
  $("#team-grid").innerHTML = rows.map(t => {
    const records = t.events.map(e => {
      const ev = eventById[e.event];
      return '<div class="record-row"><b>' + ev.date + '</b><span>' + e.record + '</span><span>Rank #' + e.rank + '</span></div><div class="record-metrics">AP ' + e.ap + ' · SP ' + e.sp + ' · VP ' + e.vp + (e.skills !== undefined ? ' · Skills ' + e.skills + ' (D ' + e.driver + ' / A ' + e.auton + ')' : '') + (e.qualAlliance ? '<br>Alliance avg: ' + e.qualAlliance.forAvg + ' for / ' + e.qualAlliance.againstAvg + ' against · Δ ' + (e.qualAlliance.diffAvg > 0 ? '+' : '') + e.qualAlliance.diffAvg : '') + '</div>';
    }).join("");
    const skill = t.events.find(e => e.skills !== undefined);
    return '<article class="team-card"><h3>' + t.id + '</h3><p>' + t.school + '</p><div class="team-records">' + (records || '<div class="record-empty">No results record verified in reviewed sources</div>') + '</div><div class="card-bottom"><span class="tag">' + t.events.length + ' EVENT RECORD' + (t.events.length === 1 ? '' : 'S') + '</span><span class="muted">Evidence ' + reliability(t).toFixed(1) + '/10</span></div></article>';
  }).join("") || '<p class="muted">No matching teams.</p>';
}
$("#search").addEventListener("input", renderTeams);
$("#school-filter").addEventListener("change", renderTeams);
renderTeams();

document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".tab,.view").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  $("#" + b.dataset.view).classList.add("active");
}));

const sourceList = document.createElement("div");
sourceList.className = "source-list";
sourceList.innerHTML = data.sources.map(s => '<p><b>' + s.date + ' · ' + s.format + '</b> — <a href="' + s.url + '" target="_blank" rel="noopener">' + s.name + '</a><br><span>' + s.note + '</span></p>').join("");
$("#evidence .panel").append(sourceList);
