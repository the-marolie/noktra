# Examples

The JSON files in this folder are sample outputs, so you can see each format without running anything:

| File | Written by | Read by |
|---|---|---|
| [`routes.json`](routes.json) | `noktra-crawl` | `noktra-snapshot --routes` |
| [`capture-manifest.json`](capture-manifest.json) | `noktra-snapshot` | `noktra-diff --baseline-manifest` / `--comparison-manifest` |
| [`diff-result.json`](diff-result.json) | `noktra-diff` | you, or your CI |

## Compare two sites with the wizard

The wizard runs every step for you:

```bash
noktra-cli
```

See the [project README](../README.md#quick-start) for the questions it asks and the files it writes.

## Compare a site before and after a deploy, step by step

Each engine can also be run on its own. This compares one site with itself before and after a change:

```bash
# 1. Find the routes. A browser window opens; log in if needed, then press Enter.
#    The session is saved to auth-state.json for the next steps.
noktra-crawl https://app.example.com --auth-state auth-state.json

# 2. Screenshot every route: the baseline
noktra-snapshot --routes routes.json --auth-state auth-state.json --out run-1

# 3. Deploy your change, then screenshot again
noktra-snapshot --routes routes.json --auth-state auth-state.json --out run-2

# 4. Compare every matching page, allowing up to 0.1% of pixels to change
noktra-diff --baseline-manifest run-1/capture-manifest.json \
            --comparison-manifest run-2/capture-manifest.json \
            --diff-dir diffs --max-diff-percent 0.1 --html report.html
```

For a public site, add `--skip-login` to step 1 and leave out `--auth-state` everywhere.

Inside the noktra repository, use the shortcut scripts instead of the commands: `npm run crawl -- …`, `npm run snapshot -- …` and `npm run diff -- …`.

## How the files connect

```
noktra-crawl     →  routes.json (+ auth-state.json)
noktra-snapshot  →  screenshots/*.png + capture-manifest.json
noktra-diff      →  diffs/*.png + diff-result.json (+ report.html)
```

Every step also works on its own: `noktra-snapshot --url <url>` captures a single page without a route manifest, and `noktra-diff a.png b.png` compares two images without manifests.

`auth-state.json` is your login session. Keep it private and never commit it.
