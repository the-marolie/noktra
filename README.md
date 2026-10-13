# noktra

noktra is a small, beginner-friendly monorepo for visual regression testing: a wizard plus three independent JavaScript engines.

| Package | What it does | Root command |
|---|---|---|
| `packages/noktra` | Umbrella package: installs the wizard and all three engines, and provides the `noktra` command. Published as `noktra` (`npx noktra`) | — |
| `packages/noktra-cli` | Interactive wizard that runs the three engines end to end: finds routes, screenshots two sites, compares them, writes a report. Published as `noktra-cli` (`npx noktra-cli`) | `npm run wizard` |
| `packages/noktra-crawler` | Opens a site in a visible browser, lets you log in, discovers same-site links, writes `routes.json` (and optionally `auth-state.json`) | `npm run crawl` |
| `packages/noktra-snapshot` | Captures PNG screenshots of a URL or of every route in `routes.json`, writes `capture-manifest.json` | `npm run snapshot` |
| `packages/noktra-diff` | Compares two PNGs with pixelmatch, writes a diff image and `diff-result.json` | `npm run diff` |

Using the published packages instead of this repo: `npx playwright install chromium`, then `npx noktra`. See `packages/noktra/README.md`. Each package can also be installed on its own.

Every engine works on its own. They connect only through plain JSON and PNG files (documented below).
No engine imports another engine's source code; only the wizard imports all three.

## Folder structure

```
noktra/
├── package.json                 # npm workspaces + shortcut scripts
├── package-lock.json            # exact dependency versions (created by npm install)
├── README.md                    # this file
├── examples/                    # sample JSON artifacts and an end-to-end walkthrough
└── packages/
    ├── noktra/                  # umbrella package: depends on the four below, provides the `noktra` command
    ├── noktra-cli/              # the wizard (src/index.js), depends on the three engines below
    ├── noktra-crawler/
    │   ├── src/index.js         # JavaScript API (crawlSite, helpers)
    │   ├── src/cli.js           # command-line wrapper around the API
    │   ├── package.json
    │   └── README.md
    ├── noktra-snapshot/         # same layout
    └── noktra-diff/             # same layout
```

Each package has `src/index.js` (the reusable API, importable from any Node app) and `src/cli.js` (a thin command-line wrapper). This keeps "logic" and "terminal handling" separate without extra abstractions.

## Requirements

- Node.js 20 or newer (the code uses the built-in `util.parseArgs` and `node:` imports).
- npm 7 or newer (for workspaces).

## Installation

```bash
npm install                 # installs all three packages' dependencies into one node_modules (workspaces)
npm run install:browser     # downloads Chromium for Playwright (~150 MB, needed by crawler + snapshot only)
```

The diff engine does not need a browser.

## Root package.json explained

```jsonc
{
  "private": true,                      // never publish the root to npm
  "type": "module",                     // use ES modules (import/export) everywhere
  "workspaces": ["packages/*"],         // every folder in packages/ is its own npm package
  "scripts": {
    "crawl":    "node packages/noktra-crawler/src/cli.js",   // run the crawler CLI from the repo root
    "snapshot": "node packages/noktra-snapshot/src/cli.js",  // run the snapshot CLI
    "diff":     "node packages/noktra-diff/src/cli.js",      // run the diff CLI
    "install:browser": "npx playwright install chromium"     // one-time Chromium download
  },
  "engines": { "node": ">=20" }        // documents the minimum Node version
}
```

The scripts call `node` directly (instead of `npm run --workspace`) so relative paths you type resolve from the repository root. Remember the `--` before arguments: `npm run crawl -- https://example.com`.

## Quick start

```bash
# 1. Discover routes (a browser window opens; log in if needed, then press Enter)
npm run crawl -- https://example.com --out ./routes.json --auth-state ./auth-state.json

# 2. Capture screenshots of those routes using the saved login session
npm run snapshot -- --routes ./routes.json --auth-state ./auth-state.json --out ./run-1

# 3. Later, capture again
npm run snapshot -- --routes ./routes.json --auth-state ./auth-state.json --out ./run-2

# 4. Compare one pair of images...
npm run diff -- ./run-1/001-home.png ./run-2/001-home.png --diff ./diff.png

# ...or every matching screenshot in both runs
npm run diff -- --baseline-manifest ./run-1/capture-manifest.json --comparison-manifest ./run-2/capture-manifest.json --diff-dir ./diffs
```

Each package README documents its full options, JS API, and output format.

## File formats that connect the engines

### routes.json (crawler → snapshot)

```jsonc
{
  "schemaVersion": 1,                    // format version
  "startUrl": "https://example.com/",    // where the crawl began
  "createdAt": "2026-10-11T12:00:00.000Z",
  "discoveryStatus": "complete",         // "complete" = no links left; "limited" = stopped at --max-pages
  "routes": [
    {
      "url": "https://example.com/",     // normalized URL (no #fragment)
      "title": "Example Domain",         // <title> text or null
      "status": "ok",                    // "ok" or "error"
      "error": null                      // error message when status is "error"
    }
  ]
}
```

### auth-state.json (crawler → snapshot, optional, SENSITIVE)

This is Playwright's `storageState()` output: cookies and localStorage for every origin visited. It is equivalent to your logged-in session.

### capture-manifest.json (snapshot → diff, optional)

```jsonc
{
  "schemaVersion": 1,
  "createdAt": "2026-10-11T12:05:00.000Z",
  "viewport": { "width": 1280, "height": 720, "fullPage": true },
  "outputDir": "./screenshots",
  "captures": [
    {
      "url": "https://example.com/",
      "imagePath": "screenshots/001-home.png",  // where the PNG was written
      "width": 1280, "height": 720,             // real pixel size (full-page captures are taller)
      "status": "ok",                           // "ok", "error", or "auth_required"
      "error": null,
      "finalUrl": "https://example.com/"        // URL after redirects
    }
  ]
}
```

### diff-result.json (diff output)

See `packages/noktra-diff/README.md`. Key fields: `diffPixels`, `totalPixels`, `diffPercent`, `changed`, `passed`, `status`.

## Authentication state security

- `auth-state.json` **contains your live session** (cookies, tokens in localStorage). Anyone with the file can act as you until the session expires.
- It is written with permission mode `0600` (owner read/write only) on macOS/Linux. **Windows ignores this**; use folder permissions there.
- It is listed in `.gitignore`. Never commit it, paste it into tickets, or share it.
- There is no encryption in this MVP. Delete the file when you are done, or log out of the site to invalidate it.
- Sessions are per-hostname. State captured on `app.example.com` will not log you in on `staging.example.com`.
- The engines never bypass MFA or security controls; you log in by hand in a real browser window.

## Limitations (by design)

- Crawler follows `<a href>` links only; it does not click buttons or submit forms.
- Crawler stays on the same origin and stops at `--max-pages` (default 25).
- Expired-session detection in the snapshot engine is a heuristic (redirect to a URL containing `login`, `signin`, `sign-in`, `auth`, or `sso`). Sites that show an inline login form without redirecting will be screenshotted as-is; check your images.
- Diff supports PNG only and requires identical dimensions.
- No tests, database, cloud, or GUI. Chromium only.

## Verification status

Tested by the author: the diff engine end-to-end (identical, changed, tolerance, dimension mismatch, missing file), all URL/manifest/file-name helpers, every CLI validation and error path, and the "Chromium not installed" message. The crawler and snapshot engines could **not** be run against a real browser in the authoring environment (Chromium download was blocked), so run `npm run install:browser` and try them on a simple public site first.
