# noktra

Visual regression testing for websites. Point noktra at two versions of a site (for example production and staging), and it finds the pages, takes a full-height screenshot of every page on both, compares them pixel by pixel, and writes an HTML report showing what changed.

This package installs the complete toolkit: the interactive wizard and all three engines, with every command.

## Install

```bash
npm install -g noktra
```

Requires Node.js 20 or newer. noktra uses Chromium (about 150 MB) through Playwright; the wizard checks for it on first run and offers to install it. You can also install it yourself with `npx playwright install chromium`.

## Usage

```bash
noktra-cli
```

The wizard asks for a project name, the two site URLs, whether the sites need HTTP authentication or a login, whether the site is a single-page app, the maximum number of routes, and whether to write an HTML report. It then discovers the routes, screenshots both sites, compares them and writes the results to `projects/<name>/`.

`noktra` starts the same wizard. To run it without installing anything, use `npx noktra`.

### Rerun a project

The wizard saves your answers to `projects/<name>/noktra.config.json`. Pass it back to skip the questions:

```bash
noktra-cli --config projects/<name>/noktra.config.json
```

The HTTP authentication password is never saved. Enter it when asked, or set it in the `NOKTRA_HTTP_PASSWORD` environment variable.

## What's included

| Package | What it does | Command |
|---|---|---|
| [`noktra-cli`](https://www.npmjs.com/package/noktra-cli) | The interactive wizard that runs the whole process | `noktra-cli` (also `noktra`) |
| [`noktra-crawler`](https://www.npmjs.com/package/noktra-crawler) | Finds a site's routes from its sitemap or by crawling; handles login | `noktra-crawl` |
| [`noktra-snapshot`](https://www.npmjs.com/package/noktra-snapshot) | Takes full-height screenshots of a URL or a list of routes | `noktra-snapshot` |
| [`noktra-diff`](https://www.npmjs.com/package/noktra-diff) | Compares screenshots, writes diff images and the HTML report | `noktra-diff` |

After a global install, all of these commands are on your PATH. Each package can also be installed on its own, for example `npm install noktra-diff` when you only need image comparison.

## Using the engines from code

Installing `noktra` makes the engines importable in your own scripts:

```js
import { discoverSitemapRoutes, crawlSite } from "noktra-crawler";
import { captureUrls } from "noktra-snapshot";
import { compareManifests } from "noktra-diff";
import { writeHtmlReport } from "noktra-diff/report";
```

Each package's page documents its API.

## Documentation

Full documentation, including how it works, the output files, security notes and limitations, is in the [project README on GitHub](https://github.com/the-marolie/noktra#readme).

## License

MIT
