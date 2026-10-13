// Import Playwright's Chromium launcher. Playwright drives real browsers from Node.js.
// `request` makes plain HTTP requests (no browser) that can share a login session with the browser.
import { chromium, request } from "playwright";
// Import Node's promise-based file system module so we can write JSON files with `await`.
import fs from "node:fs/promises";
// Import Node's path helpers so we can create output directories safely on any OS.
import path from "node:path";
// Import readline so we can pause and wait for the user to press Enter after logging in.
import readline from "node:readline/promises";
// Import gunzip so compressed sitemaps (sitemap.xml.gz) can be read.
import { gunzipSync } from "node:zlib";

// The version number written into routes.json so future tools know how to read it.
export const ROUTES_SCHEMA_VERSION = 1;

/**
 * Pause the program and wait until the user presses Enter in the terminal.
 * @param {string} message The prompt text shown to the user.
 * @returns {Promise<void>} Resolves once the user presses Enter.
 */
export async function waitForEnter(message) {
  // Create a readline interface that reads from the terminal input and writes to its output.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // Show the message and wait for one line of input (pressing Enter is enough).
  await rl.question(message);
  // Close the interface so Node can exit cleanly later.
  rl.close();
}

/**
 * Add a protocol to a URL typed without one, e.g. "example.com" -> "https://example.com".
 * Local addresses get http:// because dev servers rarely serve HTTPS.
 * @param {string} rawUrl A URL, with or without a protocol.
 * @returns {string} The URL with a protocol; URLs that already have one are returned unchanged.
 */
export function withProtocol(rawUrl) {
  const trimmed = rawUrl.trim();
  // Already has a scheme like "https://" (or "ftp://", which normalizeUrl rejects later).
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return trimmed;
  // "//example.com" is protocol-relative; drop the slashes before adding one.
  const bare = trimmed.replace(/^\/+/, "");
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(bare);
  return `${isLocal ? "http" : "https"}://${bare}`;
}

/**
 * Turn a URL into a canonical form so the same page is not visited twice.
 * @param {string} rawUrl A possibly relative URL found on a page.
 * @param {string} baseUrl The page the link was found on (used to resolve relative links).
 * @returns {string|null} The normalized absolute URL, or null if it cannot be parsed.
 */
export function normalizeUrl(rawUrl, baseUrl) {
  // Wrap parsing in try/catch because `new URL()` throws on invalid input like "javascript:void(0)".
  try {
    // Resolve the link against the base page, e.g. "/about" + "https://a.com/x" -> "https://a.com/about".
    const parsed = new URL(rawUrl, baseUrl);
    // Only http and https links are crawlable; skip mailto:, tel:, javascript:, etc.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      // Returning null tells the caller to ignore this link.
      return null;
    }
    // Remove the "#section" fragment because it never changes which page the server returns.
    parsed.hash = "";
    // Return the cleaned-up absolute URL as a string.
    return parsed.href;
  } catch {
    // Any parsing failure means the link is not usable, so ignore it.
    return null;
  }
}

/**
 * Check whether two URLs belong to the same website (same protocol + host + port).
 * @param {string} urlA First absolute URL.
 * @param {string} urlB Second absolute URL.
 * @returns {boolean} True when both URLs share the same origin.
 */
export function isSameOrigin(urlA, urlB) {
  // `origin` is "https://example.com" without the path, so comparing it tells us if the site matches.
  return new URL(urlA).origin === new URL(urlB).origin;
}

// Links that end the logged-in session, e.g. "/logout", "/sign-out", or a "Log off" button.
// The (?<![a-z]) guard stops matches inside other words, e.g. "catalog-outlet".
export const LOGOUT_PATTERNS = [
  /(?<![a-z])log[\s_-]?out/i,
  /(?<![a-z])log[\s_-]?off/i,
  /(?<![a-z])sign[\s_-]?out/i,
  /(?<![a-z])sign[\s_-]?off/i,
];

// Links that change data just by being opened (a GET request), e.g. "/cart/add/5", "/posts/3/delete",
// "?action=remove", or an "Add to cart" link. The word must start a path segment, query key/value, or word of
// link text, and be a whole word: "/address", "/updates" and slugs like "/how-to-delete-your-account" are still crawled.
// Form pages such as "/new" or "/edit" are left alone: opening them only shows a form.
export const CONTENT_CHANGING_PATTERNS = [
  /(?:^|[\s/?&=])(delete|remove|destroy|trash|purge|add|cancel|approve|reject|publish|unpublish|toggle|duplicate|clone|unsubscribe)(?![a-z])/i,
];

// Links matching any of these are never visited. Matched against the URL and the link text.
export const DEFAULT_EXCLUDE_PATTERNS = [...LOGOUT_PATTERNS, ...CONTENT_CHANGING_PATTERNS];

// Link text longer than this is treated as content (e.g. a post titled "How to delete your account"), not an action.
const MAX_ACTION_TEXT_WORDS = 4;

/**
 * Check whether a link should be skipped because its URL or text matches an exclude pattern.
 * @param {string} url Normalized absolute URL of the link.
 * @param {string} text Visible text of the link (empty when unknown).
 * @param {RegExp[]} patterns Patterns to test.
 * @returns {boolean} True when the link must not be visited.
 */
export function isExcludedLink(url, text, patterns) {
  // Split camelCase into words ("deleteUser" -> "delete-User") so whole-word patterns still match.
  const splitWords = (value) => value.replace(/([a-z])([A-Z])/g, "$1-$2");
  // Test only the path and query so a domain like "signoff.com" does not exclude every page.
  const { pathname, search } = new URL(url);
  const target = splitWords(pathname + search);
  // Only short, button-like link text counts.
  const words = text.trim().split(/\s+/).filter(Boolean);
  const actionText = words.length <= MAX_ACTION_TEXT_WORDS ? splitWords(text) : "";
  return patterns.some((pattern) => pattern.test(target) || pattern.test(actionText));
}

/**
 * Write a JSON file, creating parent directories first, with optional restrictive permissions.
 * @param {string} filePath Where to write the file.
 * @param {object} data Any JSON-serializable value.
 * @param {number} [mode] Optional Unix permission bits (e.g. 0o600 = owner read/write only).
 * @returns {Promise<void>} Resolves when the file is written.
 */
export async function writeJsonFile(filePath, data, mode) {
  // Make sure the folder exists; `recursive: true` also makes it a no-op if it already exists.
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // Convert the data to pretty-printed JSON (2-space indent) so humans can read it.
  const text = JSON.stringify(data, null, 2);
  // Write the text to disk; the `mode` option is ignored on Windows, which is a documented limitation.
  await fs.writeFile(filePath, text, { mode });
}

/**
 * Open a visible browser on the site, let the user log in, and save the session (cookies + localStorage).
 * Run this before discoverSitemapRoutes() or crawlSite() on sites behind a login, and pass the result as `storageState`.
 *
 * @param {object} options Login settings.
 * @param {string} options.startUrl The page to open for logging in.
 * @param {string} [options.authStatePath] If set, also write the session to this file.
 * @param {{username: string, password: string}} [options.httpCredentials] Credentials for HTTP (basic) authentication.
 * @param {number} [options.timeoutMs=15000] Navigation timeout in milliseconds.
 * @param {(msg: string) => void} [options.log] Logging function; defaults to console.log.
 * @returns {Promise<object>} The Playwright storage state.
 */
export async function saveLoginState(options) {
  const startUrl = normalizeUrl(withProtocol(options.startUrl), undefined);
  if (!startUrl) {
    throw new Error(`Invalid start URL: "${options.startUrl}". Use a full address like https://example.com`);
  }
  const log = options.log ?? console.log;
  let browser;
  try {
    // Visible, because the user types their credentials into it.
    browser = await chromium.launch({ headless: false });
  } catch (error) {
    throw new Error(
      `Could not launch Chromium. Run "npx playwright install chromium" first.\nDetails: ${error.message}`
    );
  }
  try {
    const context = await browser.newContext({ httpCredentials: options.httpCredentials });
    const page = await context.newPage();
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs ?? 15000 });
    await waitForEnter("\nLog in in the browser window, then press Enter here to continue... ");
    const state = await context.storageState();
    if (options.authStatePath) {
      // 0o600 so only the current user can read it (ignored on Windows).
      await writeJsonFile(options.authStatePath, state, 0o600);
      log(`Saved authentication state to ${options.authStatePath} (keep this file private)`);
    }
    return state;
  } finally {
    await browser.close();
  }
}

/**
 * Crawl a website starting from one URL and discover same-origin pages by following links.
 *
 * @param {object} options Crawl settings.
 * @param {string} options.startUrl The first page to open.
 * @param {number} [options.maxPages=25] Stop after this many pages have been visited.
 * @param {number} [options.timeoutMs=15000] Per-page navigation timeout in milliseconds.
 * @param {boolean} [options.waitForLogin=true] Pause so the user can log in before crawling.
 * @param {boolean} [options.headless=!waitForLogin] Run without a visible window; by default a window is shown only for login.
 * @param {string} [options.authStatePath] If set, save cookies/localStorage here after login.
 * @param {{username: string, password: string}} [options.httpCredentials] Credentials for HTTP (basic) authentication.
 * @param {object} [options.storageState] A saved login session to start from (from saveLoginState()), instead of pausing for login.
 * @param {RegExp[]} [options.excludePatterns=DEFAULT_EXCLUDE_PATTERNS] Links matching these are skipped (logout links by default).
 * @param {(msg: string) => void} [options.log] Logging function; defaults to console.log.
 * @returns {Promise<object>} The route manifest object (same shape as routes.json).
 */
export async function crawlSite(options) {
  // Pull each option out with a sensible default so callers only pass what they need.
  const startUrl = options.startUrl;
  const maxPages = options.maxPages ?? 25;
  const timeoutMs = options.timeoutMs ?? 15000;
  const waitForLogin = options.waitForLogin ?? true;
  const headless = options.headless ?? !waitForLogin;
  const authStatePath = options.authStatePath;
  const httpCredentials = options.httpCredentials;
  const storageState = options.storageState;
  const excludePatterns = options.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;
  const log = options.log ?? console.log;

  // Validate the starting URL up front so the user gets a clear message instead of a browser error.
  // Accept addresses typed without a protocol, e.g. "example.com".
  const normalizedStart = normalizeUrl(withProtocol(startUrl), undefined);
  // If normalization failed the URL is not a valid http(s) address.
  if (!normalizedStart) {
    // Throw an Error with a human-readable message; the CLI prints it and exits with a failure code.
    throw new Error(`Invalid start URL: "${startUrl}". Use a full address like https://example.com`);
  }

  // Declare the browser variable outside try so the `finally` block can close it.
  let browser;
  // Wrap the launch in try/catch to turn Playwright's error into a friendlier one.
  try {
    // Show a window only when the user has to log in by hand; otherwise crawl in the background.
    browser = await chromium.launch({ headless });
  } catch (error) {
    // Most launch failures mean the browser binary was never downloaded.
    throw new Error(
      `Could not launch Chromium. Run "npx playwright install chromium" first.\nDetails: ${error.message}`
    );
  }

  // A browser context is an isolated browser profile (its own cookies and storage).
  // When HTTP credentials are given, Playwright answers the site's basic-auth challenge automatically.
  const context = await browser.newContext({ httpCredentials, storageState });
  // A page is a single tab inside that context.
  const page = await context.newPage();

  // `discovered` maps a URL to its route record; a Map keeps insertion order and prevents duplicates.
  const discovered = new Map();
  // `queue` holds URLs we still need to visit; we process it first-in, first-out (breadth-first).
  const queue = [normalizedStart];
  // Count visited pages so we can stop at `maxPages`.
  let visitedCount = 0;

  // Listen for navigations caused by client-side routing (e.g. a React router pushState).
  page.on("framenavigated", (frame) => {
    // Only care about the main frame, not iframes embedded in the page.
    if (frame !== page.mainFrame()) {
      // Ignore iframes.
      return;
    }
    // Normalize the URL the frame navigated to.
    const navigatedUrl = normalizeUrl(frame.url(), undefined);
    // Add it to the queue if it is new and on the same site.
    if (navigatedUrl && isSameOrigin(navigatedUrl, normalizedStart) && !isExcludedLink(navigatedUrl, "", excludePatterns) && !discovered.has(navigatedUrl) && !queue.includes(navigatedUrl)) {
      // Queue it so it gets visited and recorded like any other link.
      queue.push(navigatedUrl);
    }
  });

  // Use try/finally so the browser is always closed, even if something throws mid-crawl.
  try {
    // Open the start page first so the user can see the site and log in if needed.
    await page.goto(normalizedStart, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    // Only pause when the caller asked for the login step.
    if (waitForLogin) {
      // Tell the user what to do; the browser window is already open.
      await waitForEnter("\nLog in in the browser window if needed, then press Enter here to start crawling... ");
    }

    // Export authentication state only when a path was given.
    if (authStatePath) {
      // `storageState()` returns cookies and localStorage for every origin visited in this context.
      const state = await context.storageState();
      // Write it with 0o600 so only the current user can read it (ignored on Windows).
      await writeJsonFile(authStatePath, state, 0o600);
      // Let the user know where the sensitive file went.
      log(`Saved authentication state to ${authStatePath} (keep this file private)`);
    }

    // Keep crawling while there are URLs left and we have not hit the page limit.
    while (queue.length > 0 && visitedCount < maxPages) {
      // Take the next URL from the front of the queue.
      const currentUrl = queue.shift();
      // Skip if we already visited it (can happen when the same link is queued from two pages).
      if (discovered.has(currentUrl)) {
        // Move on to the next queued URL.
        continue;
      }
      // Count this visit toward the limit.
      visitedCount += 1;
      // Show progress in the terminal.
      log(`[${visitedCount}/${maxPages}] Visiting ${currentUrl}`);

      // Start a route record with "pending" status; it is updated below.
      const route = { url: currentUrl, title: null, status: "pending", error: null };
      // Register it immediately so it is not queued again.
      discovered.set(currentUrl, route);

      // Each page visit is wrapped in try/catch so one broken page does not stop the whole crawl.
      try {
        // Navigate; "domcontentloaded" fires once the HTML is parsed, which is faster than "load".
        await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        // Give JavaScript-rendered apps a moment to finish network requests, but do not fail if they never go idle.
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        // Read the <title> text, or null if the page has none.
        route.title = (await page.title()) || null;
        // If the server redirected us, record the final URL too so it is not visited twice.
        const finalUrl = normalizeUrl(page.url(), undefined);
        // Only add the final URL when it differs from what we requested and is on the same site.
        if (finalUrl && finalUrl !== currentUrl && isSameOrigin(finalUrl, normalizedStart) && !discovered.has(finalUrl)) {
          // Record the redirect target as its own route sharing the same title.
          discovered.set(finalUrl, { url: finalUrl, title: route.title, status: "ok", error: null });
        }
        // Collect every href from every <a> element in the rendered DOM (works for SPAs too).
        // The link text is collected too, so a "Log out" link with an unhelpful URL can still be skipped.
        const links = await page.$$eval("a[href]", (anchors) =>
          anchors.map((a) => ({ href: a.getAttribute("href"), text: (a.textContent || a.getAttribute("aria-label") || "").trim() }))
        );
        // Go through each link found on the page.
        for (const { href, text } of links) {
          // Resolve relative links against the current page and clean them up.
          const linkUrl = normalizeUrl(href, currentUrl);
          // Keep only valid, same-site links that we have not seen or queued yet.
          if (linkUrl && isSameOrigin(linkUrl, normalizedStart) && !isExcludedLink(linkUrl, text, excludePatterns) && !discovered.has(linkUrl) && !queue.includes(linkUrl)) {
            // Add to the end of the queue so it is visited after the pages already waiting.
            queue.push(linkUrl);
          }
        }
        // Everything worked for this page.
        route.status = "ok";
      } catch (error) {
        // Record the failure on the route instead of hiding it; the crawl continues.
        route.status = "error";
        // Keep the message short but informative (timeouts are the most common cause).
        route.error = error.message.split("\n")[0];
        // Also print it so the user sees it live.
        log(`  Failed: ${route.error}`);
      }
    }
  } finally {
    // Close the browser window whether the crawl succeeded or threw.
    await browser.close();
  }

  // Build the manifest object that will become routes.json.
  const manifest = {
    // Lets readers detect the file format.
    schemaVersion: ROUTES_SCHEMA_VERSION,
    // The URL the crawl began from.
    startUrl: normalizedStart,
    // When the crawl ran, in ISO format.
    createdAt: new Date().toISOString(),
    // "complete" means the queue emptied; "limited" means we stopped because of maxPages.
    discoveryStatus: queue.length === 0 ? "complete" : "limited",
    // How the routes were found: "crawl" here, "sitemap" for discoverSitemapRoutes().
    discoverySource: "crawl",
    // Convert the Map values into a plain array for JSON.
    routes: Array.from(discovered.values()),
  };
  // Hand the manifest back to the caller (the CLI writes it to disk).
  return manifest;
}

// How many sitemap files to read at most, so a huge sitemap index cannot make discovery run forever.
const MAX_SITEMAP_FILES = 50;

/**
 * Fetch a URL as text, returning null instead of throwing when it is missing or unreachable.
 * @param {object} api A Playwright APIRequestContext (carries cookies and HTTP credentials).
 * @param {string} url The URL to fetch.
 * @returns {Promise<{text: string, finalUrl: string}|null>} The body and the URL after redirects, or null.
 */
async function fetchText(api, url) {
  try {
    // Redirects are followed automatically; `res.url()` is where it ended up.
    const res = await api.get(url);
    // 404s, 401s and server errors all mean "no usable file here".
    if (!res.ok()) return null;
    const bytes = await res.body();
    // Gzip files start with the bytes 1f 8b; servers often send .xml.gz without decoding it for us.
    const body = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
    return { text: body.toString("utf8"), finalUrl: res.url() };
  } catch {
    // Network errors and timeouts are treated the same as a missing file.
    return null;
  }
}

/**
 * Pull the <loc> values out of a sitemap or sitemap index.
 * @param {string} xml The sitemap XML text.
 * @returns {{isIndex: boolean, locs: string[]}|null} The URLs, whether they point at more sitemaps, or null if this is not a sitemap.
 */
export function parseSitemap(xml) {
  // A sitemap is a <urlset>; a sitemap index is a <sitemapindex>. Anything else (e.g. a login page) is not a sitemap.
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  if (!isIndex && !/<urlset[\s>]/i.test(xml)) return null;
  // Decode the five XML entities; "&amp;" is common in URLs with query strings.
  const decode = (value) =>
    value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name]);
  // <loc> may wrap its URL in CDATA, so strip that too.
  const locs = Array.from(xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*(.*?)\s*(?:\]\]>)?\s*<\/loc>/gis), (match) => decode(match[1]));
  return { isIndex, locs };
}

/**
 * Discover routes from the site's sitemap instead of crawling. Looks for "Sitemap:" lines in robots.txt,
 * then /sitemap.xml and /sitemap_index.xml, and follows sitemap indexes into the sitemaps they list.
 * No browser is launched, so this is fast and runs in the background. For sites behind a login, log in
 * first (see saveLoginState()) and pass the saved session as `storageState`.
 *
 * @param {object} options Discovery settings.
 * @param {string} options.startUrl Any URL on the site; only its origin is used.
 * @param {number} [options.maxPages=25] Stop after this many routes.
 * @param {number} [options.timeoutMs=15000] Per-request timeout in milliseconds.
 * @param {{username: string, password: string}} [options.httpCredentials] Credentials for HTTP (basic) authentication.
 * @param {object} [options.storageState] A saved login session (cookies) to send with every request.
 * @param {RegExp[]} [options.excludePatterns=DEFAULT_EXCLUDE_PATTERNS] Routes matching these are left out (logout links by default).
 * @returns {Promise<object|null>} A route manifest (same shape as crawlSite()), or null when no usable sitemap was found.
 */
export async function discoverSitemapRoutes(options) {
  const maxPages = options.maxPages ?? 25;
  const timeoutMs = options.timeoutMs ?? 15000;
  const excludePatterns = options.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;

  const normalizedStart = normalizeUrl(withProtocol(options.startUrl), undefined);
  if (!normalizedStart) {
    throw new Error(`Invalid start URL: "${options.startUrl}". Use a full address like https://example.com`);
  }
  // Every request goes through this context, so HTTP auth challenges are answered and login cookies are sent.
  const api = await request.newContext({
    httpCredentials: options.httpCredentials,
    storageState: options.storageState,
    timeout: timeoutMs,
  });
  try {
    return await readSitemaps(api, normalizedStart, maxPages, excludePatterns);
  } finally {
    await api.dispose();
  }
}

/**
 * The sitemap search behind discoverSitemapRoutes(), using an already configured request context.
 * @returns {Promise<object|null>} A route manifest, or null when no usable sitemap was found.
 */
async function readSitemaps(api, normalizedStart, maxPages, excludePatterns) {  // Follow redirects on the start page first (e.g. example.com -> www.example.com) so routes use the real origin.
  const startPage = await fetchText(api, normalizedStart);
  const origin = new URL(startPage?.finalUrl ?? normalizedStart).origin;

  // Sitemaps listed in robots.txt come first, then the two conventional locations.
  const candidates = [];
  const robots = await fetchText(api, `${origin}/robots.txt`);
  if (robots) {
    for (const match of robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) {
      candidates.push(match[1]);
    }
  }
  candidates.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`);

  // Breadth-first over sitemap files, collecting page URLs until maxPages is reached.
  const queue = [...new Set(candidates)];
  const seenSitemaps = new Set();
  const routes = new Map();
  let foundSitemap = false;
  while (queue.length > 0 && routes.size < maxPages && seenSitemaps.size < MAX_SITEMAP_FILES) {
    const sitemapUrl = queue.shift();
    if (seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);
    const file = await fetchText(api, sitemapUrl);
    const parsed = file && parseSitemap(file.text);
    if (!parsed) continue;
    foundSitemap = true;
    if (parsed.isIndex) {
      // An index lists more sitemaps; read those next.
      queue.push(...parsed.locs);
      continue;
    }
    for (const loc of parsed.locs) {
      const url = normalizeUrl(loc, origin);
      // Same rules as the crawler: same site only, no logout links, no duplicates.
      if (url && isSameOrigin(url, origin) && !isExcludedLink(url, "", excludePatterns) && !routes.has(url)) {
        // Listed routes were not visited, but "ok" lets the snapshot engine capture them; failures show up there.
        routes.set(url, { url, title: null, status: "ok", error: null });
        if (routes.size >= maxPages) break;
      }
    }
  }

  // No sitemap, or one with no pages on this site: let the caller fall back to crawling.
  if (!foundSitemap || routes.size === 0) return null;
  return {
    schemaVersion: ROUTES_SCHEMA_VERSION,
    startUrl: `${origin}/`,
    createdAt: new Date().toISOString(),
    // "limited" when we stopped at maxPages with sitemap entries still unread.
    discoveryStatus: routes.size >= maxPages ? "limited" : "complete",
    discoverySource: "sitemap",
    routes: Array.from(routes.values()),
  };
}
