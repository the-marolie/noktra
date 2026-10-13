// Import Playwright's Chromium launcher for browser automation.
import { chromium } from "playwright";
// Import the promise-based file system API for reading manifests and writing output.
import fs from "node:fs/promises";
// Import path helpers for building output file names.
import path from "node:path";
// Import readline so the standalone login workflow can wait for the user to press Enter.
import readline from "node:readline/promises";
// Import existsSync to check for the browser binary without launching it.
import { existsSync } from "node:fs";
// Import spawn and createRequire to run Playwright's own installer (the same Playwright copy this engine uses).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

// Version number written into capture-manifest.json.
export const CAPTURE_SCHEMA_VERSION = 1;
// Default browser window size when the caller does not specify one.
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
// Path fragments that usually mean "you were sent to a login page" (used to detect expired sessions).
const LOGIN_PATH_HINTS = ["login", "signin", "sign-in", "auth", "sso"];

/**
 * Check whether Playwright's Chromium is installed and can start.
 * Headless runs and visible (login) windows use different Chromium builds, so both are checked:
 * the visible build by its file, the headless one by briefly launching it.
 * @returns {Promise<boolean>} True when both builds are ready.
 */
export async function isChromiumInstalled() {
  // The visible build; also needed for the login windows.
  if (!existsSync(chromium.executablePath())) return false;
  try {
    // Launching is the only public way to confirm the headless build exists.
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Download Chromium with Playwright's installer ("playwright install chromium"), showing its progress in the terminal.
 * Uses the Playwright copy this engine depends on, so the downloaded build matches the version that will launch it.
 * @returns {Promise<boolean>} True when the installer finished successfully.
 */
export function installChromium() {
  // playwright/package.json is exported, so its folder (and the cli.js next to it) can be found reliably.
  const require = createRequire(import.meta.url);
  const cliPath = path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, "install", "chromium"], { stdio: "inherit" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

/**
 * Pause until the user presses Enter in the terminal.
 * @param {string} message Prompt text to display.
 * @returns {Promise<void>} Resolves after Enter is pressed.
 */
export async function waitForEnter(message) {
  // Create a terminal prompt reader.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // Display the message and wait for a line of input.
  await rl.question(message);
  // Release the terminal.
  rl.close();
}

/**
 * Read and parse a JSON file, producing clear errors for missing or malformed files.
 * @param {string} filePath Path to the JSON file.
 * @param {string} label Human name for the file, used in error messages.
 * @returns {Promise<any>} The parsed JSON value.
 */
export async function readJsonFile(filePath, label) {
  // Holds the raw text of the file.
  let text;
  // Reading can fail if the file does not exist or is unreadable.
  try {
    // Read the whole file as a UTF-8 string.
    text = await fs.readFile(filePath, "utf8");
  } catch {
    // Replace the low-level error with a message that says which file and why.
    throw new Error(`${label} file not found or unreadable: ${filePath}`);
  }
  // Parsing can fail if the file is not valid JSON.
  try {
    // Convert the text into a JavaScript object.
    return JSON.parse(text);
  } catch (error) {
    // Report the parse problem with the file path for context.
    throw new Error(`${label} file is not valid JSON (${filePath}): ${error.message}`);
  }
}

/**
 * Extract the list of URLs from a crawler route manifest.
 * @param {object} manifest Parsed routes.json content.
 * @returns {string[]} URLs whose crawl status was "ok".
 */
export function urlsFromRouteManifest(manifest) {
  // Guard against files that are JSON but not a route manifest.
  if (!manifest || !Array.isArray(manifest.routes)) {
    // Explain what was expected.
    throw new Error('Route manifest must contain a "routes" array (see noktra-crawler README)');
  }
  // Keep only routes that loaded successfully during the crawl.
  const okRoutes = manifest.routes.filter((route) => route.status === "ok");
  // Return just the URL strings.
  return okRoutes.map((route) => route.url);
}

/**
 * Read the width and height stored in a PNG file's header without any library.
 * @param {string} filePath Path to a PNG file.
 * @returns {Promise<{width: number, height: number}>} The image dimensions.
 */
export async function readPngSize(filePath) {
  // Read the file bytes into a Buffer.
  const buffer = await fs.readFile(filePath);
  // PNG stores width as a 4-byte big-endian integer at byte 16, and height at byte 20.
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Build a safe file name from a URL, e.g. "https://a.com/blog/post?x=1" -> "001-blog-post-x-1.png".
 * @param {string} url The page URL.
 * @param {number} index Position in the capture list (used as a prefix to keep names unique).
 * @returns {string} A file name that is safe on all operating systems.
 */
export function fileNameForUrl(url, index) {
  // Parse the URL so we can use just the path and query, not the hostname.
  const parsed = new URL(url);
  // Join path and query, then replace every character that is not a letter or digit with "-".
  let slug = (parsed.pathname + parsed.search).replace(/[^a-zA-Z0-9]+/g, "-");
  // Trim leading/trailing dashes left over from slashes.
  slug = slug.replace(/^-+|-+$/g, "");
  // The home page has an empty path, so give it a readable name.
  if (slug === "") {
    // "home" is clearer than an empty string.
    slug = "home";
  }
  // Zero-pad the index to three digits so files sort in capture order.
  const prefix = String(index + 1).padStart(3, "0");
  // Keep names reasonably short (very long query strings can exceed OS limits).
  return `${prefix}-${slug.slice(0, 80)}.png`;
}

/**
 * Decide whether a page landed on a login screen instead of the page we asked for.
 * @param {string} requestedUrl The URL we navigated to.
 * @param {string} finalUrl The URL the browser ended up on.
 * @returns {boolean} True when it looks like an authentication redirect.
 */
export function looksLikeLoginRedirect(requestedUrl, finalUrl) {
  // Lower-case path of the final page.
  const finalPath = new URL(finalUrl).pathname.toLowerCase();
  // Lower-case path of the requested page.
  const requestedPath = new URL(requestedUrl).pathname.toLowerCase();
  // If the path did not change, it was not a redirect at all.
  if (finalPath === requestedPath) {
    // Not a login redirect.
    return false;
  }
  // Report true when the final path contains any typical login keyword.
  return LOGIN_PATH_HINTS.some((hint) => finalPath.includes(hint));
}

/**
 * Open a visible browser with the capture viewport, let the user log in, and keep it open.
 * Used when the site keeps its session somewhere storageState() cannot export (e.g. IndexedDB).
 * @param {string} loginUrl Page to open for logging in.
 * @param {{width: number, height: number}} viewport Viewport size for later screenshots.
 * @param {(msg: string) => void} log Logging function.
 * @param {{username: string, password: string}} [httpCredentials] Credentials for HTTP (basic) authentication.
 * @returns {Promise<{browser: object, context: object}>} The live browser and context to capture with.
 */
export async function loginAndKeepBrowser(loginUrl, viewport, log, httpCredentials) {
  // Launch a visible window so the user can type credentials.
  let browser;
  // Launch failures get a friendly message.
  try {
    // Headed mode shows the window.
    browser = await chromium.launch({ headless: false });
  } catch (error) {
    // Usually the browser binary is missing.
    throw new Error(`Could not launch Chromium. Run "npx playwright install chromium" first.\nDetails: ${error.message}`);
  }
  // Set the viewport now because it cannot be changed after the context exists.
  const context = await browser.newContext({ viewport, httpCredentials });
  // One tab for logging in; captureUrls will open its own tab in the same context.
  const page = await context.newPage();
  // Open the login page.
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  // Wait for the user to finish logging in.
  await waitForEnter("\nLog in in the browser window, then press Enter here to start capturing in that window... ");
  // Inform the user.
  log("Capturing in the logged-in browser window.");
  // Hand back the live browser so the caller can close it when done.
  return { browser, context };
}

/**
 * Warn when the auth state has no cookies for the hostnames we are about to capture.
 * @param {object} storageState A Playwright storage-state object.
 * @param {string[]} urls The URLs about to be captured.
 * @param {(msg: string) => void} log Logging function.
 */
function warnOnHostnameMismatch(storageState, urls, log) {
  // Collect the cookie domains in the auth state, stripping any leading dot (".example.com").
  const cookieDomains = (storageState.cookies ?? []).map((cookie) => cookie.domain.replace(/^\./, ""));
  // Collect the distinct hostnames of the target URLs.
  const targetHosts = Array.from(new Set(urls.map((url) => new URL(url).hostname)));
  // Check each target host for at least one matching cookie domain.
  for (const host of targetHosts) {
    // A cookie for "example.com" also applies to "app.example.com", so use endsWith.
    const hasCookie = cookieDomains.some((domain) => host === domain || host.endsWith("." + domain));
    // Warn (but do not stop) when nothing matches; the capture may still work via localStorage.
    if (!hasCookie) {
      // Explain the origin-specific nature of auth state.
      log(`Warning: auth state has no cookies for ${host}. Sessions are per-hostname, so pages may show as logged out.`);
    }
  }
}

// Tallest screenshot we will take, so an infinite-scroll page cannot produce a gigantic image.
const MAX_FULL_PAGE_HEIGHT = 20000;

/**
 * Scroll through the page (and its main inner scroll panel, if any) so lazy-loaded content renders,
 * then return to the top.
 * @param {object} page A Playwright page.
 * @returns {Promise<void>} Resolves once scrolling is finished.
 */
async function scrollThroughPage(page) {
  await page.evaluate(async (maxHeight) => {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
    // Scroll the document and every element that scrolls on its own (dashboards often scroll an inner panel).
    const scrollers = [document.scrollingElement, ...document.querySelectorAll("*")].filter((el) => {
      if (!el || el.scrollHeight <= el.clientHeight + 1) return false;
      if (el === document.scrollingElement) return true;
      const overflowY = getComputedStyle(el).overflowY;
      return overflowY === "auto" || overflowY === "scroll";
    });
    for (const el of scrollers) {
      const step = Math.max(el.clientHeight, 200);
      for (let top = 0; top < Math.min(el.scrollHeight, maxHeight); top += step) {
        // "instant" overrides CSS smooth scrolling, which would otherwise animate each jump.
        el.scrollTo({ top, behavior: "instant" });
        await pause();
      }
    }
  }, MAX_FULL_PAGE_HEIGHT);
  await scrollToTop(page);
}

/**
 * Jump the document and every inner scroll panel back to the top, and wait until the page has repainted there.
 * Fixed and sticky elements (headers, sidebars) are drawn at the current scroll position, so a page caught even
 * slightly scrolled shows them partway down the full-page screenshot.
 * @param {object} page A Playwright page.
 * @returns {Promise<void>} Resolves once everything is at the top.
 */
async function scrollToTop(page) {
  await page.evaluate(async () => {
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const scrolled = () => [document.scrollingElement, ...document.querySelectorAll("*")].filter((el) => el && el.scrollTop > 0);
    // A few rounds, because some apps scroll themselves back (e.g. restoring a saved position) after we reset them.
    for (let round = 0; round < 10; round += 1) {
      const stillScrolled = scrolled();
      if (stillScrolled.length === 0) break;
      // "instant" overrides CSS scroll-behavior: smooth, which would animate the jump and leave the page mid-scroll.
      for (const el of stillScrolled) el.scrollTo({ top: 0, behavior: "instant" });
      await nextFrame();
    }
    // Two frames so the browser has painted the page at the top before the screenshot.
    await nextFrame();
    await nextFrame();
  });
}

/**
 * Work out how tall the viewport must be to show an inner scroll panel's whole content.
 * Normal pages grow the document, which Playwright's fullPage option already captures. App-style layouts keep
 * the document at 100vh and scroll an inner panel instead, which fullPage cannot see; for those the viewport
 * has to grow by the panel's hidden height.
 * @param {object} page A Playwright page.
 * @returns {Promise<number>} The required viewport height, or the current one when the document itself scrolls.
 */
async function innerPanelHeight(page) {
  return page.evaluate(() => {
    const viewportHeight = window.innerHeight;
    // The document scrolls: fullPage handles it, and growing the viewport would stretch 100vh sections.
    if (document.scrollingElement.scrollHeight > viewportHeight + 1) return viewportHeight;
    // Find the largest inner scroll panel; its hidden height is what needs to be revealed.
    let panelExtra = 0;
    let panelArea = 0;
    for (const el of document.querySelectorAll("*")) {
      if (el.scrollHeight <= el.clientHeight + 1) continue;
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY !== "auto" && overflowY !== "scroll") continue;
      const area = el.clientWidth * el.clientHeight;
      if (area > panelArea) {
        panelArea = area;
        panelExtra = el.scrollHeight - el.clientHeight;
      }
    }
    return viewportHeight + panelExtra;
  });
}

/**
 * Take a screenshot covering the whole height of the page, including content inside an inner scroll panel.
 * @param {object} page A Playwright page that has finished loading.
 * @param {string} imagePath Where to save the PNG.
 * @param {{width: number, height: number}} viewport The normal viewport, restored afterwards.
 * @returns {Promise<void>} Resolves when the screenshot is written.
 */
async function captureFullPage(page, imagePath, viewport) {
  // Trigger lazy-loaded images and sections before measuring.
  await scrollThroughPage(page);
  const contentHeight = Math.min(await innerPanelHeight(page), MAX_FULL_PAGE_HEIGHT);
  try {
    if (contentHeight > viewport.height) {
      // Make the viewport tall enough that the inner panel stops scrolling and shows everything.
      await page.setViewportSize({ width: viewport.width, height: contentHeight });
      // Give the layout and any newly visible lazy content a moment to render.
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
    // Reset again right before capturing, in case resizing or late content moved the scroll position.
    await scrollToTop(page);
    await page.screenshot({ path: imagePath, fullPage: true });
  } finally {
    // The next URL starts from the normal viewport again.
    await page.setViewportSize(viewport);
  }
}

/**
 * Capture screenshots of a list of URLs in a headless browser.
 *
 * @param {object} options Capture settings.
 * @param {string[]} options.urls Pages to capture.
 * @param {string} [options.outputDir="./screenshots"] Folder to save PNG files into.
 * @param {number} [options.width=1280] Viewport width in pixels.
 * @param {number} [options.height=720] Viewport height in pixels.
 * @param {boolean} [options.fullPage=true] Capture the entire height of the page (including inner scroll panels), not just the viewport.
 * @param {number} [options.timeoutMs=30000] Navigation timeout per page.
 * @param {object} [options.storageState] Playwright storage state imported from a file.
 * @param {{username: string, password: string}} [options.httpCredentials] Credentials for HTTP (basic) authentication.
 * @param {object} [options.context] An already logged-in Playwright context to reuse (from loginAndKeepBrowser).
 * @param {(msg: string) => void} [options.log] Logging function.
 * @returns {Promise<object>} The capture manifest (same shape as capture-manifest.json).
 */
export async function captureUrls(options) {
  // Read options with defaults.
  const urls = options.urls;
  const outputDir = options.outputDir ?? "./screenshots";
  const width = options.width ?? DEFAULT_VIEWPORT.width;
  const height = options.height ?? DEFAULT_VIEWPORT.height;
  const fullPage = options.fullPage ?? true;
  const timeoutMs = options.timeoutMs ?? 30000;
  const storageState = options.storageState;
  const httpCredentials = options.httpCredentials;
  const existingContext = options.context;
  const log = options.log ?? console.log;

  // Refuse to run with nothing to capture.
  if (!Array.isArray(urls) || urls.length === 0) {
    // Clear message instead of an empty manifest.
    throw new Error("No URLs to capture. Provide a URL or a route manifest with at least one ok route.");
  }
  // Validate every URL before launching a browser so bad input fails fast.
  for (const url of urls) {
    // `new URL` throws on invalid strings; convert that into a readable error.
    try {
      // Parse only to validate; the result is unused.
      new URL(url);
    } catch {
      // Tell the user exactly which URL is wrong.
      throw new Error(`Invalid URL: "${url}"`);
    }
  }
  // Create the output folder.
  await fs.mkdir(outputDir, { recursive: true });
  // Tell the user about likely auth problems before spending time capturing.
  if (storageState) {
    // Checks cookie domains against target hostnames.
    warnOnHostnameMismatch(storageState, urls, log);
  }

  // Browser we launched ourselves; stays null when the caller supplied a context.
  let browser = null;
  // The context we will capture with.
  let context;
  // Reuse a logged-in context when one was provided (standalone login workflow).
  if (existingContext) {
    // Nothing to launch.
    context = existingContext;
  } else {
    // Launch failures get a friendly message.
    try {
      // Headless means no window is shown; this is faster and works on servers.
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      // Usually the browser binary is missing.
      throw new Error(`Could not launch Chromium. Run "npx playwright install chromium" first.\nDetails: ${error.message}`);
    }
    // Create a context with the chosen viewport and (optionally) the imported login session.
    context = await browser.newContext({ viewport: { width, height }, storageState, httpCredentials });
  }

  // Collects one record per URL.
  const captures = [];
  // Ensure anything we launched is closed no matter what.
  try {
    // One tab reused for every URL.
    const page = await context.newPage();
    // Loop over URLs with their index (used for file naming).
    for (let index = 0; index < urls.length; index += 1) {
      // The URL for this iteration.
      const url = urls[index];
      // Where this screenshot will be saved.
      const imagePath = path.join(outputDir, fileNameForUrl(url, index));
      // Start the record with "pending" and fill it in below.
      const record = { url, imagePath, width: null, height: null, status: "pending", error: null, finalUrl: null };
      // Register it now so it is in the manifest even if an exception escapes later.
      captures.push(record);
      // Progress output.
      log(`[${index + 1}/${urls.length}] Capturing ${url}`);
      // Each capture is isolated so one failure does not abort the rest.
      try {
        // Navigate and wait for the DOM; "load" waits for images and styles too, which helps screenshots.
        await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
        // Wait briefly for background requests to settle, ignoring timeouts (some sites never go idle).
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        // Record where the browser actually ended up (redirects change this).
        record.finalUrl = page.url();
        // Detect an expired or missing session by checking for a login redirect.
        if (looksLikeLoginRedirect(url, record.finalUrl)) {
          // Mark this capture as needing authentication rather than pretending it succeeded.
          record.status = "auth_required";
          // Explain the symptom.
          record.error = `Redirected to ${record.finalUrl}; the session is missing or expired. Re-authenticate and try again.`;
          // Print it live.
          log(`  Auth required: ${record.error}`);
          // Skip the screenshot for this URL.
          continue;
        }
        // Take the screenshot: the whole page height by default, or just the viewport.
        if (fullPage) {
          await captureFullPage(page, imagePath, { width, height });
        } else {
          await page.screenshot({ path: imagePath });
        }
        // Read the real pixel size from the written file (full-page height is only known afterwards).
        const size = await readPngSize(imagePath);
        // Store the dimensions.
        record.width = size.width;
        record.height = size.height;
        // Success.
        record.status = "ok";
      } catch (error) {
        // Record the failure without stopping.
        record.status = "error";
        // First line of the message is enough for the manifest.
        record.error = error.message.split("\n")[0];
        // Print it live.
        log(`  Failed: ${record.error}`);
      }
    }
  } finally {
    // Close the browser only if this function launched it; a caller-supplied context is the caller's to close.
    if (browser) {
      // Shut down the headless browser.
      await browser.close();
    }
  }

  // Assemble the manifest that becomes capture-manifest.json.
  return {
    // Format version.
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    // Timestamp of the run.
    createdAt: new Date().toISOString(),
    // The viewport used (actual image size may be taller for full-page captures).
    viewport: { width, height, fullPage },
    // Where the images are.
    outputDir,
    // Per-URL results.
    captures,
  };
}
