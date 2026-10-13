# noktra-snapshot

Takes screenshots of one URL, or of every route in a `routes.json`, with Chromium. Screenshots cover the whole height of the page by default, including app layouts that scroll inside an inner panel, and fixed or sticky headers stay at the top.

Part of [noktra](https://github.com/the-marolie/noktra), a visual regression testing toolkit. For the complete workflow (find routes, screenshot two sites, compare them), install [`noktra`](https://www.npmjs.com/package/noktra).

## Install

```bash
npm install noktra-snapshot
npx playwright install chromium   # one-time browser download (~150 MB)
```

Requires Node.js 20 or newer.

## Command line

```bash
noktra-snapshot --url <url> [options]
noktra-snapshot --routes <routes.json> [options]
```

| Option | Description | Default |
|---|---|---|
| `--url <url>` | Capture a single URL | — |
| `--routes <file>` | Capture every `"ok"` route in a route manifest from `noktra-crawler` | — |
| `--auth-state <file>` | Use a saved login session (from `noktra-crawl --auth-state`) | — |
| `--login` | Open a visible browser to log in, then capture in that window | off |
| `--out <dir>` | Folder for the screenshots | `./screenshots` |
| `--manifest <file>` | Where to write the capture manifest | `<out>/capture-manifest.json` |
| `--width <px>` | Viewport width | `1280` |
| `--height <px>` | Viewport height | `720` |
| `--viewport-only` | Capture only the visible viewport instead of the whole page | off |
| `--timeout <ms>` | Navigation timeout per page | `30000` |
| `--help` | Show usage | — |

Give exactly one of `--url` or `--routes`, and at most one of `--auth-state` or `--login`.

```bash
noktra-snapshot --url https://example.com
noktra-snapshot --routes routes.json --auth-state auth-state.json --out run-1
noktra-snapshot --url https://app.example.com/dashboard --login
```

**Exit codes:** `0` every page captured, `2` some pages failed or needed a login, `1` error (bad input, unreadable JSON, Chromium failed to launch).

Screenshots are named by position and path, for example `001-home.png` and `002-blog-post-x-1.png`.

## Logging in

There are two ways to capture pages behind a login:

- **A saved session (`--auth-state`).** Log in once with `noktra-crawl --auth-state auth-state.json`, then reuse the file. Capturing runs in the background. A session only works for the hostname it was saved on, and the engine warns when the file has no cookies for the pages you're capturing.
- **Log in now (`--login`).** A browser window opens on the first URL. Log in, press Enter in the terminal, and every page is captured in that same window. Use this when a site keeps its session somewhere a saved file can't restore.

If a page redirects to a URL containing `login`, `signin`, `sign-in`, `auth` or `sso`, it is recorded as `auth_required` instead of being screenshotted. A login form shown without a redirect can't be detected, so check your screenshots.

## Full-page capture

Before each screenshot, the engine:

1. Scrolls through the page and any inner scroll panels, so lazy-loaded content appears.
2. Returns everything to the top, overriding the site's smooth scrolling so fixed and sticky elements are in place.
3. If the page itself doesn't scroll but an inner panel does (common in dashboards), makes the viewport tall enough to show the whole panel.

Screenshots are capped at 20,000 px tall. When a page has several inner scroll panels side by side, only the largest one is expanded. Use `--viewport-only` (or `fullPage: false`) for viewport-sized screenshots.

## JavaScript API

```js
import { captureUrls, readJsonFile, urlsFromRouteManifest } from "noktra-snapshot";

const routes = await readJsonFile("routes.json", "Route manifest");
const manifest = await captureUrls({
  urls: urlsFromRouteManifest(routes),
  outputDir: "screenshots",
  storageState: await readJsonFile("auth-state.json", "Auth state"),   // optional
});
```

### `captureUrls(options)`

Captures every URL and returns a capture manifest.

| Option | Type | Default | Description |
|---|---|---|---|
| `urls` | string[] | required | Pages to capture |
| `outputDir` | string | `"./screenshots"` | Folder for the PNG files |
| `width` | number | `1280` | Viewport width |
| `height` | number | `720` | Viewport height |
| `fullPage` | boolean | `true` | Capture the whole page height |
| `timeoutMs` | number | `30000` | Navigation timeout per page |
| `storageState` | object | — | A saved login session |
| `httpCredentials` | `{ username, password }` | — | HTTP authentication |
| `context` | Playwright `BrowserContext` | — | An already logged-in context to capture in, from `loginAndKeepBrowser()` |
| `log` | `(message) => void` | `console.log` | Progress output |

### Other exports

| Export | Description |
|---|---|
| `loginAndKeepBrowser(url, viewport, log, httpCredentials?)` | Open a visible browser, wait for the user to log in, and return `{ browser, context }` to pass to `captureUrls()`. Close `browser` when done. |
| `isChromiumInstalled()` | Whether Playwright's Chromium is installed and can start |
| `installChromium()` | Run Playwright's installer for Chromium, showing its progress; resolves to `true` on success |
| `readJsonFile(path, label)` | Read and parse JSON, with a clear error naming the file |
| `urlsFromRouteManifest(manifest)` | The URLs of every `"ok"` route in a route manifest |
| `fileNameForUrl(url, index)` | The screenshot file name for a URL |
| `readPngSize(path)` | Width and height from a PNG file's header |
| `looksLikeLoginRedirect(requestedUrl, finalUrl)` | Whether a redirect looks like a login page |

## Output: capture-manifest.json

```jsonc
{
  "schemaVersion": 1,
  "createdAt": "2026-10-14T12:05:00.000Z",
  "viewport": { "width": 1280, "height": 720, "fullPage": true },
  "outputDir": "screenshots",
  "captures": [
    {
      "url": "https://example.com/",
      "imagePath": "screenshots/001-home.png",
      "width": 1280,
      "height": 2140,              // real image size, read from the PNG
      "status": "ok",              // "ok", "error" or "auth_required"
      "error": null,
      "finalUrl": "https://example.com/"
    }
  ]
}
```

## License

MIT
