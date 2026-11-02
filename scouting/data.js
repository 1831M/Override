// Official event roster supplied for this scouting project. Performance fields remain unknown until verified.
window.SCOUTING_DATA = {
  event: { name: "NSW State Championships — VEX V5 Middle School", game: "Override", date: "2026-11-08", venue: "Knox Grammar School", code: "VE-V5-26-66512", checked: "2026-11-03" },
  teams: [
    ["1831G","The King's School"],["1831H","The King's School"],["1831K","The King's School"],["1831M","The King's School"],["1831N","The King's School"],["1831S","The King's School"],["1831V","The King's School"],
    ["1940D","Knox Grammar School"],["1940H","Knox Grammar School"],["1940X","Knox Grammar School"],
    ["4613B","Barker College"],["4613C","Barker College"],["4613D","Barker College"],["4613E","Barker College"],["4613G","Barker College"],["4613R","Barker College"],["4613Y","Barker College"],
    ["32119A","Reddam House North Shore"],["62345A","Cranbrook School"],["65100A","Pymble Ladies' College"],
    ["93601V","Shore"],["93601W","Shore"],["93601X","Shore"],["93601Z","Shore"]
  ].map(([id,school]) => ({ id, school, events: null, matchWinRate: null, skills: null, notebook: null, footage: null, style: "Not yet verified", evidence: "Roster only", reliability: null }))
};