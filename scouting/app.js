import { buildWatchlistScheduleRows, summarizeWatchlistCoverage, getWatchlistScheduleEmptyMessage } from "./watchlist.mjs";

(() => {
  "use strict";

  const buildWatchlistRows = buildWatchlistScheduleRows;

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
    renderHistoricalEvents();
    renderHistoricalProfiles();
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
    const query=$("#match-search").value.trim().toLowerCase();
    if(query) matches=matches.filter(match=>[match.name,match.roundLabel,match.division,match.field,...(match.redTeams||[]),...(match.blueTeams||[])].join(" ").toLowerCase().includes(query));
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

  function renderHistoricalProfiles() {
    const teams = legacy?.teams || [];
    const metrics = new Map((legacy?.seasonSnapshot?.metrics || []).map(row => [String(row.team),row]));
    const query = ($("#historical-profile-search")?.value || "").trim().toLowerCase();
    const tier = $("#historical-profile-tier")?.value || "";
    const profiles = teams.filter(team => {
      const profile = team.dossier;
      return profile && (!tier || profile.tier === tier) &&
        (!query || [team.id,team.school,profile.displayName,profile.read,profile.scoutFocus].join(" ").toLowerCase().includes(query));
    }).sort((a,b) => {
      const rank = {S:0,A:1,B:2,C:3};
      return rank[a.dossier.tier]-rank[b.dossier.tier] || (metrics.get(b.id)?.ccwm ?? -999)-(metrics.get(a.id)?.ccwm ?? -999);
    });
    const target = $("#historical-profiles");
    if (!target) return;
    const metric = (label,value) => '<div><small>'+label+'</small><b>'+value+'</b></div>';
    target.innerHTML = profiles.map(team => {
      const p=team.dossier, m=metrics.get(team.id);
      const matches=m ? m.w+m.l+m.t : null;
      const record=m ? [m.w,m.l,m.t].join("–") : "—";
      const confidence=m?.confidence || "Unrated";
      const pinned=readPinnedTeams().includes(team.id);
      const eventRows=(team.events||[]).map(e=>{
        const source=(legacy?.sources||[]).find(s=>s.id===e.event);
        if(!source)return "";
        const stats=[e.rank!=null?"Rank #"+e.rank:null,e.wp!=null?"WP "+e.wp:null,e.ap!=null?"AP "+e.ap:null,e.skills!=null?"Skills "+e.skills+" ("+num(e.driver)+"D / "+num(e.auton)+"P)":null].filter(Boolean).join(" · ");
        return '<div class="profile-event-row"><b>'+esc(source.date)+'</b><span><strong>'+esc(source.name)+'</strong><small>'+esc(e.record||"—")+(stats?" · "+esc(stats):"")+'</small></span><a href="'+esc(source.url)+'" target="_blank" rel="noopener">Source ↗</a></div>';
      }).join("");
      return '<details class="dossier-profile"><summary class="dossier-profile-summary"><div class="dossier-profile-head"><div><span class="team-code">'+esc(team.id)+'</span><b>'+esc(p.displayName)+'</b><small>'+esc(team.school)+'</small></div><span class="tier-tag tier-'+esc(p.tier.toLowerCase())+'">'+esc(p.tier)+' PRIORITY</span></div>'+
        '<div class="dossier-profile-metrics">'+metric("RECORD",record)+metric("MATCHES",num(matches))+metric("WIN RATE",m?num(m.win)+"%":"—")+metric("AVG MARGIN",m?signed(m.margin):"—")+metric("CCWM",m?signed(m.ccwm):"—")+metric("CONFIDENCE",esc(confidence))+metric("OPR",p.opr==null?"—":num(p.opr))+metric("DPR",p.dpr==null?"—":num(p.dpr))+'</div><span class="profile-expand-hint">Open full scouting report <span aria-hidden="true">＋</span></span></summary>'+
        '<div class="dossier-profile-expanded"><div class="dossier-profile-copy"><b>Statistical assessment</b><p>'+esc(p.read)+'</p><b>What to scout</b><p>'+esc(p.scoutFocus)+'</p></div>'+
        (eventRows?'<div class="profile-event-list"><b>Archived event appearances in this dossier</b>'+eventRows+'</div>':'<p class="fine-print">No archived event row is attached to this profile.</p>')+
        '<div class="profile-actions"><button type="button" class="secondary-button" data-profile-compare="'+esc(team.id)+'">Compare team</button><button type="button" class="secondary-button" data-profile-pin="'+esc(team.id)+'">'+(pinned?"Pinned to watchlist":"Add to watchlist")+'</button><button type="button" class="secondary-button" data-profile-observe="'+esc(team.id)+'">Record observation</button><a class="source-link" href="'+esc(p.profileUrl)+'" target="_blank" rel="noopener">Open VEX Tracker profile ↗</a></div></div></details>';
    }).join("") || '<div class="empty-state">No team profiles match these filters.</div>';
    const count=$("#historical-profile-count");
    if(count) count.textContent=profiles.length+" of "+teams.filter(t=>t.dossier).length+" team profiles";
  }

  function renderHistoricalEvents() {
    const teams = legacy?.teams || [];
    const eventMap = new Map((legacy?.sources || []).map(source => [source.id, source]));
    const rows = teams.flatMap(team => (team.events || []).map(event => ({
      team, event, source: eventMap.get(event.event)
    }))).filter(row => row.source);
    const search = ($("#historical-event-search")?.value || "").trim().toLowerCase();
    const eventFilter = $("#historical-event-filter")?.value || "";
    const filtered = rows.filter(row =>
      (!eventFilter || row.event.event === eventFilter) &&
      (!search || [row.team.id,row.team.school,row.source.name].join(" ").toLowerCase().includes(search))
    ).sort((a,b) => a.source.date.localeCompare(b.source.date) || String(a.team.id).localeCompare(String(b.team.id),undefined,{numeric:true}));
    const filter = $("#historical-event-filter");
    if (filter) {
      const current = filter.value;
      filter.innerHTML = '<option value="">All archived events</option>' + (legacy?.sources || []).map(source =>
        '<option value="' + esc(source.id) + '"' + (source.id === current ? " selected" : "") + '>' + esc(source.name) + '</option>'
      ).join("");
    }
    const cell = value => value == null || value === "" ? "—" : esc(value);
    const body = $("#historical-event-table");
    if (body) body.innerHTML = filtered.map(row => {
      const event = row.event, qual = event.qualAlliance || {};
      return '<tr><td><b>' + esc(row.source.name) + '</b><small>' + esc(row.source.date) + '</small></td><td><b class="table-team">' + esc(row.team.id) + '</b><small>' + esc(row.team.school) + '</small></td><td>' + cell(event.rank) + '</td><td>' + cell(event.record) + '</td><td>' + cell(event.wp) + '</td><td>' + cell(event.ap) + '</td><td>' + cell(event.sp) + '</td><td>' + cell(event.skills) + '</td><td>' + cell(event.driver) + '</td><td>' + cell(event.auton) + '</td><td>' + cell(qual.forAvg == null ? null : Number(qual.forAvg).toFixed(1)) + '</td><td>' + cell(qual.againstAvg == null ? null : Number(qual.againstAvg).toFixed(1)) + '</td></tr>';
    }).join("") || '<tr><td colspan="12" class="table-empty">No archived source rows match this filter.</td></tr>';
    const count = $("#historical-event-count");
    if (count) count.textContent = filtered.length + " archived team-event rows · source-referenced, not independently re-audited";
    const links = $("#historical-source-links");
    if (links) links.innerHTML = (legacy?.sources || []).map(source =>
      '<a href="' + esc(source.url) + '" target="_blank" rel="noopener"><b>' + esc(source.name) + '</b><small>' + esc(source.date) + ' · open archived results ↗</small></a>'
    ).join("") || '<span class="muted">No archived event links available.</span>';
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
      " · source warnings: " + (snapshot.sourceErrors || []).length +
      ((snapshot.sourceRecoveries || []).length ? " · recovered feeds: " + snapshot.sourceRecoveries.map(item=>item.source+" ("+item.count+")").join(", ") : "") + ".";
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
    renderHistoricalEvents();
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


  const WATCHLIST_KEY = "1831m-override-watchlist-v1";
  function readPinnedTeams() {
    try {
      const value=JSON.parse(localStorage.getItem(WATCHLIST_KEY)||"[]");
      return Array.isArray(value)?[...new Set(value.map(String))].slice(0,24):[];
    } catch { return []; }
  }
  function savePinnedTeams(teams) {
    try { localStorage.setItem(WATCHLIST_KEY,JSON.stringify([...new Set(teams.map(String))].slice(0,24)));return true; }
    catch { return false; }
  }
  const OBSERVATION_KEY = "1831m-override-observations-v1";
  function readObservations() {
    try { return JSON.parse(localStorage.getItem(OBSERVATION_KEY) || "[]"); } catch { return []; }
  }
  function saveObservations(rows) {
    try { localStorage.setItem(OBSERVATION_KEY, JSON.stringify(rows)); return true; } catch { return false; }
  }
  function buildWatchlistScheduleRows() {
    return buildWatchlistRows(
      state.snapshot?.matches || [],
      readPinnedTeams(),
      legacy?.seasonSnapshot?.metrics || []
    );
  }

  function renderWatchlistSchedule() {
    const target=$("#watchlist-schedule");
    if(!target) return;
    const pinned=readPinnedTeams();
    const matches=state.snapshot?.matches || [];
    const baseline=legacy?.seasonSnapshot?.metrics || [];
    const rows=buildWatchlistScheduleRows();
    const coverage=summarizeWatchlistCoverage(matches,pinned,baseline);
    const heading=pinned.length
      ? pinned.length+" manually pinned team(s)"
      : "Top historical S/A priorities (pin teams to customise)";
    const missingText=coverage.unscheduledTeams.length
      ? " · Not yet scheduled: "+coverage.unscheduledTeams.slice(0,6).join(", ")+(coverage.unscheduledTeams.length>6?" +"+(coverage.unscheduledTeams.length-6)+" more":"")
      : "";
    const coverageText=coverage.priorityTeams
      ? coverage.scheduledTeams+"/"+coverage.priorityTeams+" priority teams scheduled · "+coverage.priorityMatchups+" priority-vs-priority fixture(s)"+missingText
      : "No priority teams available";
    $("#watchlist-schedule-caption").textContent=heading+" · "+rows.length+" upcoming fixture(s) · "+coverageText;
    target.innerHTML=rows.length
      ? '<div class="table-scroll"><table class="watch-schedule-table"><thead><tr><th>Match</th><th>Division / field</th><th>Teams to watch</th><th>Red alliance</th><th>Blue alliance</th><th>Scheduled</th></tr></thead><tbody>'+rows.map(row=>
        '<tr><td><b>'+esc(row.match)+'</b><small>'+esc(row.focus)+'</small></td><td>'+esc(row.division)+(row.field?' · Field '+esc(row.field):'')+'</td><td><b>'+esc(row.watched.join(", "))+'</b><small>'+esc(row.source)+'</small></td><td class="red-cell">'+esc(row.red.join(" · ")||"—")+'</td><td class="blue-cell">'+esc(row.blue.join(" · ")||"—")+'</td><td>'+esc(row.scheduled?dateTime(row.scheduled):"Time TBC")+'</td></tr>'
      ).join("")+'</tbody></table></div>'
      : '<div class="empty-state">'+esc(getWatchlistScheduleEmptyMessage(matches,rows))+'</div>';
  }

  function exportWatchlistSchedule() {
    const rows=buildWatchlistScheduleRows();
    const output=[["Match","Division","Field","Scheduled","Watched teams","Focus alliance","Red alliance","Blue alliance","Priority source"]];
    rows.forEach(row=>output.push([row.match,row.division,row.field,row.scheduled,row.watched.join("; "),row.focus,row.red.join("; "),row.blue.join("; "),row.source]));
    downloadCsv("1831M-watchlist-fixture-plan.csv",output);
    showAlert(rows.length+" watchlist fixture(s) exported.","info");
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
        return m.redScore!=null&&m.blueScore!=null&&Number.isFinite(own)&&Number.isFinite(opp)?own:null;
      }).filter(v=>v!=null);
      if(outcomes.length<6) continue;
      const prior=outcomes.slice(-6,-3), recent=outcomes.slice(-3);
      const priorAvg=prior.reduce((a,b)=>a+b,0)/prior.length, recentAvg=recent.reduce((a,b)=>a+b,0)/recent.length;
      const delta=recentAvg-priorAvg;
      if(delta>=12) signals.push({team:base.team,level:"positive",title:"Recent scoring trend rising",detail:"Last 3 alliance scores average "+recentAvg.toFixed(1)+" vs "+priorAvg.toFixed(1)+" across the previous 3 (+"+delta.toFixed(1)+"). Shared alliance scores; verify individual contribution."});
      if(delta<=-12) signals.push({team:base.team,level:"warning",title:"Recent scoring trend falling",detail:"Last 3 alliance scores average "+recentAvg.toFixed(1)+" vs "+priorAvg.toFixed(1)+" across the previous 3 ("+delta.toFixed(1)+"). Check match context before judging robot decline."});
    }
    for (const observation of observations.slice(-20)) {
      signals.push({team:observation.team,level:observation.rating==="Weak"?"warning":(["Strong","Effective"].includes(observation.rating)?"positive":"neutral"),title:"Human scout observation · "+observation.category,detail:observation.rating+" assessment: "+observation.notes});
    }
    const signalBox=$("#intel-signals");
    signalBox.innerHTML=signals.length ? signals.sort((a,b)=>(a.level==="warning"?0:1)-(b.level==="warning"?0:1)).slice(0,12).map(s=>'<div class="intel-item '+s.level+'"><div><b>'+esc(s.team)+' · '+esc(s.title)+'</b><p>'+esc(s.detail)+'</p></div></div>').join("") : '<div class="empty-state">'+(state.snapshot ? "No significant baseline deviation detected yet. This is not proof that teams are performing as expected." : "Live results are not connected yet. Historical watch priorities are still available below.")+'</div>';
    const watch = [...baseline].sort((a,b)=>({S:0,A:1,B:2,C:3}[a.tier]-({S:0,A:1,B:2,C:3}[b.tier]))).slice(0,8);
    $("#watchlist").innerHTML=watch.map(row=>{
      const live=byNumber.get(String(row.team));
      const teamNotes=observations.filter(o=>o.team===row.team);
      const obs=teamNotes.length;
      const liveText=live?.scoredMatches ? " · "+live.scoredMatches+" live matches, "+(live.allianceForAvg==null?"—":live.allianceForAvg.toFixed(1))+" avg alliance points" : " · No live match evidence yet";
      const reason=row.ccwm>=20?"High historical CCWM and strong season signal":row.win>=70?"High historical win rate":row.margin>=15?"Strong historical average margin":row.confidence==="Low"?"Low sample confidence — verify with more observations":"Worth checking against current robot performance";
      const humanText=teamNotes.length?" · Latest scout note: "+teamNotes[teamNotes.length-1].category+" ("+teamNotes[teamNotes.length-1].rating+")":" · No human observations yet";
      return '<div class="watch-row"><div><b>'+esc(row.team)+'</b><small>Tier '+esc(row.tier)+' · '+esc(row.confidence)+' confidence · '+esc(reason)+esc(liveText)+esc(humanText)+'</small></div><span>'+obs+' scout note'+(obs===1?"":"s")+'</span></div>';
    }).join("") || '<div class="empty-state">No baseline teams loaded.</div>';
    const watchSelect=$("#watchlist-team");
    if(watchSelect) {
      const current=watchSelect.value;
      const roster=state.snapshot?.teams || baseline.map(row=>({number:row.team,organization:"Historical baseline"}));
      watchSelect.innerHTML='<option value="">Choose a team</option>'+roster.map(team=>'<option value="'+esc(team.number)+'">'+esc(team.number)+' · '+esc(team.organization||"")+'</option>').join("");
      watchSelect.value=current;
    }
    const pinned=readPinnedTeams();
    const pinnedBox=$("#watchlist-pinned");
    if(pinnedBox) pinnedBox.innerHTML=pinned.length?pinned.map(number=>{
      const team=teamLookup().get(number);
      const live=byNumber.get(number);
      const base=baseline.find(row=>String(row.team)===number);
      const detail=[team?.organization,base?"Tier "+base.tier+" baseline":null,live?.scoredMatches?live.scoredMatches+" live matches":null].filter(Boolean).join(" · ")||"Manually pinned for field observation";
      return '<div class="watch-row pinned-watch"><div><b>'+esc(number)+'</b><small>'+esc(detail)+'</small></div><button class="watch-remove" type="button" data-watch-remove="'+esc(number)+'" aria-label="Remove '+esc(number)+' from watchlist">Remove</button></div>';
    }).join(""):'<div class="empty-state">No manually pinned teams yet. Pin teams you want scouts to prioritise.</div>';
    const select=$("#observation-team");
    if(select) {
      const current=select.value;
      const teams=state.snapshot?.teams || (legacy?.teams || []).map(t=>({number:t.id,organization:t.school}));
      select.innerHTML='<option value="">Choose a team</option>'+teams.map(t=>'<option value="'+esc(t.number)+'">'+esc(t.number)+' · '+esc(t.organization||"")+'</option>').join("");
      select.value=current;
    }
    const list=$("#observation-list");
    if(list) list.innerHTML=observations.length ? observations.map((o,index)=>({...o,_index:index})).reverse().slice(0,30).map(o=>'<div class="observation-row"><div class="observation-row-main"><b>'+esc(o.team)+' · '+esc(o.category)+' · '+esc(o.rating)+'</b><small>'+esc(new Date(o.createdAt).toLocaleString("en-AU"))+(o.scout?' · Scout '+esc(o.scout):"")+'</small><p>'+esc(o.notes)+'</p></div><button class="note-delete" type="button" data-delete-observation="'+o._index+'" aria-label="Delete observation">×</button></div>').join("") : '<div class="empty-state">No human scouting observations recorded yet.</div>';
    renderWatchlistSchedule();
    renderTeamComparison();
    renderScoutSheet();
  }



  function downloadCsv(filename, rows) {
    const csv=rows.map(row=>row.map(value=>{const text=String(value??"");return '"'+text.replace(/"/g,'""')+'"';}).join(",")).join("\r\n");
    const blob=new Blob(["\\uFEFF",csv],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
  }
  function exportMatchesCsv() {
    const division=$("#division-filter").value,query=$("#match-search").value.trim().toLowerCase();
    let matches=(state.snapshot?.matches||[]).filter(m=>!division||m.division===division);
    if(state.matchFilter==="upcoming")matches=matches.filter(m=>!m.scored);
    if(state.matchFilter==="scored")matches=matches.filter(m=>m.scored);
    if(query)matches=matches.filter(m=>[m.name,m.roundLabel,m.division,m.field,...(m.redTeams||[]),...(m.blueTeams||[])].join(" ").toLowerCase().includes(query));
    const rows=[["Match","Round","Division","Field","Scheduled","Red teams","Red score","Blue teams","Blue score","Status"],...matches.map(m=>[m.name,m.roundLabel,m.division,m.field,m.scheduled,(m.redTeams||[]).join(" + "),m.scored?m.redScore:"",(m.blueTeams||[]).join(" + "),m.scored?m.blueScore:"",m.scored?"Scored":"Not scored"])];
    downloadCsv("1831M-override-matches.csv",rows);
    showAlert(matches.length+" match row(s) exported using the current filters.","info");
  }
  function exportRankingsCsv() {
    const division=$("#ranking-division").value,query=$("#ranking-search").value.trim().toLowerCase();
    const rows=(state.snapshot?.rankings||[]).filter(r=>(!division||r.division===division)&&(!query||String(r.team).toLowerCase().includes(query)));
    downloadCsv("1831M-override-rankings.csv",[["Rank","Team","Division","Wins","Losses","Ties","WP","AP","SP","Average points","High score"],...rows.map(r=>[r.rank,r.team,r.division,r.wins,r.losses,r.ties,r.wp,r.ap,r.sp,r.averagePoints,r.highScore])]);
    showAlert(rows.length+" ranking row(s) exported using the current filters.","info");
  }


  function renderScoutSheet() {
    const select=$("#scout-match-select"),preview=$("#scout-sheet-preview");
    if(!select||!preview)return;
    const matches=state.snapshot?.matches||[];
    const current=select.value;
    select.innerHTML=matches.length?matches.map((m,index)=>'<option value="'+esc(m.id)+'">'+esc(m.name)+' · '+esc(m.division)+' · '+(m.scored?"Scored":"Not scored")+'</option>').join(""):'<option value="">No official matches available</option>';
    if(matches.some(m=>String(m.id)===current))select.value=current;
    const match=matches.find(m=>String(m.id)===select.value);
    if(!match){preview.innerHTML='<div class="empty-state">No match schedule is available to prepare a field sheet.</div>';return;}
    const teamCard=(number,alliance)=>'<div class="paper-team"><div class="paper-team-head"><b>'+esc(number)+'</b><span>'+alliance+' alliance</span></div><div class="paper-checks"><label><input type="checkbox"> Autonomous routine</label><label><input type="checkbox"> Scoring cycle / consistency</label><label><input type="checkbox"> Endgame contribution</label><label><input type="checkbox"> Driver control / decision-making</label><label><input type="checkbox"> Reliability / faults</label><label><input type="checkbox"> Alliance interaction</label></div><div class="paper-lines"><span>Observed evidence / notes</span><i></i><i></i><i></i></div></div>';
    const red=(match.redTeams||[]).map(number=>teamCard(number,"Red")).join("");
    const blue=(match.blueTeams||[]).map(number=>teamCard(number,"Blue")).join("");
    preview.innerHTML='<div class="print-sheet" id="scout-sheet-print"><div class="paper-title"><div><span>1831M · OVERRIDE 2026</span><h2>'+esc(match.name)+'</h2><p>'+esc(match.division)+(match.field?' · Field '+esc(match.field):'')+' · '+esc(dateTime(match.scheduled))+'</p></div><div class="paper-score">'+(match.scored?num(match.redScore)+' : '+num(match.blueScore):'NOT SCORED')+'</div></div><div class="paper-alliance-label">RED ALLIANCE</div><div class="paper-teams">'+(red||'<p>Teams not published</p>')+'</div><div class="paper-alliance-label blue-label">BLUE ALLIANCE</div><div class="paper-teams">'+(blue||'<p>Teams not published</p>')+'</div><div class="paper-bottom"><span>Scout: ____________________</span><span>Match outcome / key learning: ______________________________________________</span></div><p class="paper-disclaimer">Record what was observed. Do not infer individual scoring from shared alliance scores.</p></div>';
  }


  function comparisonCard(number, team, stat, baseline, notes) {
    if (!team && !baseline) return '<div class="compare-card"><div class="empty-state">No team data available.</div></div>';
    const title = number || "Unknown team";
    const wlt = stat ? resultRecord(stat) : baseline ? [baseline.w,baseline.l,baseline.t].join("–") : "—";
    const rank = stat?.rank != null ? "#" + stat.rank : "Not ranked";
    const liveMatches = stat?.scoredMatches ?? 0;
    const liveAvg = stat?.allianceForAvg == null ? "—" : stat.allianceForAvg.toFixed(1);
    const win = stat?.winRate == null ? "—" : stat.winRate.toFixed(1) + "%";
    const driver = stat?.driverSkills ?? "—";
    const programming = stat?.programmingSkills ?? "—";
    const skills = stat?.skillsTotal ?? "—";
    const notesMarkup = notes.length ? notes.slice(-3).reverse().map(note => '<div class="compare-note"><b>'+esc(note.category)+' · '+esc(note.rating)+'</b><small>'+esc(note.notes)+'</small></div>').join("") : '<small class="compare-muted">No human observations recorded</small>';
    return '<div class="compare-card"><div class="compare-team-head"><b>'+esc(title)+'</b><span>'+esc(team?.organization || team?.school || "Organisation not listed")+'</span></div><div class="compare-metrics"><div><small>EVENT RANK</small><b>'+esc(rank)+'</b></div><div><small>LIVE W–L–T</small><b>'+esc(wlt)+'</b></div><div><small>LIVE WIN RATE</small><b>'+esc(win)+'</b></div><div><small>LIVE ALLIANCE AVG</small><b>'+esc(liveAvg)+'</b></div><div><small>SCORED MATCHES</small><b>'+num(liveMatches)+'</b></div><div><small>SKILLS TOTAL</small><b>'+num(skills)+'</b></div><div><small>DRIVER / PROGRAMMING</small><b>'+num(driver)+' / '+num(programming)+'</b></div><div><small>HISTORICAL TIER</small><b>'+(baseline?esc(baseline.tier)+" · "+esc(baseline.confidence):"—")+'</b></div></div><div class="compare-notes"><b>Recent scout evidence</b>'+notesMarkup+'</div></div>';
  }

  function renderTeamComparison() {
    const a=$("#compare-team-a"), b=$("#compare-team-b"), output=$("#comparison-output");
    if(!a||!b||!output) return;
    const teams=state.snapshot?.teams?.length ? state.snapshot.teams : (legacy?.teams||[]).map(t=>({number:t.id,organization:t.school}));
    const sorted=[...teams].sort((x,y)=>String(x.number).localeCompare(String(y.number),undefined,{numeric:true}));
    const options='<option value="">Choose team</option>'+sorted.map(t=>'<option value="'+esc(t.number)+'">'+esc(t.number)+' · '+esc(t.team_name||t.organization||"")+'</option>').join("");
    const av=a.value, bv=b.value;
    a.innerHTML=options; b.innerHTML=options;
    a.value=sorted.some(t=>String(t.number)===av)?av:(sorted[0]?String(sorted[0].number):"");
    b.value=sorted.some(t=>String(t.number)===bv)?bv:(sorted[1]?String(sorted[1].number):a.value);
    const make=(number)=>{
      const team=teams.find(t=>String(t.number)===number)||null;
      const stat=statLookup().get(number)||null;
      const base=legacy?.seasonSnapshot?.metrics?.find(row=>String(row.team)===number)||null;
      const notes=readObservations().filter(o=>String(o.team)===number);
      return comparisonCard(number,team,stat,base,notes);
    };
    if(!a.value||!b.value){output.innerHTML='<div class="empty-state">The comparison needs two registered teams.</div>';return;}
    output.innerHTML=make(a.value)+make(b.value);
    if(a.value===b.value) output.insertAdjacentHTML("beforeend",'<p class="fine-print">Both selectors currently show the same team.</p>');
  }

  function exportObservations() {
    const rows=readObservations();
    const payload={format:"1831M-Override-scout-observations",version:1,exportedAt:new Date().toISOString(),observations:rows};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url;link.download="1831M-scout-observations-"+new Date().toISOString().slice(0,10)+".json";
    document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
    showAlert(rows.length+" scout observation(s) exported. Share the JSON file with the team to transfer notes between devices.","info");
  }

  async function importObservations(file) {
    if(!file) return;
    try {
      const parsed=JSON.parse(await file.text());
      const incoming=Array.isArray(parsed)?parsed:parsed?.observations;
      if(!Array.isArray(incoming)) throw new Error("This file does not contain an observation list.");
      const allowedCategories=["Robot capability","Autonomous","Reliability","Mechanism","Driver behaviour","Strategy","Alliance compatibility"];
      const allowedRatings=["Strong","Effective","Mixed","Weak","Not observed"];
      const valid=incoming.filter(o=>o&&typeof o==="object"&&String(o.team||"").trim()&&allowedCategories.includes(o.category)&&allowedRatings.includes(o.rating)&&typeof o.notes==="string"&&o.notes.trim()&&o.notes.length<=1200).map(o=>({
        team:String(o.team).slice(0,32),category:o.category,rating:o.rating,notes:o.notes.trim(),
        scout:typeof o.scout==="string"?o.scout.slice(0,32):"",
        createdAt:Number.isFinite(Date.parse(o.createdAt))?new Date(o.createdAt).toISOString():new Date().toISOString()
      }));
      if(!valid.length) throw new Error("No valid observations were found in that file.");
      const current=readObservations();
      const keys=new Set(current.map(o=>[o.team,o.category,o.rating,o.notes,o.createdAt].join("|")));
      const additions=valid.filter(o=>{const key=[o.team,o.category,o.rating,o.notes,o.createdAt].join("|");if(keys.has(key))return false;keys.add(key);return true;});
      const merged=[...current,...additions].slice(-500);
      if(!saveObservations(merged)) throw new Error("Browser storage could not save the imported notes.");
      renderIntelligence();
      showAlert(additions.length+" new observation(s) imported; "+(valid.length-additions.length)+" duplicate(s) skipped.","info");
    } catch(error) { showAlert("Import failed: "+error.message,"warning"); }
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
    $("#observation-form").addEventListener("submit",event=>{event.preventDefault();const team=$("#observation-team").value;const notes=$("#observation-notes").value.trim();if(!team||!notes)return;const rows=readObservations();rows.push({team,category:$("#observation-category").value,rating:$("#observation-rating").value,notes,scout:"",createdAt:new Date().toISOString()});if(!saveObservations(rows)){showAlert("Could not save the observation in this browser. Check available storage.","warning");return;}$("#observation-notes").value="";renderIntelligence();});
    $("#match-filters").addEventListener("click",event => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      state.matchFilter = button.dataset.filter;
      document.querySelectorAll(".filter-pill").forEach(pill => pill.classList.toggle("active",pill === button));
      renderMatches();
    });
    $("#division-filter").addEventListener("change",renderMatches);
    $("#match-search").addEventListener("input",renderMatches);
    $("#export-matches").addEventListener("click",exportMatchesCsv);
    $("#export-rankings").addEventListener("click",exportRankingsCsv);
    $("#ranking-division").addEventListener("change",renderRankings);
    $("#ranking-search").addEventListener("input",renderRankings);
    $("#season-search").addEventListener("input",renderSeasonSnapshot);
    $("#season-tier").addEventListener("change",renderSeasonSnapshot);
    $("#season-sort").addEventListener("change",renderSeasonSnapshot);
    $("#historical-profile-search").addEventListener("input",renderHistoricalProfiles);
    $("#historical-profile-tier").addEventListener("change",renderHistoricalProfiles);
    $("#historical-profiles").addEventListener("click",event=>{
      const pin=event.target.closest("[data-profile-pin]");
      const compare=event.target.closest("[data-profile-compare]");
      const observe=event.target.closest("[data-profile-observe]");
      if(pin){
        const id=pin.dataset.profilePin,current=readPinnedTeams();
        if(!current.includes(id))savePinnedTeams([...current,id]);
        renderHistoricalProfiles();renderIntelligence();
        showAlert(id+" added to your local scouting watchlist.","info");
      }else if(compare){
        const id=compare.dataset.profileCompare;
        document.querySelector('.nav-tab[data-view="intelligence"]').click();
        renderIntelligence();
        const a=$("#compare-team-a"),b=$("#compare-team-b");
        if(a.value===id)b.value=id;else if(!a.value||a.value===b.value)a.value=id;else b.value=id;
        renderTeamComparison();
      }else if(observe){
        const id=observe.dataset.profileObserve;
        document.querySelector('.nav-tab[data-view="intelligence"]').click();
        renderIntelligence();$("#observation-team").value=id;$("#observation-notes").focus();
      }
    });
    $("#historical-event-search").addEventListener("input",renderHistoricalEvents);
    $("#historical-event-filter").addEventListener("change",renderHistoricalEvents);
    $("#team-search").addEventListener("input",renderTeams);
    $("#observation-team").addEventListener("focus",renderIntelligence);
    $("#compare-team-a").addEventListener("change",renderTeamComparison);
    $("#compare-team-b").addEventListener("change",renderTeamComparison);
    $("#add-watchlist-team").addEventListener("click",()=>{
      const number=$("#watchlist-team").value;
      if(!number)return;
      const pinned=readPinnedTeams();
      if(pinned.includes(number)){showAlert(number+" is already pinned.","info");return;}
      if(!savePinnedTeams([...pinned,number])){showAlert("Could not save the watchlist in this browser.","warning");return;}
      renderIntelligence();showAlert(number+" added to the manual watchlist.","info");
    });
    $("#watchlist-pinned").addEventListener("click",event=>{
      const button=event.target.closest("[data-watch-remove]");
      if(!button)return;
      const number=button.dataset.watchRemove;
      savePinnedTeams(readPinnedTeams().filter(team=>team!==number));
      renderIntelligence();showAlert(number+" removed from the manual watchlist.","info");
    });
    $("#export-watchlist-schedule").addEventListener("click",exportWatchlistSchedule);
    $("#export-watchlist").addEventListener("click",()=>{
      const pinned=readPinnedTeams(),rows=[["Team","Organisation","Historical tier","Confidence","Live scored matches"]];
      for(const number of pinned){
        const team=teamLookup().get(number),base=(legacy?.seasonSnapshot?.metrics||[]).find(row=>String(row.team)===number),live=statLookup().get(number);
        rows.push([number,team?.organization||"",base?.tier||"",base?.confidence||"",live?.scoredMatches||0]);
      }
      downloadCsv("1831M-manual-watchlist.csv",rows);
      showAlert(pinned.length+" pinned team(s) exported.","info");
    });

    $("#scout-match-select").addEventListener("change",renderScoutSheet);
    $("#print-scout-sheet").addEventListener("click",()=>window.print());
    $("#export-observations").addEventListener("click",exportObservations);
    $("#import-observations").addEventListener("click",()=>$("#import-observations-file").click());
    $("#import-observations-file").addEventListener("change",event=>{importObservations(event.target.files?.[0]);event.target.value="";});
    $("#observation-list").addEventListener("click",event=>{const button=event.target.closest("[data-delete-observation]");if(!button)return;const index=Number(button.dataset.deleteObservation);const rows=readObservations();if(Number.isInteger(index)&&index>=0&&index<rows.length){rows.splice(index,1);saveObservations(rows);renderIntelligence();showAlert("Observation deleted from this device.","info");}});
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
