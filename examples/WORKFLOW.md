# End-to-end workflow

Files in this folder are sample artifacts so you can see each format without running anything.

```bash
npm install && npm run install:browser

# Crawler → routes.json + auth-state.json
npm run crawl -- https://app.example.com --auth-state ./auth-state.json

# Snapshot (baseline) → run-1/*.png + run-1/capture-manifest.json
npm run snapshot -- --routes ./routes.json --auth-state ./auth-state.json --out ./run-1

# ...deploy a change, then snapshot again
npm run snapshot -- --routes ./routes.json --auth-state ./auth-state.json --out ./run-2

# Diff every matching page → diffs/*.png + diff-result.json
npm run diff -- --baseline-manifest ./run-1/capture-manifest.json --comparison-manifest ./run-2/capture-manifest.json --diff-dir ./diffs --max-diff-percent 0.1
```

Artifacts flow: `routes.json` + `auth-state.json` → snapshot → `capture-manifest.json` + PNGs → diff → `diff-result.json` + diff PNGs.
Every step can also be used alone: `--url` instead of `--routes`, two PNG paths instead of manifests.
