// Import Playwright's Chromium launcher. Playwright drives real browsers from Node.js.
import { chromium } from "playwright";
// Import Node's promise-based file system module so we can write JSON files with `await`.
import fs from "node:fs/promises";
// Import Node's path helpers so we can create output directories safely on any OS.
import path from "node:path";
// Import readline so we can pause and wait for the user to press Enter after logging in.
import readline from "node:readline/promises";

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
 * Crawl a website starting from one URL and discover same-origin pages by following links.
 *
 * @param {object} options Crawl settings.
 * @param {string} options.startUrl The first page to open.
 * @param {number} [options.maxPages=25] Stop after this many pages have been visited.
 * @param {number} [options.timeoutMs=15000] Per-page navigation timeout in milliseconds.
 * @param {boolean} [options.waitForLogin=true] Pause so the user can log in before crawling.
 * @param {string} [options.authStatePath] If set, save cookies/localStorage here after login.
 * @param {(msg: string) => void} [options.log] Logging function; defaults to console.log.
 * @returns {Promise<object>} The route manifest object (same shape as routes.json).
 */
export async function crawlSite(options) {
  // Pull each option out with a sensible default so callers only pass what they need.
  const startUrl = options.startUrl;
  const maxPages = options.maxPages ?? 25;
  const timeoutMs = options.timeoutMs ?? 15000;
  const waitForLogin = options.waitForLogin ?? true;
  const authStatePath = options.authStatePath;
  const log = options.log ?? console.log;

  // Validate the starting URL up front so the user gets a clear message instead of a browser error.
  const normalizedStart = normalizeUrl(startUrl, undefined);
  // If normalization failed the URL is not a valid http(s) address.
  if (!normalizedStart) {
    // Throw an Error with a human-readable message; the CLI prints it and exits with a failure code.
    throw new Error(`Invalid start URL: "${startUrl}". Use a full address like https://example.com`);
  }

  // Declare the browser variable outside try so the `finally` block can close it.
  let browser;
  // Wrap the launch in try/catch to turn Playwright's error into a friendlier one.
  try {
    // Launch a visible (non-headless) Chromium window so the user can log in by hand.
    browser = await chromium.launch({ headless: false });
  } catch (error) {
    // Most launch failures mean the browser binary was never downloaded.
    throw new Error(
      `Could not launch Chromium. Run "npx playwright install chromium" first.\nDetails: ${error.message}`
    );
  }

  // A browser context is an isolated browser profile (its own cookies and storage).
  const context = await browser.newContext();
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
    if (navigatedUrl && isSameOrigin(navigatedUrl, normalizedStart) && !discovered.has(navigatedUrl) && !queue.includes(navigatedUrl)) {
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
        const hrefs = await page.$$eval("a[href]", (anchors) => anchors.map((a) => a.getAttribute("href")));
        // Go through each raw href string.
        for (const href of hrefs) {
          // Resolve relative links against the current page and clean them up.
          const linkUrl = normalizeUrl(href, currentUrl);
          // Keep only valid, same-site links that we have not seen or queued yet.
          if (linkUrl && isSameOrigin(linkUrl, normalizedStart) && !discovered.has(linkUrl) && !queue.includes(linkUrl)) {
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
    // Convert the Map values into a plain array for JSON.
    routes: Array.from(discovered.values()),
  };
  // Hand the manifest back to the caller (the CLI writes it to disk).
  return manifest;
}
