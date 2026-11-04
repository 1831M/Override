# Live scouting pipeline — desk check

## Purpose

The 1831M Override dashboard displays the official VEX Events record for event SKU `VE-V5-26-66512`. The browser never calls VEX Events directly and never receives the API token. The server function uses the pinned `@v5x/events@0.2.1` client.

## Request and update pseudocode

```text
WHEN dashboard opens:
    load the last successful browser snapshot, if one exists
    label it as cached until a fresh VEX response succeeds
    request GET /.netlify/functions/live-data

WHEN live-data receives a request:
    IF request method is not GET:
        return 405 METHOD_NOT_ALLOWED

    read VEX_EVENTS_TOKEN from Netlify server environment
    IF token is missing:
        return 503 TOKEN_REQUIRED
        do not return made-up event data

    IF a recent server snapshot is still inside the 20-second cache:
        return that snapshot
    IF another refresh is already running:
        await that refresh and reuse its result

    create VEX Events Robot client with the server-only token
    event = VEX Events lookup by SKU VE-V5-26-66512
    IF event is not found:
        return 404 EVENT_NOT_FOUND

    request registered event teams, skills and awards concurrently
    FOR EACH event division, with at most 3 divisions in flight:
        request matches
        request official rankings
        record success/failure separately for each feed

    FOR EACH registered event team, with at most 3 teams in flight:
        request that team's events in the event's own season
        exclude cancelled events
        cache this team-history result for 10 minutes per warm function

    normalise event, teams, match rows, rankings, skills and awards
    calculate only documented derived metrics
    attach fetchedAt timestamp, source errors and source-availability flags
    return the official snapshot

WHEN browser receives a successful snapshot:
    replace the current snapshot
    update the "last successful update" timestamp
    update summary cards, match centre, rankings, team profiles,
        skills, awards and activity feed
    compare against previous snapshot for new scores, rank changes and awards
    save the official snapshot locally

EVERY 60 seconds WHILE THE PAGE IS VISIBLE:
    request a new snapshot
ON MANUAL REFRESH:
    bypass the short server snapshot cache and request a new snapshot

IF refresh fails:
    keep the last successful snapshot
    keep its original timestamp
    visibly label it as cached/stale
    never convert an API failure into a score, ranking or team count of zero
```

## Metric desk check

| Display | Rule |
|---|---|
| Event ranking | Use the ranking returned by VEX for that division; do not invent a power ranking |
| W–L–T | Count only matches marked scored by VEX |
| Win rate | Wins ÷ scored matches × 100; unscored fixtures are excluded |
| Alliance points for/against | Average shared alliance score across scored matches containing that team |
| Alliance differential | Average alliance points for minus average alliance points against |
| Skills total | Best driver score + best programming score; do not add every attempt |
| Season appearances | Team event history filtered to the season attached to this event |

Alliance points are shared by the two robots on an alliance. They are not evidence of an individual robot's scoring contribution.

## Test matrix

- Official event SKU is passed to the package lookup.
- Registered-team filter is sent to the event team query.
- Every supplied division is queried for matches and rankings.
- Successful data from other sources survives when one source fails.
- Failed roster, match, skills, awards or team-history requests remain explicitly unavailable/unchecked.
- A genuinely successful empty response is distinct from a failed request.
- Unknown event SKU fails clearly rather than returning an invented empty event.
- Team history is cached to avoid repeating all season queries on every browser poll.
- Unscored fixture is not counted as a 0–0 result.
- Skills aggregation uses best runs by type.

## UI and usability desk check

- Seven navigation views exist: Overview, Scout intelligence, Match centre, Rankings, Team directory, Skills & awards, Sources & method.
- All 81 direct JavaScript element selectors have matching HTML IDs.
- Search and filters exist for team, organisation, ranking and division views.
- Team cards open a keyboard-accessible native dialog.
- Match, ranking, skills and award views have explicit empty and unavailable states.
- Responsive CSS includes a mobile layout and reduced-motion handling.
- Manual refresh and 60-second visible-tab refresh are wired.
- API token is read only in the Netlify function. The browser contains no token value.

## Scout intelligence desk check

- Historical team baselines remain separate from official live event rankings.
- Live alliance scoring is compared with earlier-season alliance scoring only as a directional signal, not as individual robot attribution.
- Recent trend comparisons require at least six scored matches for a team and compare the latest three with the preceding three.
- Human observations record category, assessment, notes and timestamp.
- Observations are saved to browser local storage only; shared multi-scout sync and account attribution are not yet implemented.
- The dashboard does not infer autonomous capability, mechanisms, reliability or driver quality from alliance scores. Those require direct human observation.

## Known boundaries

- The live feed requires a VEX Events personal access token stored as the secret Netlify environment variable `VEX_EVENTS_TOKEN`, with Functions scope. No token is committed to the repository or embedded in the browser.
- The VEX Events API supplies event, team, match, ranking, skills, awards and team-event-history records. It does not supply robot match footage or engineering notebook contents. Those require separately sourced links and human review; this dashboard does not invent video or notebook ratings.
- The older Vantage Scout event pages remain archived research links. They are not merged into the official live event tables.
- The live API has not been authenticated from this deployment while the environment variable is absent. Unit/integration tests use mocked VEX responses; they validate our data handling, not the real event's current contents.
- A static source/selector review is not the same as a full visual browser session. Final appearance should also be checked on an actual desktop and phone browser after the VEX token is configured.
