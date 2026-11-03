# 1831M Override Live Scouting

A competition dashboard for the NSW V5 Middle School State Championships — Override 2026.

## Data connection

The dashboard uses the official VEX Events API v2 through the community-maintained `@v5x/events` client (pinned to 0.2.1). The package is not an official VEX product; the underlying event, team, match, ranking, skills, award and team-history records come from VEX Events.

The function requires a VEX Events personal access token. The token is intentionally not stored in this repository and must never be added to browser JavaScript, `data.js`, commits, or chat.

1. Sign in to your VEX Events account at https://events.vex.com/ and create a personal API token in the account's developer/API settings.
2. Open the Netlify project **1831m-states-scouting-2026**.
3. Go to **Project configuration → Environment variables**.
4. Add `VEX_EVENTS_TOKEN`; set it as a secret and give it the **Functions** scope (or All scopes).
5. Trigger a new production deploy so the function receives the secret.
6. Open the dashboard and press refresh. The connection indicator should change to **VEX feed live**.

Do not paste the token into this repository or share it with anyone. If the VEX API token is unavailable, the dashboard will clearly say that the live feed is not connected rather than inventing results.

## Live refresh behaviour

- Browser polling runs every 60 seconds while the page is visible.
- Manual refresh is available from the top-right refresh control.
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

Unit and mocked integration tests cover match scoring vs unscored fixtures, alliance-level metrics, best-run skills aggregation, event and division API aggregation, partial source failures, season-history gaps, unknown event handling, and history caching. UI smoke checks verify all direct interface selectors, navigation targets, source-unavailable states, responsive styling, reduced-motion support, the server-only token boundary, and the refresh interval. See [DESK-CHECK.md](DESK-CHECK.md) for the pseudocode walkthrough and full manual test matrix.

## Deployment

The repository-root `netlify.toml` sets this folder as the Netlify base directory. Netlify installs `@v5x/events`, runs the build script, publishes `dist/`, and deploys functions from `netlify/functions/`.
