(() => {
  "use strict";

  function buildWatchlistScheduleRows(matches = [], pinnedTeams = [], baselineMetrics = []) {
    const pinned = Array.isArray(pinnedTeams)
      ? [...new Set(pinnedTeams.map(value => String(value ?? "").trim()).filter(Boolean))].slice(0, 24)
      : [];
    const priorities = pinned.length ? pinned : (Array.isArray(baselineMetrics) ? baselineMetrics : [])
      .filter(row => row && ["S", "A"].includes(row.tier) && row.team != null && String(row.team).trim())
      .sort((a, b) => ({S:0,A:1}[a.tier] - {S:0,A:1}[b.tier]) ||
        (Number(b.ccwm) || 0) - (Number(a.ccwm) || 0))
      .slice(0, 10)
      .map(row => String(row.team));
    const watched = new Set(priorities);
    return (Array.isArray(matches) ? matches : []).flatMap((match, index) => {
      if (!match || match.scored !== false) return [];
      const red = Array.isArray(match.redTeams) ? match.redTeams.map(String) : [];
      const blue = Array.isArray(match.blueTeams) ? match.blueTeams.map(String) : [];
      const redWatched = red.filter(team => watched.has(team));
      const blueWatched = blue.filter(team => watched.has(team));
      if (!redWatched.length && !blueWatched.length) return [];
      return [{
        match: match.name || "Match",
        division: match.division || "Division not listed",
        field: match.field || "",
        scheduled: match.scheduled || "",
        red,
        blue,
        watched: [...new Set([...redWatched, ...blueWatched])],
        focus: redWatched.length && blueWatched.length ? "Both alliances" : redWatched.length ? "Red alliance" : "Blue alliance",
        source: pinned.length ? "Manually pinned" : "S/A baseline priority",
        _index: index
      }];
    }).sort((a, b) => {
      const at = a.scheduled ? Date.parse(a.scheduled) : NaN;
      const bt = b.scheduled ? Date.parse(b.scheduled) : NaN;
      const aValid = Number.isFinite(at), bValid = Number.isFinite(bt);
      if (aValid && bValid && at !== bt) return at - bt;
      if (aValid !== bValid) return aValid ? -1 : 1;
      return a._index - b._index;
    });
  }

  window.OverrideWatchlist = Object.freeze({ buildWatchlistScheduleRows });
})();
