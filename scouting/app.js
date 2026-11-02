const data = window.SCOUTING_DATA;
const $ = s => document.querySelector(s);
const schools = [...new Set(data.teams.map(t=>t.school))];
$("#summary").innerHTML = [
  [data.teams.length,"REGISTERED TEAMS"],
  [schools.length,"SCHOOLS / PROGRAMMES"],
  ["—","VERIFIED PERFORMANCE RECORDS"]
].map(([v,l])=>'<div class="stat"><strong>'+v+'</strong><span>'+l+'</span></div>').join("");
$("#school-bars").innerHTML = schools.map(s=>{const n=data.teams.filter(t=>t.school===s).length;return '<div class="school-row"><span>'+s+'</span><div class="bar"><i style="width:'+(n/data.teams.length*100)+'%"></i></div><b>'+n+'</b></div>'}).join("");
$("#priority-table").innerHTML = data.teams.slice(0,8).map(t=>'<tr><td class="team-code">'+t.id+'</td><td>'+t.school+'</td><td><span class="tag">NOT VERIFIED</span></td><td>'+t.style+'</td><td><span class="tag">ROSTER ONLY</span></td></tr>').join("");
$("#school-filter").innerHTML += schools.map(s=>'<option>'+s+'</option>').join("");
function renderTeams(){
 const q=$("#search").value.toLowerCase(), school=$("#school-filter").value;
 const rows=data.teams.filter(t=>(!school||t.school===school)&&(t.id.toLowerCase().includes(q)||t.school.toLowerCase().includes(q)));
 $("#team-grid").innerHTML=rows.map(t=>'<article class="team-card"><h3>'+t.id+'</h3><p>'+t.school+'</p><div class="card-bottom"><span class="tag">ROSTER CONFIRMED</span><span class="muted">Evidence pending</span></div></article>').join("") || '<p class="muted">No matching teams.</p>';
}
$("#search").addEventListener("input",renderTeams);$("#school-filter").addEventListener("change",renderTeams);renderTeams();
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".tab,.view").forEach(x=>x.classList.remove("active"));b.classList.add("active");$("#"+b.dataset.view).classList.add("active")}));
