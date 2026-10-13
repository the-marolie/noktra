# noktra-crawler-engine

Discovers routes on a website by following links in a real Chromium browser, with an optional pause for manual login.

## Files

- `src/index.js` – the API: `crawlSite()`, `normalizeUrl()`, `isSameOrigin()`, `writeJsonFile()`, `waitForEnter()`.
- `src/cli.js` – command-line wrapper.
- `package.json` – `"type": "module"` (ES modules), `"exports"` points at `src/index.js`, `"bin"` registers `noktra-crawl`, dependency: `playwright`.

## How it works

1. Launches Chromium and opens the start URL. The window is **visible** only when it waits for login; with `--skip-login` the crawl runs headless.
2. Waits for you to press Enter (log in first if needed). Skip with `--skip-login` on public sites.
3. If `--auth-state` is given, saves `context.storageState()` (cookies + localStorage) to that file with mode `0600`.
4. Breadth-first crawl: pop a URL from the queue, `page.goto()` it, wait up to 5 s for network idle, read the `<title>`, collect every `a[href]`, queue the same-origin ones not seen before. Repeat until the queue is empty or `--max-pages` is reached.
5. Also listens to Playwright's `framenavigated` event, so client-side route changes in SPAs (pushState) are queued too.
6. Writes `routes.json`.

Playwright terms: a **browser** is the Chromium process; a **context** is an isolated profile (cookies/storage); a **page** is a tab. `page.$$eval(selector, fn)` runs `fn` inside the page against all matching elements and returns the result to Node.

## CLI

```bash
npm run crawl -- <startUrl> [options]        # from repo root
node src/cli.js <startUrl> [options]         # from this folder

--out <file>         routes.json location (default ./routes.json)
--auth-state <file>  export login session here (sensitive)
--max-pages <n>      visit limit (default 25)
--timeout <ms>       per-page navigation timeout (default 15000)
--skip-login         do not pause for login
```

Example:

```bash
npm run crawl -- https://example.com --skip-login --max-pages 10
```

Exit codes: 0 success, 1 error (invalid URL, browser failed to launch, cannot write output).

## JavaScript API

```js
import { crawlSite } from "noktra-crawler-engine";   // or "./packages/crawler-engine/src/index.js"

const manifest = await crawlSite({
  startUrl: "https://example.com",
  maxPages: 10,
  waitForLogin: false,            // true pauses for Enter in the terminal
  authStatePath: "./auth-state.json",  // optional
});
console.log(manifest.routes);
```

## Output: routes.json

See the root README for the full field list. Individual page failures are recorded with `status: "error"` and the crawl continues; the command still exits 0 because partial results are useful.

## Security

`auth-state.json` is your session. Keep it private, never commit it, delete it when done. See the root README.
