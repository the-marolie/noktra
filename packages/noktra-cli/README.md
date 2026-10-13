# noktra-cli

An interactive wizard for visual regression testing. Give it two sites (for example production and staging), and it discovers the pages, screenshots every page on both sites, compares them pixel by pixel and writes an HTML report.

To install this wizard together with all three engines in one go, install [`noktra`](https://www.npmjs.com/package/noktra) instead; it gives you the `noktra` command.

The wizard runs the three noktra engines, which are installed with it automatically:
[`noktra-crawler`](https://www.npmjs.com/package/noktra-crawler), [`noktra-snapshot`](https://www.npmjs.com/package/noktra-snapshot) and [`noktra-diff`](https://www.npmjs.com/package/noktra-diff).

## Install

```bash
npx playwright install chromium   # one-time browser download (~150 MB)
npx noktra-cli                    # run the wizard
```

Or install it globally with `npm install -g noktra-cli`, then run `noktra-cli`. Requires Node.js 20 or newer.

## What it does

The wizard asks for a project name, the two site URLs (the `https://` is optional), whether the sites need HTTP authentication or a login, whether the site is a single-page app, the maximum number of routes, and whether to write an HTML report. Then it:

1. **Logs in** (only if the site needs a login): a browser window opens on Site A; log in, then press Enter in the terminal.
2. **Finds the routes on Site A**: reads the sitemap (`robots.txt`, `/sitemap.xml`, `/sitemap_index.xml`). If there is no sitemap, or the site is a single-page app, it crawls the site by following links instead. Logout links and links that change data (delete, add, remove, ...) are skipped.
3. **Copies the routes to Site B** with only the domain changed, so both sites are captured page for page.
4. **Takes full-height screenshots** of every route on both sites. If Site B needs a login, a window opens for that too.
5. **Compares** each pair of screenshots and writes the results, plus `report.html` if you asked for it.

Everything runs in the background unless a login is needed.

## Output

Everything is written to `projects/<name>/` in the folder you run the wizard from:

```
projects/<name>/
  noktra.config.json    the answers you gave, for reruns
  site-a/               routes.json, screenshots/, capture-manifest.json, auth-state.json (login only)
  site-b/               routes.json, screenshots/, capture-manifest.json
  diffs/                one diff image per page
  diff-result.json      pass/fail and the changed-pixel percentage per page
  report.html           side-by-side report (optional)
```

## Rerunning a project

Your answers are saved to `projects/<name>/noktra.config.json`. Load them to skip the questions:

```bash
npx noktra-cli --config projects/<name>/noktra.config.json
```

Without `--config`, the first prompt asks for a config path; leave it empty to answer the questions instead. Any value missing from the config, or invalid, is asked for as usual.

The HTTP authentication password is never saved. Enter it when asked, or set it in the `NOKTRA_HTTP_PASSWORD` environment variable.

## Security

`auth-state.json` holds your login session. Keep the `projects/` folder private and out of version control.

## License

MIT
