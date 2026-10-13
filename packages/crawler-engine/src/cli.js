#!/usr/bin/env node
// The line above lets this file run directly as a command when installed via the "bin" field.

// Import Node's built-in argument parser so we do not need a CLI dependency.
import { parseArgs } from "node:util";
// Import the crawler API and the JSON writer from this package's own library file.
import { crawlSite, writeJsonFile } from "./index.js";

// Text shown when the user passes --help or forgets the URL.
const HELP = `
Usage: npm run crawl -- <startUrl> [options]

Options:
  --out <file>         Where to write the route manifest (default: ./routes.json)
  --auth-state <file>  Also export cookies/localStorage after login (sensitive!)
  --max-pages <n>      Stop after visiting this many pages (default: 25)
  --timeout <ms>       Navigation timeout per page in milliseconds (default: 15000)
  --skip-login         Do not pause for manual login (for public sites)
  --help               Show this message
`;

/**
 * Entry point for the crawler CLI.
 * @returns {Promise<void>} Resolves when the crawl is finished and files are written.
 */
async function main() {
  // Parse process.argv into named options and positional arguments.
  const { values, positionals } = parseArgs({
    // Describe each flag: its type and (optionally) a default value.
    options: {
      out: { type: "string", default: "./routes.json", short: "o" },
      "auth-state": { type: "string" },
      "max-pages": { type: "string", default: "25" },
      timeout: { type: "string", default: "15000" },
      "skip-login": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    // Allow bare arguments (the start URL) in addition to flags.
    allowPositionals: true,
  });

  // The first positional argument is the website to crawl.
  const startUrl = positionals[0];
  // Show help and exit if requested or if no URL was given.
  if (values.help || !startUrl) {
    // Print usage text.
    console.log(HELP);
    // Exit code 1 signals "nothing was done" when the URL is missing; 0 for an explicit --help.
    process.exit(values.help ? 0 : 1);
  }

  // Run the crawl, converting string flags to numbers where needed.
  const manifest = await crawlSite({
    startUrl,
    maxPages: Number(values["max-pages"]),
    timeoutMs: Number(values.timeout),
    waitForLogin: !values["skip-login"],
    authStatePath: values["auth-state"],
  });

  // Write the manifest to the requested output path.
  await writeJsonFile(values.out, manifest);
  // Count failures so the summary is honest about problems.
  const failed = manifest.routes.filter((route) => route.status === "error").length;
  // Print a short summary line.
  console.log(`\nDiscovered ${manifest.routes.length} routes (${failed} failed). Wrote ${values.out}`);
}

// Run main() and turn any thrown error into a readable message plus a non-zero exit code.
main().catch((error) => {
  // Print only the message, not a full stack trace, to keep output beginner-friendly.
  console.error(`\nError: ${error.message}`);
  // Exit code 1 tells shells and CI systems that the command failed.
  process.exit(1);
});
