# noktra

Visual regression testing for websites. Point noktra at two versions of a site (for example production and staging), and it finds the pages, takes a full-height screenshot of every page on both, compares them pixel by pixel, and writes an HTML report showing what changed.

```bash
npm install -g noktra
noktra-cli
```

## Features

- **Interactive wizard** that runs the whole process, or individual engines you can use on their own or from code.
- **Route discovery** from the site's sitemap, falling back to crawling links when there is no sitemap or the site is a single-page app.
- **Safe crawling**: logout links and links that change data (delete, add, remove, publish, and similar) are never visited.
- **Login and HTTP authentication** support. You log in by hand in a real browser window, so MFA and SSO work as normal.
- **Full-height screenshots**, including app layouts that scroll inside an inner panel, with fixed and sticky headers kept at the top.
- **Pixel comparison** with diff images, pass/fail per page, and a self-contained HTML report.
- **Saved project configs**, so a comparison can be rerun without answering the questions again.
- **Runs in the background** (headless) unless a login window is needed.

## Requirements

- Node.js 20 or newer
- Chromium for Playwright, about 150 MB. The wizard checks for it on startup and offers to install it, or install it yourself with `npx playwright install chromium`.

## Quick start

```bash
npm install -g noktra     # installs the wizard and all three engines
noktra-cli                # start the wizard
```

The wizard first checks for Chromium, then asks:

| Question | Notes |
|---|---|
| Project name | A folder `projects/<name>/` is created in the current directory. |
| Site A URL | The reference site. `https://` is optional. |
| Site B URL | The site to compare against it. It can be on a different domain. |
| HTTP authentication? | If yes, asks for a username and password. |
| Login required? | If yes, a browser window opens for you to log in. |
| Single-page app? | If yes, routes are found by crawling instead of from the sitemap. |
| Maximum routes | How many pages to compare. Default 30. |
| HTML report? | Writes `report.html` at the end. |

When the run finishes, open `projects/<name>/report.html` to review the results.

To run without installing anything, use `npx noktra`.

## How it works

1. **Log in** (only if the site needs a login). A browser window opens on Site A; log in, then press Enter in the terminal. The session is saved and reused for the next steps.
2. **Find routes on Site A.** noktra reads the sitemap (`Sitemap:` lines in `robots.txt`, then `/sitemap.xml` and `/sitemap_index.xml`, following sitemap indexes). If there is no sitemap, or the site is a single-page app, it crawls Site A by following links instead.
3. **Copy the routes to Site B** with only the domain changed, so both sites are captured page for page.
4. **Screenshot both sites.** Every page is captured at full height. If Site B also needs a login, a second window opens for it, because a session for one domain doesn't work on another.
5. **Compare** each pair of screenshots by path, and write a diff image and a result per page.
6. **Write the report**, if you asked for one.

## Project output

Everything for a project is written to `projects/<name>/` in the directory you run the wizard from:

```
projects/<name>/
├── noktra.config.json      your answers, for reruns (the password is never saved)
├── site-a/
│   ├── routes.json         the routes found on Site A
│   ├── auth-state.json     saved login session (only when login is required)
│   ├── screenshots/        one PNG per route
│   └── capture-manifest.json
├── site-b/
│   ├── routes.json         Site A's routes with Site B's domain
│   ├── screenshots/
│   └── capture-manifest.json
├── diffs/                  one diff image per page, changed pixels in red
├── diff-result.json        pass/fail and the changed-pixel percentage per page
└── report.html             side-by-side, overlay and swipe views (optional)
```

Running the wizard again for an existing project asks before deleting the previous results.

## Rerunning a project

The wizard saves your answers to `projects/<name>/noktra.config.json`. Pass it with `--config` to skip the questions:

```bash
noktra-cli --config projects/<name>/noktra.config.json
```

If you start the wizard without `--config`, its first question asks for a config path; leave it empty to answer the questions instead. A config can be partial: any value that's missing or invalid is asked for as usual.

The HTTP authentication password is never written to the config. Enter it when asked, or set it in the `NOKTRA_HTTP_PASSWORD` environment variable. Login windows still open on every run that needs them.

An example config:

```json
{
  "version": 1,
  "projectName": "my-site",
  "siteAUrl": "https://www.example.com",
  "siteBUrl": "https://staging.example.com",
  "requireAuth": false,
  "requireLogin": false,
  "isAnSPA": false,
  "maxRoutes": 30,
  "generateReport": true
}
```

## Packages

noktra is published as five npm packages. Install `noktra` for everything, or install a single engine on its own.

| Package | What it does | Command |
|---|---|---|
| [`noktra`](packages/noktra) | Installs everything below and provides all the commands | `noktra`, plus all of the below |
| [`noktra-cli`](packages/noktra-cli) | The interactive wizard | `noktra-cli` |
| [`noktra-crawler`](packages/noktra-crawler) | Finds a site's routes from its sitemap or by crawling; handles login | `noktra-crawl` |
| [`noktra-snapshot`](packages/noktra-snapshot) | Takes full-height screenshots of a URL or a list of routes | `noktra-snapshot` |
| [`noktra-diff`](packages/noktra-diff) | Compares screenshots, writes diff images and the HTML report | `noktra-diff` |

The three engines don't depend on each other. They exchange plain JSON and PNG files, so you can use any one of them by itself. The wizard is the only package that uses all three.

## Using the engines directly

Each engine has its own command. A typical manual run, comparing a site before and after a deploy:

```bash
# Find routes; a browser window opens so you can log in, then press Enter
noktra-crawl https://app.example.com --out routes.json --auth-state auth-state.json

# Screenshot every route, using the saved session
noktra-snapshot --routes routes.json --auth-state auth-state.json --out run-1

# ...deploy a change, then screenshot again
noktra-snapshot --routes routes.json --auth-state auth-state.json --out run-2

# Compare every matching page and write a report
noktra-diff --baseline-manifest run-1/capture-manifest.json \
            --comparison-manifest run-2/capture-manifest.json \
            --diff-dir diffs --html report.html
```

For a public site, add `--skip-login` to the crawl and leave out `--auth-state`.

Every command lists its options with `--help`, and each package's README documents its options, exit codes, and JavaScript API. The engines can also be used from code:

```js
import { discoverSitemapRoutes, crawlSite } from "noktra-crawler";
import { captureUrls } from "noktra-snapshot";
import { compareManifests } from "noktra-diff";
import { writeHtmlReport } from "noktra-diff/report";
```

## File formats

The engines connect through these files.

### routes.json (crawler → snapshot)

```jsonc
{
  "schemaVersion": 1,
  "startUrl": "https://example.com/",
  "createdAt": "2026-10-14T12:00:00.000Z",
  "discoveryStatus": "complete",   // "complete", or "limited" when the route limit was reached
  "discoverySource": "sitemap",    // "sitemap" or "crawl"
  "routes": [
    {
      "url": "https://example.com/about",
      "title": "About us",         // page title, or null for sitemap routes (not visited)
      "status": "ok",              // "ok" or "error"; only "ok" routes are captured
      "error": null
    }
  ]
}
```

### capture-manifest.json (snapshot → diff)

```jsonc
{
  "schemaVersion": 1,
  "createdAt": "2026-10-14T12:05:00.000Z",
  "viewport": { "width": 1280, "height": 720, "fullPage": true },
  "outputDir": "screenshots",
  "captures": [
    {
      "url": "https://example.com/about",
      "imagePath": "screenshots/001-about.png",
      "width": 1280,
      "height": 2140,              // real image size; full-page captures are taller than the viewport
      "status": "ok",              // "ok", "error", or "auth_required"
      "error": null,
      "finalUrl": "https://example.com/about"
    }
  ]
}
```

### diff-result.json (diff output)

One result per compared page, including `diffPixels`, `totalPixels`, `diffPercent`, `changed`, `passed` and `status`. Pages captured in only one of the two runs are listed with `status: "skipped"`. See the [`noktra-diff` README](packages/noktra-diff) for every field.

### auth-state.json (login session)

Playwright's saved browser state: cookies and localStorage for the sites you logged in to. See [Security](#security).

## Security

- **`auth-state.json` is your live login session.** Anyone with the file can act as you until the session expires. Keep `projects/` private, never commit it, and delete the file when you're done (or log out of the site to invalidate it).
- On macOS and Linux the file is written readable by your user only. Windows ignores that setting, so rely on folder permissions there. The file is not encrypted.
- The HTTP authentication password is never saved to disk by noktra.
- noktra never bypasses MFA or other security controls: you log in yourself, in a real browser window.

## Limitations

- **Chromium only.**
- **Routes come from Site A only.** Site B is assumed to have the same paths; pages that exist only on Site B are not discovered.
- **The crawler follows links only** (`<a href>`). It doesn't click buttons or submit forms, so pages reachable only that way are missed.
- **Skipping logout and data-changing links is keyword-based.** It catches common patterns such as `/logout`, `/cart/add/5`, `?action=delete` and "Remove" buttons, but an unusual URL could still slip through. Avoid pointing noktra at a production account whose data matters.
- **The sitemap check sends cookies only.** If a site keeps its login in localStorage, the sitemap won't load and noktra falls back to crawling.
- **Expired sessions are detected heuristically:** a redirect to a URL containing `login`, `signin`, `sign-in`, `auth` or `sso` is reported as `auth_required`. A login form shown without a redirect is screenshotted as-is.
- **Full-page screenshots are capped at 20,000 px** tall. When a page has several inner scroll panels side by side, only the largest one is expanded.
- **The diff engine reads PNG files only.**
- **The wizard exits successfully even when pages differ.** Check `diff-result.json` or the report for the results.

## Development

```bash
git clone https://github.com/the-marolie/noktra.git
cd noktra
npm install
npm run install:browser    # downloads Chromium for Playwright
```

The repository is an npm workspaces monorepo. `npm install` links every package in `packages/` into `node_modules`, so changes to an engine are picked up by the wizard immediately, without reinstalling.

```
noktra/
├── package.json            workspaces and shortcut scripts (private, never published)
├── examples/               sample routes.json, capture-manifest.json and diff-result.json
└── packages/
    ├── noktra/             umbrella package: bin/ has one small file per command
    ├── noktra-cli/         the wizard: src/index.js
    ├── noktra-crawler/     src/index.js (library) and src/cli.js (command)
    ├── noktra-snapshot/    same layout
    └── noktra-diff/        same layout, plus src/report.js (HTML report)
```

Each engine keeps its logic in `src/index.js`, which other code imports, and its command-line handling in `src/cli.js`.

Shortcut scripts, run from the repository root:

| Script | Runs |
|---|---|
| `npm run wizard` | The wizard (`noktra-cli`) |
| `npm run crawl -- <url> [options]` | The crawler command |
| `npm run snapshot -- [options]` | The snapshot command |
| `npm run diff -- [options]` | The diff command |
| `npm run install:browser` | Downloads Chromium for Playwright |

Note the `--` before arguments, e.g. `npm run crawl -- https://example.com --skip-login`.

### Releasing

All five packages share one version number and are released together. For a release, bump every package, point the internal dependency ranges at the new version, then publish from the bottom of the dependency chain up:

```bash
npm version patch --workspaces --no-git-tag-version
npm pkg set dependencies.noktra-crawler=^X.Y.Z dependencies.noktra-snapshot=^X.Y.Z dependencies.noktra-diff=^X.Y.Z --workspace=noktra-cli
npm pkg set dependencies.noktra-cli=^X.Y.Z dependencies.noktra-crawler=^X.Y.Z dependencies.noktra-snapshot=^X.Y.Z dependencies.noktra-diff=^X.Y.Z --workspace=noktra
npm install
git commit -am "Release vX.Y.Z" && git tag vX.Y.Z && git push && git push --tags

npm publish --workspace=noktra-crawler
npm publish --workspace=noktra-snapshot
npm publish --workspace=noktra-diff
npm publish --workspace=noktra-cli
npm publish --workspace=noktra
```

Replace `X.Y.Z` with the new version. `npm version` does not update the ranges in dependent packages, which is why the two `npm pkg set` commands are needed.

## License

[MIT](LICENSE)
