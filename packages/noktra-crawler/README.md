# noktra-crawler

Finds the routes (page URLs) of a website and writes them to `routes.json`. It can read the site's sitemap or crawl the site in Chromium by following links, and it handles login: you log in by hand in a real browser window, and the session is saved for later steps.

Part of [noktra](https://github.com/the-marolie/noktra), a visual regression testing toolkit. For the complete workflow (find routes, screenshot two sites, compare them), install [`noktra`](https://www.npmjs.com/package/noktra).

## Install

```bash
npm install noktra-crawler
npx playwright install chromium   # one-time browser download (~150 MB)
```

Requires Node.js 20 or newer. Sitemap discovery doesn't need Chromium; crawling and login do.

## Command line

```bash
noktra-crawl <startUrl> [options]
```

The command crawls the site by following links. A browser window opens first so you can log in; press Enter in the terminal when you're ready. For public sites, pass `--skip-login` and the crawl runs in the background.

| Option | Description | Default |
|---|---|---|
| `--out <file>` | Where to write the route manifest | `./routes.json` |
| `--auth-state <file>` | Also save the login session (cookies and localStorage) to this file. Sensitive. | — |
| `--max-pages <n>` | Stop after visiting this many pages | `25` |
| `--timeout <ms>` | Navigation timeout per page | `15000` |
| `--skip-login` | Don't pause for login; crawl headless | off |
| `--help` | Show usage | — |

The start URL can be given without `https://`.

```bash
noktra-crawl example.com --skip-login --max-pages 10
noktra-crawl https://app.example.com --auth-state auth-state.json
```

**Exit codes:** `0` success (pages that failed to load are recorded in the output, not treated as an error), `1` error (invalid URL, Chromium failed to launch, output couldn't be written).

## How crawling works

- Breadth-first from the start URL: each page is opened, given up to 5 seconds to finish network activity, its title is recorded, and every `<a href>` on the same origin that hasn't been seen is queued.
- Client-side navigation in single-page apps (`pushState`) is followed too.
- Redirect targets are recorded as their own routes.
- Logout links and links that change data are never visited (see [Excluded links](#excluded-links)).
- Crawling stops when the queue is empty or the page limit is reached.

## JavaScript API

```js
import { discoverSitemapRoutes, crawlSite, saveLoginState, writeJsonFile } from "noktra-crawler";

// Use the sitemap when there is one, otherwise crawl.
const manifest =
  (await discoverSitemapRoutes({ startUrl: "example.com", maxPages: 30 })) ??
  (await crawlSite({ startUrl: "example.com", maxPages: 30, waitForLogin: false }));

await writeJsonFile("routes.json", manifest);
```

### `discoverSitemapRoutes(options)`

Reads the site's sitemap without launching a browser. It checks `Sitemap:` lines in `robots.txt`, then `/sitemap.xml` and `/sitemap_index.xml`, follows sitemap indexes, and reads gzipped sitemaps. Returns a route manifest, or `null` when no usable sitemap was found.

| Option | Type | Default | Description |
|---|---|---|---|
| `startUrl` | string | required | Any URL on the site; only its origin is used, after following redirects |
| `maxPages` | number | `25` | Stop after this many routes |
| `timeoutMs` | number | `15000` | Timeout per request |
| `httpCredentials` | `{ username, password }` | — | HTTP authentication |
| `storageState` | object | — | A saved login session, from `saveLoginState()` |
| `excludePatterns` | RegExp[] | `DEFAULT_EXCLUDE_PATTERNS` | Routes matching these are left out |

Only cookies from `storageState` are sent. Sitemap routes are marked `status: "ok"` without being visited.

### `crawlSite(options)`

Crawls the site in Chromium by following links. Returns a route manifest.

| Option | Type | Default | Description |
|---|---|---|---|
| `startUrl` | string | required | The first page to open |
| `maxPages` | number | `25` | Stop after visiting this many pages |
| `timeoutMs` | number | `15000` | Navigation timeout per page |
| `waitForLogin` | boolean | `true` | Pause for the user to log in before crawling |
| `headless` | boolean | `!waitForLogin` | Run without a visible window |
| `authStatePath` | string | — | Save the session to this file after the login pause |
| `httpCredentials` | `{ username, password }` | — | HTTP authentication |
| `storageState` | object | — | Start from a saved session instead of pausing for login |
| `excludePatterns` | RegExp[] | `DEFAULT_EXCLUDE_PATTERNS` | Links matching these are skipped |
| `log` | `(message) => void` | `console.log` | Progress output |

### `saveLoginState(options)`

Opens a visible browser on `startUrl`, waits for the user to log in and press Enter, then returns the session (cookies and localStorage) in Playwright's `storageState` format. Pass the result as `storageState` to `discoverSitemapRoutes()` or `crawlSite()`.

| Option | Type | Description |
|---|---|---|
| `startUrl` | string | The page to open for logging in |
| `authStatePath` | string | Also write the session to this file |
| `httpCredentials` | `{ username, password }` | HTTP authentication |
| `timeoutMs` | number | Navigation timeout, default `15000` |
| `log` | `(message) => void` | Output, default `console.log` |

### Helpers

| Export | Description |
|---|---|
| `writeJsonFile(path, data, mode?)` | Write pretty-printed JSON, creating folders as needed |
| `withProtocol(url)` | Add `https://` to a URL typed without a protocol (`http://` for localhost) |
| `normalizeUrl(url, base?)` | Resolve a URL and drop its `#fragment`; `null` for non-http(s) links |
| `isSameOrigin(a, b)` | Whether two URLs share protocol, host and port |
| `isExcludedLink(url, text, patterns)` | Whether a link matches an exclude pattern |
| `parseSitemap(xml)` | Extract `<loc>` URLs from a sitemap or sitemap index |
| `LOGOUT_PATTERNS`, `CONTENT_CHANGING_PATTERNS`, `DEFAULT_EXCLUDE_PATTERNS` | The built-in exclude patterns |

## Excluded links

To avoid ending the session or changing data, these links are never visited, whether found by crawling or in a sitemap:

- **Logout links:** "log out", "log off", "sign out" or "sign off" in the URL path or in short link text, in forms like `/logout`, `/sign-out` and `/users/sign_out`.
- **Links that change data:** delete, remove, destroy, trash, purge, add, cancel, approve, reject, publish, unpublish, toggle, duplicate, clone or unsubscribe at the start of a path segment or query value (`/cart/add/5`, `/posts/3/delete`, `?action=remove`, `/api/deleteUser`), or in short link text ("Add to cart", "Remove").

Words inside longer words or slugs, such as `/address`, `/updates` or `/blog/how-to-delete-your-account`, are still crawled. Pages like `/new` and `/edit` are crawled too, since opening them only shows a form. Pass your own `excludePatterns` to change the rules.

## Output: routes.json

```jsonc
{
  "schemaVersion": 1,
  "startUrl": "https://example.com/",
  "createdAt": "2026-10-14T12:00:00.000Z",
  "discoveryStatus": "complete",   // "complete", or "limited" when the page limit was reached
  "discoverySource": "crawl",      // "crawl" or "sitemap"
  "routes": [
    { "url": "https://example.com/", "title": "Example Domain", "status": "ok", "error": null },
    { "url": "https://example.com/missing", "title": null, "status": "error", "error": "page.goto: Timeout 15000ms exceeded." }
  ]
}
```

A page that fails to load is recorded with `status: "error"` and the crawl continues.

## Security

The auth state file is your login session: anyone with it can act as you until the session expires. It is written readable by your user only on macOS and Linux (Windows ignores this). Keep it private, never commit it, and delete it when you're done.

## License

MIT
