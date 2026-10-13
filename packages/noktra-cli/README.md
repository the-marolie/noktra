# noktra-cli

The interactive wizard for [noktra](https://github.com/the-marolie/noktra), a visual regression testing toolkit. Give it two versions of a site (for example production and staging), and it finds the pages, screenshots every page on both, compares them pixel by pixel and writes an HTML report.

It runs the three noktra engines, which are installed with it: [`noktra-crawler`](https://www.npmjs.com/package/noktra-crawler), [`noktra-snapshot`](https://www.npmjs.com/package/noktra-snapshot) and [`noktra-diff`](https://www.npmjs.com/package/noktra-diff). To get the wizard and every engine command in one install, use [`noktra`](https://www.npmjs.com/package/noktra) instead.

## Install

```bash
npm install -g noktra-cli
```

Or run it without installing: `npx noktra-cli`.

Requires Node.js 20 or newer, and Chromium for Playwright (about 150 MB). The wizard checks for Chromium when it starts and offers to install it.

## Usage

```bash
noktra-cli                                   # answer the questions
noktra-cli --config <path-to-config.json>    # reuse saved answers
```

| Option | Description |
|---|---|
| `-c`, `--config <file>` | Load project details from a saved config file instead of asking for them. |

### The questions

| Question | Notes |
|---|---|
| Project name | Results go to `projects/<name>/` in the current directory. |
| Site A URL | The reference site. `https://` is optional. |
| Site B URL | The site to compare against it. It can be on a different domain. |
| HTTP authentication? | If yes, asks for a username and password. |
| Login required? | If yes, a browser window opens for you to log in. |
| Single-page app? | If yes, routes are found by crawling instead of from the sitemap. |
| Maximum routes | How many pages to compare. Default 30. |
| HTML report? | Writes `report.html` at the end. |

## What it does

1. **Checks for Chromium.** If it's missing, the wizard offers to install it. If you decline, you can still enter the project details; they are saved, and the wizard stops before the steps that need a browser.
2. **Logs in**, if the site needs a login. A browser window opens on Site A; log in, then press Enter in the terminal.
3. **Finds the routes on Site A** from its sitemap (`robots.txt`, `/sitemap.xml`, `/sitemap_index.xml`). If there is no sitemap, or the site is a single-page app, it crawls the site by following links instead. Logout links and links that change data (delete, add, remove, publish, and similar) are skipped.
4. **Copies the routes to Site B** with only the domain changed, so both sites are captured page for page.
5. **Takes full-height screenshots** of every route on both sites. If Site B needs a login, a window opens for it too, because a session doesn't carry across domains.
6. **Compares** each pair of screenshots, and writes the results plus `report.html` if you asked for one.

Everything runs in the background unless a login window is needed.

## Output

```
projects/<name>/
├── noktra.config.json      your answers, for reruns
├── site-a/                 routes.json, screenshots/, capture-manifest.json, auth-state.json (login only)
├── site-b/                 routes.json, screenshots/, capture-manifest.json
├── diffs/                  one diff image per page, changed pixels in red
├── diff-result.json        pass/fail and the changed-pixel percentage per page
└── report.html             side-by-side, overlay and swipe views (optional)
```

Running the wizard again for an existing project asks before deleting the previous results.

## Rerunning a project

Your answers are saved to `projects/<name>/noktra.config.json`:

```json
{
  "version": 1,
  "projectName": "my-site",
  "siteAUrl": "https://www.example.com",
  "siteBUrl": "https://staging.example.com",
  "requireAuth": true,
  "httpUsername": "preview",
  "requireLogin": false,
  "isAnSPA": false,
  "maxRoutes": 30,
  "generateReport": true
}
```

Pass it with `--config` to skip the questions. If you start the wizard without `--config`, its first question asks for a config path; leave it empty to answer the questions instead. Any value that's missing or invalid is asked for as usual, so a config can be partial.

## Environment variables

| Variable | Description |
|---|---|
| `NOKTRA_HTTP_PASSWORD` | The HTTP authentication password. When set, the wizard doesn't ask for it. The password is never written to the config file. |

## Security

`site-a/auth-state.json` holds your login session: anyone with the file can act as you until the session expires. Keep the `projects/` folder private and out of version control, and delete the file when you no longer need it.

## License

MIT
