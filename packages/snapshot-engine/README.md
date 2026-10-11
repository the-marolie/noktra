# noktra-snapshot-engine

Captures PNG screenshots of one URL or of every route in a crawler `routes.json`, in headless Chromium.

## Files

- `src/index.js` – API: `captureUrls()`, `loginInteractively()`, `readJsonFile()`, `urlsFromRouteManifest()`, `fileNameForUrl()`, `readPngSize()`, `looksLikeLoginRedirect()`.
- `src/cli.js` – command-line wrapper.
- `package.json` – ES module, dependency: `playwright`.

## Authentication workflows

**Workflow A – imported state:** pass `--auth-state auth-state.json` (from the crawler). The file is loaded into the headless browser context via Playwright's `storageState` option.

**Workflow B – standalone login:** pass `--login`. A visible browser opens on the first URL; log in, press Enter. The session is captured with `storageState()`, the visible browser closes, and capture continues headlessly.

**No auth:** pass neither.

Expired or wrong-site sessions: if a page redirects to a URL containing `login`, `signin`, `sign-in`, `auth`, or `sso`, the capture is marked `status: "auth_required"` and the command exits 2. The engine also warns when the auth state has no cookies for the target hostname (cookies and localStorage are per-origin). It never tries to bypass MFA or security controls.

## CLI

```bash
npm run snapshot -- --url https://example.com
npm run snapshot -- --routes ./routes.json --auth-state ./auth-state.json --out ./run-1
npm run snapshot -- --url https://app.example.com/dashboard --login --full-page

--url / --routes      input (one required)
--auth-state / --login  authentication (optional, not both)
--out <dir>           screenshot folder (default ./screenshots)
--manifest <file>     capture manifest path (default <out>/capture-manifest.json)
--width / --height    viewport in px (default 1280x720)
--full-page           capture the whole scrollable page
--timeout <ms>        per-page navigation timeout (default 30000)
```

Exit codes: 0 all captured, 2 some captures failed or need auth, 1 error (bad input, missing/invalid JSON, browser launch failure).

File naming: `001-home.png`, `002-blog-post-x-1.png` (index + URL path/query with non-alphanumerics replaced by `-`).

## JavaScript API

```js
import { captureUrls } from "noktra-snapshot-engine";

const manifest = await captureUrls({
  urls: ["https://example.com/"],
  outputDir: "./shots",
  width: 1280, height: 720,
  fullPage: true,
  storageState: undefined,   // or JSON.parse(fs.readFileSync("auth-state.json"))
});
```

## Output: capture-manifest.json

See the root README. Image `width`/`height` are read from the PNG header after writing, so full-page heights are accurate.
