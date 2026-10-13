# noktra

Visual regression testing for websites: point it at two sites (for example production and staging), and it finds the pages, screenshots every page on both, compares them pixel by pixel and writes an HTML report.

This package installs the whole toolkit:

| Package | What it is | Command |
|---|---|---|
| [`noktra-cli`](https://www.npmjs.com/package/noktra-cli) | The interactive wizard that runs everything end to end | `noktra` (or `noktra-cli`) |
| [`noktra-crawler`](https://www.npmjs.com/package/noktra-crawler) | Finds a site's routes from its sitemap, or by crawling | `noktra-crawl` |
| [`noktra-snapshot`](https://www.npmjs.com/package/noktra-snapshot) | Takes full-height screenshots of a list of routes | `noktra-snapshot` |
| [`noktra-diff`](https://www.npmjs.com/package/noktra-diff) | Compares screenshots and writes diff images and an HTML report | `noktra-diff` |

Only need one piece? Each package can be installed on its own, e.g. `npm install noktra-diff`.

## Quick start

```bash
npm install -g noktra             # installs all four packages and all five commands
npx playwright install chromium   # one-time browser download (~150 MB)
noktra-cli                        # run the wizard (`noktra` does the same)
```

After a global install the commands are on your PATH, so no `npx` is needed: `noktra`, `noktra-cli`, `noktra-crawl`, `noktra-snapshot` and `noktra-diff`.

Other ways to run it:

```bash
npx noktra                        # without installing anything
npm install -D noktra             # in a project; then: npx noktra-cli
```

Requires Node.js 20 or newer.

## Rerunning a project

The wizard saves your answers to `projects/<name>/noktra.config.json`. Load them to skip the questions:

```bash
noktra-cli --config projects/<name>/noktra.config.json
```

See the [`noktra-cli` README](https://www.npmjs.com/package/noktra-cli) for everything the wizard does and the files it writes.

## Using the engines from code

Installing `noktra` also makes the engines importable:

```js
import { discoverSitemapRoutes, crawlSite } from "noktra-crawler";
import { captureUrls } from "noktra-snapshot";
import { compareManifests } from "noktra-diff";
import { writeHtmlReport } from "noktra-diff/report";
```

## License

MIT
