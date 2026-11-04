(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  const state = {
    snapshot:null, previous:null, live:false, stale:false,
    busy:false, matchFilter:"all", archive:false
  };
  const legacy = window.SCOUTING_DATA || null;
  const LIVE_ENDPOINT = "/.netlify/functions/live-data";
  const POLL_MS = 60_000;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[char]);
  const num = value => value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toLocaleString("en-AU");
  const signed = value => value == null || !Number.isFinite(Number(value)) ? "—" : (Number(value) > 0 ? "+" : "") + Number(value).toFixed(1);
  const dateTime = value => {
    if (!value) return "Not published";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Not published" : date.toLocaleString("en-AU",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"});
  };
  const dateOnly = value => {
    if (!value) return "Date TBC";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Date TBC" : date.toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric"});
  };
  const teamName = team => [team.team_name,team.organization].filter(Boolean).join(" · ") || "Organisation not listed";
  const resultRecord = row => [row.wins ?? 0,row.losses ?? 0,row.ties ?? 0].join("–");
  const teamLookup = () => new Map((state.snapshot?.teams || []).map(team => [String(team.number),team]));
  const statLookup = () => new Map((state.snapshot?.stats || []).map(team => [String(team.number),team]));
  const divisionOptions = () => state.snapshot?.event?.divisions || [];
  const divisionFeedComplete = key => {
    const divisions = divisionOptions();
    const available = state.snapshot?.sourceAvailability?.[key] || {};
    return divisions.length > 0 && divisions.every(division =>
      available[division.name || String(division.id)] === true
    );
  };

  function setConnection(kind, title, message) {
    const pill = $("#connection-pill");
    pill.className = "connection-pill " + kind;
    $("#connection-label").textContent = kind === "live" ? "VEX feed live" : kind === "stale" ? "Showing cached data" : kind === "error" ? "Feed needs setup" : "Checking VEX feed";
    $("#status-title").textContent = title;
    $("#status-message").textContent = message;
    $("#status-icon").textContent = kind === "live" ? "✓" : kind === "stale" ? "↻" : kind === "error" ? "!" : "↻";
  }

  function showAlert(message, type) {
    const alert = $("#data-alert");
    alert.className = "alert " + (type || "info");
    alert.textContent = message;
  }
  function hideAlert() {
    $("#data-alert").classList.add("hidden");
    $("#data-alert").textContent = "";
  }

  function saveSnapshot(snapshot) {
    try {
      localStorage.setItem("1831m-override-live-v1", JSON.stringify({savedAt:new Date().toISOString(),snapshot}));
    } catch {}
  }
  function loadSnapshot() {
    try {
      const raw = localStorage.getItem("1831m-override-live-v1");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.snapshot ? parsed : null;
    } catch { return null; }
  }

  function applySnapshot(snapshot, options = {}) {
    state.previous = state.snapshot;
    state.snapshot = snapshot;
    state.live = options.live === true;
    state.stale = options.stale === true;
    $("#last-updated").textContent = dateTime(snapshot.fetchedAt);
    $("#official-event-link").href = snapshot.event.eventUrl;
    $("#hero-event-link").href = snapshot.event.eventUrl;
    $("#source-event-link").href = snapshot.event.eventUrl;
    $("#event-code").textContent = snapshot.event.sku || "VEX EVENT";
    $("#overview-caption").textContent = snapshot.event.ongoing ? "Competition in progress" : "Official event feed connected";
    if (options.stale) {
      setConnection("stale","VEX Events is temporarily unavailable","Showing the last successful official snapshot. The displayed timestamp is the original update time.");
    } else if (options.live) {
      setConnection("live",snapshot.event.ongoing ? "Competition feed connected" : "Official event feed connected","VEX Events data is being checked every 60 seconds while this page is open.");
    } else {
      setConnection("stale","Showing a saved official snapshot","Reconnect to VEX Events to check for new scores and rankings.");
    }
    const missing = (snapshot.sourceErrors || []).length;
    const unchecked = snapshot.seasonHistory?.uncheckedTeams?.length || 0;
    if (missing || unchecked) {
      showAlert(
        (missing ? missing + " VEX data source section(s) could not be read. " : "") +
        (unchecked ? "Season history was not checked successfully for " + unchecked + " team(s). These gaps are unknown, not zero." : ""),
        "warning"
      );
    } else hideAlert();
    renderAll();
  }

  async function refresh(force = false) {
    if (state.busy) return;
    state.busy = true;
    const button = $("#refresh-button");
    button.classList.add("is-loading");
    button.disabled = true;
    if (!state.snapshot) setConnection("waiting","Connecting to VEX Events","Loading the official event record.");
    try {
      const url = LIVE_ENDPOINT + (force ? "?force=1" : "");
      const response = await fetch(url,{method:"GET",cache:"no-store",headers:{"Accept":"application/json"}});
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true || !payload.snapshot) {
        const error = new Error(payload.message || "The live data endpoint returned an error.");
        error.code = payload.code || "FEED_ERROR";
        error.status = response.status;
        throw error;
      }
      applySnapshot(payload.snapshot,{live:!payload.stale,stale:payload.stale === true});
      if (payload.stale) showAlert(payload.warning || "The VEX feed is temporarily unavailable. Cached data is being shown.","warning");
      saveSnapshot(payload.snapshot);
    } catch (error) {
      const cached = loadSnapshot();
      if (!state.snapshot && cached?.snapshot) applySnapshot(cached.snapshot,{stale:true});
      if (error.code === "TOKEN_REQUIRED") {
        setConnection("error","Live VEX feed needs its API token","The site is ready, but VEX_EVENTS_TOKEN has not been added to Netlify yet.");
        showAlert("Live competition data is not connected. Add VEX_EVENTS_TOKEN to the Netlify project as a secret environment variable with Functions scope. Do not put the token in this website or share it in chat.","warning");
      } else if (error.code === "VEX_AUTH_FAILED") {
        setConnection("error","VEX Events rejected the token","Check the server-side VEX_EVENTS_TOKEN setting and its validity.");
        showAlert("The live API token was rejected by VEX Events. The last saved snapshot, if available, remains labelled as cached.","warning");
      } else if (error.code === "EVENT_NOT_FOUND") {
        setConnection("error","Event not found in VEX Events","The configured event SKU did not resolve. The event code needs checking.");
        showAlert("The configured event SKU was not found in the official VEX API. No substitute data has been presented.","warning");
      } else {
        setConnection(state.snapshot ? "stale" : "error",state.snapshot ? "Could not refresh VEX Events" : "Could not connect to VEX Events",error.message || "Check the source connection and try again.");
        if (state.snapshot) showAlert("The last successful snapshot is still shown. Its timestamp has not been changed.","warning");
        else showAlert("No live VEX data is available yet. The page will keep retrying automatically.","warning");
        if (legacy && !state.snapshot) renderLegacyPreview();
      }
    } finally {
      state.busy = false;
      button.classList.remove("is-loading");
      button.disabled = false;
    }
  }

  function renderAll() {
    if (!state.snapshot) return;
    renderSummary();
    renderOverview();
    renderDivisionFilters();
    renderMatches();
    renderRankings();
    renderSeasonSnapshot();
    renderIntelligence();
    renderTeams();
    renderSkills();
    renderSources();
  }

  function renderSummary() {
    const snapshot = state.snapshot;
    const matches = snapshot.matches || [];
    const completed = matches.filter(match => match.scored).length;
    const upcoming = matches.filter(match => !match.scored).length;
    const topSkill = (snapshot.skills || []).find(row => row.total != null);
    const availability = snapshot.sourceAvailability || {};
    const teamsAvailable = availability.teams !== false;
    const matchesAvailable = divisionFeedComplete("matches");
    const skillsAvailable = availability.skills !== false;
    const awardsAvailable = availability.awards !== false;
    $("#metric-teams").textContent = teamsAvailable ? num(snapshot.teams.length) : "—";
    $("#metric-teams-note").textContent = teamsAvailable ? "Official registered event roster" : "Team roster feed unavailable";
    $("#metric-matches").textContent = matchesAvailable ? num(completed) : "—";
    $("#metric-matches-note").textContent = matchesAvailable ? upcoming + " scheduled / not yet scored" : "One or more division feeds unavailable";
    $("#metric-skills").textContent = skillsAvailable && topSkill ? num(topSkill.total) : "—";
    $("#metric-skills-note").textContent = !skillsAvailable ? "VEX skills feed unavailable" : topSkill ? topSkill.team + " · best driver + programming" : "No complete skills total posted";
    $("#metric-awards").textContent = awardsAvailable ? num(snapshot.awards.length) : "—";
    $("#metric-awards-note").textContent = awardsAvailable ? "Official awards returned" : "VEX awards feed unavailable";
  }

  function scorePill(match) {
    if (!match.scored) return '<span class="score-pending">Not scored</span>';
    return '<span class="score-final">' + num(match.redScore) + ' <i>:</i> ' + num(match.blueScore) + '</span>';
  }
  function allianceNames(numbers) {
    if (!numbers || !numbers.length) return '<span class="team-muted">Teams pending</span>';
    return numbers.map(number => '<b>' + esc(number) + '</b>').join('<span class="alliance-sep">·</span>');
  }

  function renderOverview() {
    const snapshot = state.snapshot;
    const unscored = (snapshot.matches || []).filter(match => !match.scored);
    const upcoming = unscored.slice(0,4);
    $("#up-next-list").innerHTML = upcoming.length ? upcoming.map(match =>
      '<div class="up-next-row"><div class="up-next-meta"><b>' + esc(match.name) + '</b><span>' + esc(match.division) + (match.field ? " · Field " + esc(match.field) : "") + '</span></div><div class="up-next-teams"><div class="alliance-red">' + allianceNames(match.redTeams) + '</div><div class="alliance-vs">VS</div><div class="alliance-blue">' + allianceNames(match.blueTeams) + '</div></div><div class="up-next-time">' + esc(dateTime(match.scheduled)) + '</div></div>'
    ).join("") : '<div class="empty-state">' + (divisionFeedComplete("matches") ? ((snapshot.matches || []).length ? "All currently published matches have scores." : "The official match schedule has not been published yet.") : "The match feed is unavailable for one or more divisions. No zero-filled schedule is shown.") + '</div>';

    const standings = (snapshot.rankings || []).slice(0,5);
    $("#top-rankings").innerHTML = standings.length ? standings.map(row =>
      '<div class="mini-rank-row"><span class="rank-number">' + num(row.rank) + '</span><b>' + esc(row.team) + '</b><span>' + esc([row.wins ?? "—",row.losses ?? "—",row.ties ?? "—"].join("–")) + '</span><strong>' + num(row.wp) + ' WP</strong></div>'
    ).join("") : '<div class="empty-state">' + (divisionFeedComplete("rankings") ? "No published ranking rows yet." : "The ranking feed is unavailable for one or more divisions.") + '</div>';

    const skills = (snapshot.skills || []).filter(row => row.total != null).slice(0,5);
    $("#top-skills").innerHTML = skills.length ? skills.map((row,index) =>
      '<div class="skill-leader-row"><span class="skill-rank">' + (index+1) + '</span><b>' + esc(row.team) + '</b><div class="skill-bar"><i style="width:' + Math.max(0,Math.min(100,(row.total/(skills[0].total || 1))*100)) + '%"></i></div><strong>' + num(row.total) + '</strong></div>'
    ).join("") : '<div class="empty-state">' + (snapshot.sourceAvailability?.skills === false ? "The VEX skills feed is unavailable." : "No skills totals have been posted yet.") + '</div>';

    renderActivity();
  }

  function renderActivity() {
    const snapshot = state.snapshot;
    const previous = state.previous;
    const entries = [];
    if (previous) {
      const previousMatches = new Map((previous.matches || []).map(match => [String(match.id),match]));
      for (const match of snapshot.matches || []) {
        const prior = previousMatches.get(String(match.id));
        if (match.scored && (!prior || !prior.scored || prior.redScore !== match.redScore || prior.blueScore !== match.blueScore)) {
          entries.push({icon:"✓",title:match.name + " result posted",detail:match.redScore + "–" + match.blueScore + " · " + match.division,time:match.scheduled});
        }
      }
      const oldRanks = new Map((previous.rankings || []).map(row => [row.team + "|" + row.division,row.rank]));
      for (const row of snapshot.rankings || []) {
        if (oldRanks.has(row.team + "|" + row.division) && oldRanks.get(row.team + "|" + row.division) !== row.rank) {
          entries.push({icon:"↗",title:row.team + " ranking updated",detail:"Now #" + row.rank + " in " + row.division,time:null});
        }
      }
      const oldAwards = new Set((previous.awards || []).map(row => row.id || row.title));
      for (const award of snapshot.awards || []) {
        if (!oldAwards.has(award.id || award.title)) entries.push({icon:"✦",title:"Award added: " + award.title,detail:(award.teams || []).join(", ") || "Winner information pending",time:null});
      }
    }
    if (!entries.length) {
      const latest = (snapshot.matches || []).filter(match => match.scored).slice(-4).reverse();
      latest.forEach(match => entries.push({icon:"✓",title:match.name + " official result",detail:match.redScore + "–" + match.blueScore + " · " + match.division,time:match.scheduled}));
    }
    const visible = entries.slice(0,6);
    $("#activity-feed").innerHTML = visible.length ? visible.map(item =>
      '<div class="activity-row"><span class="activity-icon">' + esc(item.icon) + '</span><div><b>' + esc(item.title) + '</b><small>' + esc(item.detail) + '</small></div><time>' + esc(item.time ? dateTime(item.time) : "Just synced") + '</time></div>'
    ).join("") : '<div class="empty-state">The VEX feed is connected. No new result changes since the last refresh.</div>';
  }

  function renderDivisionFilters() {
    const divisions = divisionOptions();
    const build = current => '<option value="">All divisions</option>' + divisions.map(division =>
      '<option value="' + esc(division.name || "") + '"' + (current === division.name ? " selected" : "") + '>' + esc(division.name || "Division") + '</option>'
    ).join("");
    $("#division-filter").innerHTML = build($("#division-filter").value);
    $("#ranking-division").innerHTML = build($("#ranking-division").value);
  }

  function renderMatches() {
    const division = $("#division-filter").value;
    let matches = (state.snapshot?.matches || []).filter(match => !division || match.division === division);
    if (state.matchFilter === "upcoming") matches = matches.filter(match => !match.scored);
    if (state.matchFilter === "scored") matches = matches.filter(match => match.scored);
    const rows = matches.map(match =>
      '<tr><td><b class="table-match-name">' + esc(match.name) + '</b><small>' + esc(match.roundLabel) + '</small></td><td>' + esc(match.division) + '<small>' + (match.field ? "Field " + esc(match.field) : "Field not listed") + '</small></td><td class="alliance-cell red-cell">' + allianceNames(match.redTeams) + '</td><td class="table-score">' + scorePill(match) + '</td><td class="alliance-cell blue-cell">' + allianceNames(match.blueTeams) + '</td><td>' + (match.scored ? '<span class="status-tag scored">Scored</span>' : '<span class="status-tag pending">Pending</span>') + '</td></tr>'
    ).join("");
    $("#match-table").innerHTML = rows || '<tr><td colspan="6" class="table-empty">' + (divisionFeedComplete("matches") ? "No matches match these filters." : "Match results are unavailable from one or more VEX division feeds. This is not a zero-score result.") + '</td></tr>';
  }

  function renderRankings() {
    const search = $("#ranking-search").value.trim().toLowerCase();
    const division = $("#ranking-division").value;
    const rows = (state.snapshot?.rankings || []).filter(row =>
      (!division || row.division === division) &&
      (!search || String(row.team).toLowerCase().includes(search))
    );
    $("#ranking-table").innerHTML = rows.map(row =>
      '<tr><td><span class="rank-number">' + num(row.rank) + '</span></td><td><b class="table-team">' + esc(row.team) + '</b><small>' + esc(row.division) + '</small></td><td>' + esc([row.wins ?? "—",row.losses ?? "—",row.ties ?? "—"].join("–")) + '</td><td>' + num(row.wp) + '</td><td>' + num(row.ap) + '</td><td>' + num(row.sp) + '</td><td>' + num(row.averagePoints) + '</td><td>' + num(row.highScore) + '</td></tr>'
    ).join("") || '<tr><td colspan="8" class="table-empty">' + (divisionFeedComplete("rankings") ? "No published rankings match this filter." : "Rankings are unavailable from one or more VEX division feeds. No ranking is inferred.") + '</td></tr>';
  }


  function renderSeasonSnapshot() {
    const data = legacy?.seasonSnapshot;
    const body = $("#season-table");
    if (!body) return;
    if (!data?.metrics?.length) {
      body.innerHTML = '<tr><td colspan="10" class="table-empty">No historical season baseline is available.</td></tr>';
      return;
    }
    const search = ($("#season-search")?.value || "").trim().toLowerCase();
    const tier = $("#season-tier")?.value || "";
    const sort = $("#season-sort")?.value || "ccwm";
    const rows = data.metrics.filter(row =>
      (!tier || row.tier === tier) &&
      (!search || row.team.toLowerCase().includes(search))
    ).sort((a,b) => sort === "team" ? a.team.localeCompare(b.team,undefined,{numeric:true}) : (Number(b[sort]) - Number(a[sort])));
    body.innerHTML = rows.map(row =>
      '<tr><td><b class="table-team">' + esc(row.team) + '</b></td><td>' + row.w + '–' + row.l + '–' + row.t + '</td><td>' + (row.w + row.l + row.t) + '</td><td>' + num(row.win) + '%</td><td>' + num(row.forAvg) + '</td><td>' + num(row.againstAvg) + '</td><td>' + signed(row.margin) + '</td><td><b>' + signed(row.ccwm) + '</b></td><td><span class="confidence-tag ' + esc(row.confidence.toLowerCase()) + '">' + esc(row.confidence) + '</span></td><td><span class="tier-tag tier-' + esc(row.tier.toLowerCase()) + '">' + esc(row.tier) + '</span></td></tr>'
    ).join("") || '<tr><td colspan="10" class="table-empty">No teams match these filters.</td></tr>';
    $("#season-count").textContent = rows.length + " of " + data.metrics.length + " teams · Source: " + data.source + " · Checked " + data.checked + ". " + data.note;
    const renderBars = (target, key, formatter) => {
      const top = [...data.metrics].sort((a,b) => b[key] - a[key]).slice(0,8);
      const max = Math.max(1,...top.map(row => Math.abs(row[key])));
      $(target).innerHTML = top.map(row => {
        const value = Number(row[key]);
        const width = Math.max(3,Math.abs(value) / max * 100);
        return '<div class="season-bar-row"><b>' + esc(row.team) + '</b><div class="season-bar-track"><i class="' + (value < 0 ? 'negative' : 'positive') + '" style="width:' + width + '%"></i></div><strong>' + formatter(value) + '</strong></div>';
      }).join("");
    };
    renderBars("#season-ccwm-chart","ccwm",signed);
    renderBars("#season-margin-chart","margin",signed);
  }

  function renderTeams() {
    if (state.snapshot?.sourceAvailability?.teams === false) {
      $("#team-count").textContent = "Roster unavailable";
      $("#team-grid").innerHTML = '<div class="empty-state">The official VEX team roster could not be loaded. This does not mean the event has zero registered teams.</div>';
      return;
    }
    const search = $("#team-search").value.trim().toLowerCase();
    const school = $("#school-filter").value;
    let teams = state.snapshot?.teams || [];
    const schools = [...new Set(teams.map(team => team.organization).filter(Boolean))].sort();
    const currentSchool = school;
    $("#school-filter").innerHTML = '<option value="">All organisations</option>' + schools.map(name =>
      '<option value="' + esc(name) + '"' + (name === currentSchool ? " selected" : "") + '>' + esc(name) + '</option>'
    ).join("");
    const stats = statLookup();
    const filtered = teams.filter(team =>
      (!school || team.organization === school) &&
      (!search || [team.number,team.team_name,team.organization].join(" ").toLowerCase().includes(search))
    );
    $("#team-count").textContent = filtered.length + " of " + teams.length + " teams";
    $("#team-grid").innerHTML = filtered.map(team => {
      const row = stats.get(String(team.number)) || {};
      const statline = row.rank != null ? "Rank #" + row.rank : row.scoredMatches ? resultRecord(row) : "No scored match stats yet";
      const historyCount = (row.eventHistory || []).length;
      return '<button type="button" class="team-card" data-team="' + esc(team.number) + '"><span class="team-card-top"><span class="team-code">' + esc(team.number) + '</span><span class="team-arrow">↗</span></span><b class="team-school">' + esc(teamName(team)) + '</b><span class="team-card-bottom"><span>' + esc(statline) + '</span><span>' + historyCount + ' season event' + (historyCount === 1 ? "" : "s") + '</span></span></button>';
    }).join("") || '<div class="empty-state">No teams match your search.</div>';
  }

  function renderSkills() {
    const board = state.snapshot?.skills || [];
    $("#skills-table").innerHTML = state.snapshot?.sourceAvailability?.skills === false
      ? '<div class="empty-state">The VEX skills feed is unavailable. No scores have been inferred.</div>'
      : board.length ? board.map((row,index) =>
      '<div class="skills-row"><span class="rank-number">' + (index+1) + '</span><b>' + esc(row.team) + '<small>' + esc(row.name || "Team") + '</small></b><span>' + num(row.driver) + '<small>Driver</small></span><span>' + num(row.programming) + '<small>Programming</small></span><strong>' + num(row.total) + '<small>Total</small></strong></div>'
    ).join("") : '<div class="empty-state">No skills scores have been posted. That is different from a zero score.</div>';
    const awards = state.snapshot?.awards || [];
    $("#awards-list").innerHTML = state.snapshot?.sourceAvailability?.awards === false
      ? '<div class="empty-state">The VEX awards feed is unavailable. No awards have been inferred.</div>'
      : awards.length ? awards.map(award =>
      '<div class="award-row"><span class="award-icon">✦</span><div><b>' + esc(award.title) + '</b><small>' + esc([award.classification,award.designation].filter(Boolean).join(" · ") || "Official event award") + '</small><small>' + esc((award.teams || []).join(", ") || (award.individuals || []).join(", ") || "Winner details pending") + '</small></div></div>'
    ).join("") : '<div class="empty-state">No awards have been posted by VEX yet.</div>';
  }

  function renderSources() {
    const sources = legacy?.sources || [];
    $("#archive-sources").innerHTML = sources.length ? sources.map(source =>
      '<a href="' + esc(source.url) + '" target="_blank" rel="noopener"><b>' + esc(source.name) + '</b><small>' + esc(source.date) + ' · third-party archive</small></a>'
    ).join("") : '<span class="muted">No legacy archive links available.</span>';
    const snapshot = state.snapshot;
    if (!snapshot) {
      $("#source-health").textContent = "Live source has not been connected yet.";
      return;
    }
    const history = snapshot.seasonHistory || {};
    $("#source-health").textContent =
      "Last successful pull: " + dateTime(snapshot.fetchedAt) +
      " · VEX teams: " + snapshot.teams.length +
      " · matches: " + snapshot.matches.length +
      " · season-history checks: " + (history.checkedTeams || 0) + "/" + (history.totalTeams || 0) +
      " · source warnings: " + (snapshot.sourceErrors || []).length + ".";
  }

  function renderLegacyPreview() {
    if (!legacy) return;
    const oldTeams = legacy.teams || [];
    $("#metric-teams").textContent = num(oldTeams.length);
    $("#metric-teams-note").textContent = "Saved roster notes · not live verified";
    $("#metric-matches").textContent = "—";
    $("#metric-matches-note").textContent = "Waiting for official match feed";
    $("#metric-skills").textContent = "—";
    $("#metric-skills-note").textContent = "Waiting for official skills feed";
    $("#metric-awards").textContent = "—";
    $("#metric-awards-note").textContent = "Waiting for official awards";
    $("#team-count").textContent = oldTeams.length + " saved roster notes";
    $("#team-grid").innerHTML = oldTeams.map(team =>
      '<article class="team-card legacy-card"><span class="team-card-top"><span class="team-code">' + esc(team.id) + '</span><span class="legacy-tag">ARCHIVE</span></span><b class="team-school">' + esc(team.school) + '</b><span class="team-card-bottom"><span>Past result notes only</span><span>Unverified live</span></span></article>'
    ).join("");
    $("#up-next-list").innerHTML = '<div class="empty-state">The official VEX feed is not connected, so no live fixtures are shown.</div>';
    $("#top-rankings").innerHTML = '<div class="empty-state">Waiting for VEX rankings.</div>';
    $("#top-skills").innerHTML = '<div class="empty-state">Waiting for VEX skills scores.</div>';
    $("#match-table").innerHTML = '<tr><td colspan="6" class="table-empty">Live data not connected.</td></tr>';
    $("#ranking-table").innerHTML = '<tr><td colspan="8" class="table-empty">Live data not connected.</td></tr>';
    $("#skills-table").innerHTML = '<div class="empty-state">Live skills data not connected.</div>';
    $("#awards-list").innerHTML = '<div class="empty-state">Live awards data not connected.</div>';
    renderSeasonSnapshot();
    renderIntelligence();
    $("#overview-caption").textContent = "Saved roster preview · no live data";
    renderSources();
  }

  function openTeam(number) {
    const team = teamLookup().get(String(number));
    const stat = statLookup().get(String(number));
    if (!team) return;
    const history = stat?.eventHistory || [];
    const seasonRow = legacy?.seasonSnapshot?.metrics?.find(row => row.team === String(number));
    const seasonContextMarkup = seasonRow
      ? '<div class="dialog-section"><h3>Earlier-season scouting context</h3><div class="metric-pair"><span>Season record</span><b>' + seasonRow.w + "–" + seasonRow.l + "–" + seasonRow.t + '</b></div><div class="metric-pair"><span>Win rate</span><b>' + num(seasonRow.win) + '%</b></div><div class="metric-pair"><span>Average margin</span><b>' + signed(seasonRow.margin) + '</b></div><div class="metric-pair"><span>CCWM · third-party metric</span><b>' + signed(seasonRow.ccwm) + '</b></div><div class="metric-pair"><span>Threat tier / confidence</span><b>' + esc(seasonRow.tier) + " / " + esc(seasonRow.confidence) + '</b></div><p class="dialog-muted">VEX Tracker snapshot checked 2 Nov 2026. Historical preparation context only; not a current States result or official VEX ranking.</p></div>'
      : '';
    const historyMarkup = history.length ? history.map(event =>
      '<div class="history-row"><b>' + esc(dateOnly(event.start)) + '</b><span>' + esc(event.name) + '</span><a href="' + esc(event.url || "#") + '" target="_blank" rel="noopener">VEX ↗</a></div>'
    ).join("") : state.snapshot.seasonHistory?.uncheckedTeams?.includes(String(number))
      ? '<p class="dialog-muted">Season event history could not be checked for this team.</p>'
      : '<p class="dialog-muted">No other current-season event appearances were returned by the VEX team history query.</p>';
    $("#dialog-title").textContent = team.number + (team.team_name ? " · " + team.team_name : "");
    $("#dialog-body").innerHTML =
      '<p class="dialog-school">' + esc(team.organization || "Organisation not listed") + '</p>' +
      '<div class="dialog-stats">' +
      '<div><small>EVENT RANK</small><b>' + num(stat?.rank) + '</b></div>' +
      '<div><small>W–L–T</small><b>' + esc(stat ? resultRecord(stat) : "—") + '</b></div>' +
      '<div><small>WIN RATE</small><b>' + (stat?.winRate == null ? "—" : num(stat.winRate) + "%") + '</b></div>' +
      '<div><small>SKILLS TOTAL</small><b>' + num(stat?.skillsTotal) + '</b></div>' +
      '</div>' +
      '<div class="dialog-section"><h3>Event match context</h3><div class="metric-pair"><span>Scored matches</span><b>' + num(stat?.scoredMatches) + '</b></div><div class="metric-pair"><span>Alliance points for / match</span><b>' + num(stat?.allianceForAvg) + '</b></div><div class="metric-pair"><span>Alliance points against / match</span><b>' + num(stat?.allianceAgainstAvg) + '</b></div><div class="metric-pair"><span>Alliance score differential</span><b>' + signed(stat?.allianceDiffAvg) + '</b></div><p class="dialog-muted">Alliance scores are shared scores. They describe the match context for the team, not this robot&#39;s individual point contribution.</p></div>' +
      '<div class="dialog-section"><h3>Skills runs</h3><div class="metric-pair"><span>Best driver</span><b>' + num(stat?.driverSkills) + '</b></div><div class="metric-pair"><span>Best programming</span><b>' + num(stat?.programmingSkills) + '</b></div><div class="metric-pair"><span>Combined total</span><b>' + num(stat?.skillsTotal) + '</b></div></div>' +
      seasonContextMarkup + '<div class="dialog-section"><h3>2026–27 season appearances</h3>' + historyMarkup + '</div>';
    const dialog = $("#team-dialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open","");
  }


  const OBSERVATION_KEY = "1831m-override-observations-v1";
  function readObservations() {
    try { return JSON.parse(localStorage.getItem(OBSERVATION_KEY) || "[]"); } catch { return []; }
  }
  function saveObservations(rows) {
    try { localStorage.setItem(OBSERVATION_KEY, JSON.stringify(rows)); return true; } catch { return false; }
  }
  function renderIntelligence() {
    const baseline = legacy?.seasonSnapshot?.metrics || [];
    const stats = state.snapshot?.stats || [];
    const byNumber = new Map(stats.map(row => [String(row.number),row]));
    const observations = readObservations();
    const signals = [];
    for (const base of baseline) {
      const live = byNumber.get(String(base.team));
      if (!live || !live.scoredMatches) continue;
      const expected = Number(base.forAvg);
      const actual = Number(live.allianceForAvg);
      const diff = actual - expected;
      if (live.scoredMatches >= 2 && diff <= -15) signals.push({team:base.team,level:"warning",title:"Below historical scoring baseline",detail:"Current event alliance average " + actual.toFixed(1) + " vs historical " + expected.toFixed(1) + " (−" + Math.abs(diff).toFixed(1) + "). Watch another match before concluding decline."});
      else if (live.scoredMatches >= 2 && diff >= 15) signals.push({team:base.team,level:"positive",title:"Above historical scoring baseline",detail:"Current event alliance average " + actual.toFixed(1) + " vs historical " + expected.toFixed(1) + " (+" + diff.toFixed(1) + "). Possible emerging threat; inspect robot contribution."});
      if (live.scoredMatches >= 3 && live.winRate != null && live.winRate < Math.max(20,base.win-30)) signals.push({team:base.team,level:"warning",title:"Results lag historical win rate",detail:"Current event win rate " + live.winRate.toFixed(1) + "% vs season baseline " + base.win + "%. Check match strength and alliance context."});
    }
    // Compare recent alliance outcomes with earlier outcomes for each team.
    const matchRows = (state.snapshot?.matches || []).filter(m=>m.scored);
    for (const base of baseline) {
      const rows = matchRows.filter(m=>(m.redTeams||[]).includes(String(base.team)) || (m.blueTeams||[]).includes(String(base.team)));
      if (rows.length < 6) continue;
      const outcomes = rows.map(m=>{
        const red=(m.redTeams||[]).includes(String(base.team));
        const own=Number(red?m.redScore:m.blueScore), opp=Number(red?m.blueScore:m.redScore);
        return Number.isFinite(own)&&Number.isFinite(opp)?own:null;
      }).filter(v=>v!=null);
      if(outcomes.length<6) continue;
      const prior=outcomes.slice(-6,-3), recent=outcomes.slice(-3);
      const priorAvg=prior.reduce((a,b)=>a+b,0)/prior.length, recentAvg=recent.reduce((a,b)=>a+b,0)/recent.length;
      const delta=recentAvg-priorAvg;
      if(delta>=12) signals.push({team:base.team,level:"positive",title:"Recent scoring trend rising",detail:"Last 3 alliance scores average "+recentAvg.toFixed(1)+" vs "+priorAvg.toFixed(1)+" across the previous 3 (+"+delta.toFixed(1)+"). Shared alliance scores; verify individual contribution."});
      if(delta<=-12) signals.push({team:base.team,level:"warning",title:"Recent scoring trend falling",detail:"Last 3 alliance scores average "+recentAvg.toFixed(1)+" vs "+priorAvg.toFixed(1)+" across the previous 3 ("+delta.toFixed(1)+"). Check match context before judging robot decline."});
    }
    const signalBox=$("#intel-signals");
    signalBox.innerHTML=signals.length ? signals.sort((a,b)=>(a.level==="warning"?0:1)-(b.level==="warning"?0:1)).slice(0,12).map(s=>'<div class="intel-item '+s.level+'"><div><b>'+esc(s.team)+' · '+esc(s.title)+'</b><p>'+esc(s.detail)+'</p></div></div>').join("") : '<div class="empty-state">'+(state.snapshot ? "No significant baseline deviation detected yet. This is not proof that teams are performing as expected." : "Live results are not connected yet. Historical watch priorities are still available below.")+'</div>';
    const watch = [...baseline].sort((a,b)=>({S:0,A:1,B:2,C:3}[a.tier]-({S:0,A:1,B:2,C:3}[b.tier]))).slice(0,8);
    $("#watchlist").innerHTML=watch.map(row=>{
      const live=byNumber.get(String(row.team));
      const obs=observations.filter(o=>o.team===row.team).length;
      const liveText=live?.scoredMatches ? " · "+live.scoredMatches+" live matches, "+(live.allianceForAvg==null?"—":live.allianceForAvg.toFixed(1))+" avg alliance points" : " · No live match evidence yet";
      return '<div class="watch-row"><div><b>'+esc(row.team)+'</b><small>Tier '+esc(row.tier)+' · '+esc(row.confidence)+' confidence'+esc(liveText)+'</small></div><span>'+obs+' scout note'+(obs===1?"":"s")+'</span></div>';
    }).join("") || '<div class="empty-state">No baseline teams loaded.</div>';
    const select=$("#observation-team");
    if(select) {
      const current=select.value;
      const teams=state.snapshot?.teams || (legacy?.teams || []).map(t=>({number:t.id,organization:t.school}));
      select.innerHTML='<option value="">Choose a team</option>'+teams.map(t=>'<option value="'+esc(t.number)+'">'+esc(t.number)+' · '+esc(t.organization||"")+'</option>').join("");
      select.value=current;
    }
    const list=$("#observation-list");
    if(list) list.innerHTML=observations.length ? [...observations].reverse().slice(0,30).map(o=>'<div class="observation-row"><div><b>'+esc(o.team)+' · '+esc(o.category)+' · '+esc(o.rating)+'</b><small>'+esc(new Date(o.createdAt).toLocaleString("en-AU"))+'</small><p>'+esc(o.notes)+'</p></div></div>').join("") : '<div class="empty-state">No human scouting observations recorded yet.</div>';
  }

  function setupControls() {
    document.querySelectorAll(".nav-tab").forEach(button => button.addEventListener("click", () => {
      document.querySelectorAll(".nav-tab,.view").forEach(element => element.classList.remove("active"));
      button.classList.add("active");
      $("#" + button.dataset.view).classList.add("active");
      window.scrollTo({top:document.querySelector(".section-nav").offsetTop - 12,behavior:"smooth"});
    }));
    document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => {
      const target = button.dataset.go;
      const nav = document.querySelector('.nav-tab[data-view="' + target + '"]');
      if (nav) nav.click();
    }));
    $("#refresh-button").addEventListener("click",() => refresh(true));
    $("#observation-form").addEventListener("submit",event=>{event.preventDefault();const team=$("#observation-team").value;const notes=$("#observation-notes").value.trim();if(!team||!notes)return;const rows=readObservations();rows.push({team,category:$("#observation-category").value,rating:$("#observation-rating").value,notes,createdAt:new Date().toISOString()});if(!saveObservations(rows)){showAlert("Could not save the observation in this browser. Check available storage.","warning");return;}$("#observation-notes").value="";renderIntelligence();});
    $("#match-filters").addEventListener("click",event => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      state.matchFilter = button.dataset.filter;
      document.querySelectorAll(".filter-pill").forEach(pill => pill.classList.toggle("active",pill === button));
      renderMatches();
    });
    $("#division-filter").addEventListener("change",renderMatches);
    $("#ranking-division").addEventListener("change",renderRankings);
    $("#ranking-search").addEventListener("input",renderRankings);
    $("#season-search").addEventListener("input",renderSeasonSnapshot);
    $("#season-tier").addEventListener("change",renderSeasonSnapshot);
    $("#season-sort").addEventListener("change",renderSeasonSnapshot);
    $("#team-search").addEventListener("input",renderTeams);
    $("#observation-team").addEventListener("focus",renderIntelligence);
    $("#school-filter").addEventListener("change",renderTeams);
    $("#team-grid").addEventListener("click",event => {
      const button = event.target.closest("[data-team]");
      if (button) openTeam(button.dataset.team);
    });
    $("#dialog-close").addEventListener("click",() => $("#team-dialog").close());
    $("#team-dialog").addEventListener("click",event => {
      if (event.target === $("#team-dialog")) $("#team-dialog").close();
    });
  }

  function boot() {
    setupControls();
    const cached = loadSnapshot();
    if (cached?.snapshot) {
      applySnapshot(cached.snapshot,{stale:true});
      $("#status-message").textContent = "Showing a saved copy from " + dateTime(cached.snapshot.fetchedAt) + " while checking for updates.";
    } else if (legacy) {
      renderLegacyPreview();
      setConnection("waiting","Waiting for the official feed","The saved roster preview is historical only; it is not being represented as live VEX data.");
    }
    refresh(false);
    window.setInterval(() => {
      if (document.visibilityState === "visible") refresh(false);
    },POLL_MS);
    document.addEventListener("visibilitychange",() => {
      if (document.visibilityState === "visible") refresh(false);
    });
  }

  boot();
})();
