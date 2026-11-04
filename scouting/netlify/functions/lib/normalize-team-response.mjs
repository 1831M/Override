export function normalizeTeamCollectionResponse(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.data)) {
    return {body, normalizedRows:0};
  }

  let normalizedRows = 0;
  const data = body.data.map(team => {
    if (!team || typeof team !== "object" || Array.isArray(team)) return team;
    if (!team.location || typeof team.location !== "object" || Array.isArray(team.location) || team.location.venue !== null) {
      return team;
    }

    const location = {...team.location};
    delete location.venue;
    normalizedRows++;
    return {...team, location};
  });

  return {
    body: normalizedRows ? {...body, data} : body,
    normalizedRows
  };
}
