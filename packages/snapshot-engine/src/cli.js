#!/usr/bin/env node
// Lets the file run as a command when installed through the package "bin" field.

// Built-in argument parser.
import { parseArgs } from "node:util";
// Promise-based file system for writing the manifest.
import fs from "node:fs/promises";
// Path helpers for creating the manifest's folder.
import path from "node:path";
// The snapshot API from this package.
import { captureUrls, loginAndKeepBrowser, readJsonFile, urlsFromRouteManifest } from "./index.js";

// Usage text.
const HELP = `
Usage: npm run snapshot -- [--url <url> | --routes <routes.json>] [options]

Input (choose one):
  --url <url>           Capture a single URL
  --routes <file>       Capture every "ok" route from a crawler route manifest

Authentication (optional, choose one):
  --auth-state <file>   Import cookies/localStorage exported by the crawler (Workflow A)
  --login               Open a visible browser, log in, then capture in that same window (Workflow B)

Options:
  --out <dir>           Folder for screenshots (default: ./screenshots)
  --manifest <file>     Where to write the capture manifest (default: <out>/capture-manifest.json)
  --width <px>          Viewport width (default: 1280)
  --height <px>         Viewport height (default: 720)
  --full-page           Capture the whole scrollable page
  --timeout <ms>        Navigation timeout per page (default: 30000)
  --help                Show this message
`;

/**
 * Entry point for the snapshot CLI.
 * @returns {Promise<void>} Resolves when captures are done and the manifest is written.
 */
async function main() {
  // Parse command-line flags.
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      routes: { type: "string" },
      "auth-state": { type: "string" },
      login: { type: "boolean", default: false },
      out: { type: "string", default: "./screenshots" },
      manifest: { type: "string" },
      width: { type: "string", default: "1280" },
      height: { type: "string", default: "720" },
      "full-page": { type: "boolean", default: false },
      timeout: { type: "string", default: "30000" },
      help: { type: "boolean", default: false },
    },
  });

  // Show help when asked or when no input source was given.
  if (values.help || (!values.url && !values.routes)) {
    // Print usage.
    console.log(HELP);
    // 0 for explicit help, 1 for missing input.
    process.exit(values.help ? 0 : 1);
  }
  // Using both auth methods at once would be ambiguous, so reject it.
  if (values["auth-state"] && values.login) {
    // Clear instruction.
    throw new Error("Use either --auth-state or --login, not both.");
  }

  // Will hold the list of URLs to capture.
  let urls;
  // Decide where URLs come from.
  if (values.url) {
    // Single-URL mode: wrap it in an array.
    urls = [values.url];
  } else {
    // Manifest mode: read the crawler output and pull out its ok URLs.
    const manifest = await readJsonFile(values.routes, "Route manifest");
    // Extract URL strings.
    urls = urlsFromRouteManifest(manifest);
  }

  // Playwright storage state (cookies + localStorage), or undefined for anonymous capture.
  let storageState;
  // Workflow A: import a file produced by the crawler (or an earlier snapshot run).
  if (values["auth-state"]) {
    // Parse it, with a clear error if missing or malformed.
    storageState = await readJsonFile(values["auth-state"], "Auth state");
  }
  // Holds the visible browser for the standalone login workflow.
  let session = null;
  // Workflow B: log in through a visible browser and keep capturing in it.
  if (values.login) {
    // Open the first URL as the login page with the capture viewport.
    session = await loginAndKeepBrowser(urls[0], { width: Number(values.width), height: Number(values.height) }, console.log);
  }

  // Run the capture (inside the logged-in window when --login was used).
  const result = await captureUrls({
    urls,
    outputDir: values.out,
    width: Number(values.width),
    height: Number(values.height),
    fullPage: values["full-page"],
    timeoutMs: Number(values.timeout),
    storageState,
    context: session ? session.context : undefined,
  });
  // Close the visible browser now that capturing is done.
  if (session) {
    // Shut it down.
    await session.browser.close();
  }

  // Decide the manifest path (default lives inside the output folder).
  const manifestPath = values.manifest ?? path.join(values.out, "capture-manifest.json");
  // Make sure its folder exists.
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  // Write pretty-printed JSON.
  await fs.writeFile(manifestPath, JSON.stringify(result, null, 2));

  // Count outcomes for the summary.
  const ok = result.captures.filter((c) => c.status === "ok").length;
  const failed = result.captures.length - ok;
  // Print the summary.
  console.log(`\nCaptured ${ok} of ${result.captures.length} pages (${failed} failed). Wrote ${manifestPath}`);
  // Exit non-zero when anything failed so scripts and CI notice.
  if (failed > 0) {
    // 2 distinguishes "partial failure" from "crashed" (1).
    process.exit(2);
  }
}

// Run and report errors with a non-zero exit code.
main().catch((error) => {
  // Message only, no stack trace.
  console.error(`\nError: ${error.message}`);
  // Signal failure.
  process.exit(1);
});
