# 1831M Override Live Scouting

A competition dashboard for the NSW V5 Middle School State Championships — Override 2026.

## Data connection

The dashboard uses the official VEX Events API v2 through the community-maintained `@v5x/events` client (pinned to 0.2.1). The package is not an official VEX product; the underlying event, team, match, ranking, skills, award and team-history records come from VEX Events.

The function requires a VEX Events personal access token. The token is intentionally not stored in this repository and must never be added to browser JavaScript, `data.js`, commits, or chat.

### Direct Netlify setup

1. Sign in to your VEX Events account at https://events.vex.com/ and create a personal access token using the account controls provided there. The `@v5x/events` documentation confirms that a personal access token is required, but does not specify a fixed menu path: https://docs.v5x.dev/events/overview/.
2. Open the Netlify project **1831m-states-scouting-2026**.
3. Go to **Project configuration → Environment variables**.
4. Add `VEX_EVENTS_TOKEN` in the **production** context and leave the scope at the default **All scopes**. In this project's current Free-plan configuration, Netlify rejects a Secrets Controller flag with the all-scopes setting, so use a standard environment variable. Netlify still encrypts stored environment variables at rest; its sensitive-variable policy also applies to detected sensitive values on public repositories.
5. Trigger a new production deploy so the function receives the secret.
6. Open the dashboard and press refresh. The connection indicator should change to **VEX feed live**.

### Optional GitHub Actions setup

The repository also includes **Sync VEX Events token to Netlify** under GitHub Actions. To use that workflow, add these two repository Actions secrets:

- `VEX_EVENTS_TOKEN` — the VEX Events personal access token.
- `NETLIFY_AUTH_TOKEN` — a Netlify personal access token.

Then run the workflow manually from the Actions tab. It stores the VEX token in Netlify's encrypted production environment-variable store using the default all-scopes setting, runs the project checks, and triggers a production deploy. It does not mark the variable with the stricter write-only Secrets Controller flag.

Do not paste tokens into this repository or expose them in browser code. If the VEX API token is unavailable, the dashboard will clearly say that the live feed is not connected rather than inventing results.

## Scouting intelligence

The Scout intelligence view connects the three evidence layers:

- **Historical baseline:** earlier-season W–L–T, average points, margin, CCWM, threat tier and confidence.
- **Live competition:** current event rankings, scored matches and alliance score trends. The analysis flags meaningful gaps against baseline and compares the latest three scored alliance outcomes with the preceding three when there is enough evidence.
- **Human scouting:** scouts can record team-specific observations for robot capability, autonomous, reliability, mechanisms, driver behaviour, strategy and alliance compatibility.

Signals are prompts for scouts, not verdicts. Alliance scores are shared by two robots and cannot establish individual contribution. Human observations currently save in the browser that recorded them; use the JSON export/import controls to transfer a notebook between scouts or devices. The Scout intelligence view also includes a two-team evidence comparison and a printable match field sheet.

## Live refresh behaviour

- Browser polling runs every 60 seconds while the page is visible.
- Manual refresh is available from the top-right refresh control.
- Match centre supports searching by match, field, division or team and exporting the current filtered schedule/results to CSV.
- Rankings can be exported to CSV using the current filters.
- Printable match scouting sheets are generated from the official published schedule.
- The production smoke test records per-source availability and division metadata so an incomplete upstream response can be diagnosed without exposing credentials.
- Safe response-shape diagnostics are included in the CI smoke output when a VEX collection fails schema validation.
- Team collection diagnostics report only field names and data types, never team records or API credentials.
- A post-deploy CI smoke test verifies the live event feed against the production alias.
- The live function normalises nullable optional venue fields in VEX team responses before schema validation.
- Scouts can pin up to 24 teams to a browser-local priority list, remove pins, and export that list to CSV.
- The function keeps a short in-memory snapshot cache to avoid duplicate API requests.
- Team season history is refreshed at most once per 10 minutes per warm function instance.
- The browser stores the last successful official snapshot locally. If the API is temporarily unavailable, that snapshot is shown with its original update time and a stale-data label.
- A missing result, score, award, or history lookup stays unknown. It is never silently changed to zero.

## Data and metrics

The live feed requests:
- event metadata and divisions
- registered event teams
- division matches and division rankings for every published division
- event skills runs and awards
- each registered team's events in the season attached to the States event

Derived values are deliberately limited:
- Win rate counts only scored event matches.
- Alliance points for/against are averages of shared alliance scores from scored matches. They are not individual robot scores.
- Skills total uses the best driver run plus the best programming run, not all attempts added together.
- Event rankings, WP, AP and SP are displayed as returned by VEX Events.

The older Vantage Scout pages are kept as archive research links only. They do not get merged into the official event leaderboard.

## Development and checks

Run from this folder:

```sh
npm install
npm run check
npm run build
```

GitHub Actions also runs a production smoke test against the deployed VEX feed after local checks and the build. Unit and mocked integration tests cover match scoring vs unscored fixtures, alliance-level metrics, best-run skills aggregation, event and division API aggregation, partial source failures, season-history gaps, unknown event handling, and history caching. UI smoke checks verify all direct interface selectors, navigation targets, source-unavailable states, responsive styling, reduced-motion support, the server-only token boundary, and the refresh interval. See [DESK-CHECK.md](DESK-CHECK.md) for the pseudocode walkthrough and full manual test matrix.

## Deployment

The repository-root `netlify.toml` sets this folder as the Netlify base directory. Netlify installs `@v5x/events`, runs the build script, publishes `dist/`, and deploys functions from `netlify/functions/`.
