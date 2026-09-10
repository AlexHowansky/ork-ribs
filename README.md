# ORK Restaurant Guide

A full-screen map of New York State food service establishments with their most
recent health inspection. The map opens where you are, or on the whole state if
your location isn't available. Every establishment in view is marked with its
inspection result; select one for its address, inspection date, violation
counts and the list of violations.

## Running it

Requires [Bun](https://bun.sh) 1.4+.

```sh
bun install
bun run sync     # optional: download the inspection data now (the server also does this itself)
bun run dev      # http://127.0.0.1:3000, rebuilds on changes
```

For production:

```sh
bun run build
bun run start
```

| Command             | What it does                                                          |
| ------------------- | --------------------------------------------------------------------- |
| `bun run dev`       | Server with the client rebuilt on every change                        |
| `bun run build`     | Minified client bundle in `dist/`                                     |
| `bun run start`     | Production server (serves `dist/`, building it first if missing)      |
| `bun run sync`      | Refresh the local data once; `-- --force` re-downloads even if unchanged |
| `bun test`          | Unit, API and client-rule tests                                       |
| `bun run typecheck` | `tsc --noEmit`                                                        |

### Configuration

| Variable                | Default           | Meaning                                                            |
| ----------------------- | ----------------- | ------------------------------------------------------------------ |
| `PORT` / `HOST`         | `3000` / `127.0.0.1` | Where the server listens                                        |
| `DB_PATH`               | `data/ork.sqlite` | SQLite database file                                               |
| `LOG_LEVEL`             | `info`            | `debug`, `info`, `warn` or `error`                                 |
| `SYNC_INTERVAL_HOURS`   | `24`              | How often to check the state's data for updates                    |
| `SOCRATA_APP_TOKEN`     | —                 | Optional [app token](https://dev.socrata.com/docs/app-tokens.html) for higher API limits |
| `RATE_LIMIT_PER_MINUTE` | `240`             | Requests per minute per client IP on `/api/*`                      |

## How it works

- **Data.** The server keeps a full copy of the NYS Department of Health dataset
  [Food Service Establishment: Last Inspection](https://health.data.ny.gov/Health/Food-Service-Establishment-Last-Inspection/cnih-y5dw)
  (`cnih-y5dw`, ~21,600 establishments) in SQLite.
  - **Refresh.** The copy is refreshed on startup when it is stale, then daily. Each refresh first checks the
    source's last-modified header and skips the download if nothing has changed.
  - **Atomic swap.** New data replaces the old in one transaction. If a download fails, the last good
    copy keeps being served.
- **Viewport search.** On every pan or zoom the client asks
  `/api/establishments?bbox=…&zoom=…`.
  - Up to 800 establishments come back as points. Above that, the server groups them into a grid of
    clusters, which zoom in when selected.
- **Violations.** The dataset stores violations as one text field. It is parsed
  into entries, each with an item code, a critical flag and a description.
  - **Counts.** The state's totals count every instance an inspector recorded, so they can exceed
    the number of distinct items listed. The modal shows both and explains the difference.
  - **Encoding repairs.** Some characters were lost upstream. Temperatures (`45°F`) and "Café" are
    restored; any other lost characters are dropped.
- **Coverage.** New York City inspects its own restaurants, so the five boroughs
  aren't in this dataset. The map says so when you look there.

### Layout

```
src/server/   Bun HTTP server, SQLite store, data sync, validation, security headers, logging
src/client/   HTML shell, Tailwind + daisyUI styles, map, markers, modals, theme control
tests/        bun test suites
```

## Design rules this code keeps

- **Colour.** Only daisyUI semantic tokens are used, resolved by the stock `winter` (light) and
  `night` (dark) themes. There are no palette shades and no `dark:` variants.
  - The Light / Dark / System control is in the header of every page. The saved choice is applied
    before first paint.
  - The basemap switches between OpenFreeMap's light and dark styles to match.
- **Icons.** They come from Font Awesome 7 Free as inline SVG. Every icon-only control has an
  `aria-label`, and controls that show a word keep it at all widths.
- **Dialogs.** Confirmations use the app's own themed dialog, never `window.confirm`.
  - The confirming button names the action.
  - Escape, Cancel and the close button all refuse.
- **Security (OWASP Top Ten).**
  - Parameterized SQL and strict input validation.
  - A fixed upstream URL, so there is no SSRF surface.
  - A strict Content-Security-Policy with no inline script or style, and MapLibre's worker served
    from our own origin.
  - Standard security headers, plus HSTS and `upgrade-insecure-requests` in production.
  - Per-IP rate limiting.
  - No `innerHTML`: API data is only ever inserted as text.
  - Error responses are friendly and never include internals.

  `tests/client-rules.test.ts` enforces the colour, dialog and HTML-injection rules.
- **Logging.** Every server log line is JSON with a request id, which is also returned as
  `X-Request-Id`. Client warnings and errors are forwarded to the server log.

### Deploying behind a proxy

Rate limiting keys on the connecting IP. Behind a reverse proxy, every request
appears to come from the proxy, so either rate-limit at the proxy or raise
`RATE_LIMIT_PER_MINUTE`. The production CSP includes `upgrade-insecure-requests`,
so serve production over HTTPS.

## Credits

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors,
tiles by [OpenFreeMap](https://openfreemap.org) / [OpenMapTiles](https://www.openmaptiles.org/).
Inspection data from the New York State Department of Health.
