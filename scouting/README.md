# 1831M States Scouting — 2026

Interactive scouting dashboard for the NSW V5 State Championships (Override), 8 November 2026.

## Site structure

- `index.html` — dashboard interface
- `data.js` — verified scouting data (unknown values remain explicitly unavailable)
- `styles.css` — responsive styling
- `app.js` — filters, comparisons and charts

## Netlify connection

The Netlify project is `1831m-states-scouting-2026`.

To connect this subdirectory using Netlify Git continuous deployment:
1. Open the Netlify project.
2. Go to **Project configuration → Build & deploy → Continuous deployment** and connect the GitHub repository `1831M/Override`.
3. Set the **base directory** to `scouting`.
4. Leave the build command empty and set the publish directory to `.`.
5. Save and trigger the first deploy.

After that, commits under `scouting/` will trigger deploys. Files elsewhere in the repository will not be part of the published site.

The GitHub/Netlify connections available to this assistant do not expose the repository-linking settings, so that one-time connection must be completed in the Netlify dashboard.

## Evidence rules

- Use only the 2026 Override season.
- Do not turn missing values into zero.
- Separate observed match data from scouting interpretation.
- Show source, date checked and confidence for every important metric.
- A reliability score measures evidence coverage, not team quality.
