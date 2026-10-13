#!/usr/bin/env node
// Lets the file run as a command when installed through the package "bin" field.

// Built-in argument parser.
import { parseArgs } from "node:util";
// Promise-based file system for reading manifests and writing results.
import fs from "node:fs/promises";
// Path helpers.
import path from "node:path";
// The diff API from this package.
import { compareImages, compareManifests } from "./index.js";
// The optional HTML report writer.
import { writeHtmlReport } from "./report.js";

// Usage text.
const HELP = `
Usage:
  noktra-diff <baseline.png> <comparison.png> [options]
  noktra-diff --baseline-manifest <a.json> --comparison-manifest <b.json> [options]
  (inside the noktra repo: npm run diff -- [options])

Options:
  --diff <file>              Where to write the diff image (default: ./diff.png)
  --diff-dir <dir>           (manifest mode) folder for diff images (default: ./diffs)
  --result <file>            Where to write the JSON result (default: ./diff-result.json)
  --threshold <0..1>         Per-pixel color sensitivity for pixelmatch (default: 0.1)
  --max-diff-percent <n>     Allowed percentage of changed pixels to still pass (default: 0)
  --match-by <url|path>      (manifest mode) pair captures by full URL or by path only (default: url)
  --html <file>              Also write a self-contained HTML report with a diff overlay toggle
  --help                     Show this message

Exit codes: 0 = passed, 2 = changed/failed, 1 = error (bad input, unreadable file)
`;

/**
 * Read and parse a JSON file with friendly errors.
 * @param {string} filePath Path to the JSON file.
 * @returns {Promise<any>} Parsed JSON.
 */
async function readJson(filePath) {
  // Raw text.
  let text;
  // Missing file.
  try {
    // Read as UTF-8.
    text = await fs.readFile(filePath, "utf8");
  } catch {
    // Name the file.
    throw new Error(`Manifest file not found: ${filePath}`);
  }
  // Malformed JSON.
  try {
    // Parse.
    return JSON.parse(text);
  } catch (error) {
    // Name the file and the parse problem.
    throw new Error(`Manifest is not valid JSON (${filePath}): ${error.message}`);
  }
}

/**
 * Write a JSON file, creating its folder first.
 * @param {string} filePath Destination path.
 * @param {any} data Value to serialize.
 * @returns {Promise<void>} Resolves when written.
 */
async function writeJson(filePath, data) {
  // Ensure the folder exists.
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // Pretty-print with 2 spaces.
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

/**
 * Entry point for the diff CLI.
 * @returns {Promise<void>} Resolves when the comparison is done and files are written.
 */
async function main() {
  // Parse flags and the two positional image paths.
  const { values, positionals } = parseArgs({
    options: {
      diff: { type: "string", default: "./diff.png" },
      "diff-dir": { type: "string", default: "./diffs" },
      result: { type: "string", default: "./diff-result.json" },
      threshold: { type: "string", default: "0.1" },
      "max-diff-percent": { type: "string", default: "0" },
      "baseline-manifest": { type: "string" },
      "comparison-manifest": { type: "string" },
      "match-by": { type: "string", default: "url" },
      html: { type: "string" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  // True when the user chose manifest mode.
  const manifestMode = Boolean(values["baseline-manifest"] || values["comparison-manifest"]);
  // Show help when asked, or when neither two images nor two manifests were given.
  if (values.help || (!manifestMode && positionals.length !== 2)) {
    // Print usage.
    console.log(HELP);
    // 0 for explicit help, 1 for bad invocation.
    process.exit(values.help ? 0 : 1);
  }
  // Convert numeric flags.
  const threshold = Number(values.threshold);
  const maxDiffPercent = Number(values["max-diff-percent"]);
  // Validate the threshold range because pixelmatch silently misbehaves outside 0..1.
  if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
    // Explain the valid range.
    throw new Error("--threshold must be a number between 0 and 1");
  }

  // Manifest mode compares many screenshots at once.
  if (manifestMode) {
    // Both manifests are required together.
    if (!values["baseline-manifest"] || !values["comparison-manifest"]) {
      // Clear instruction.
      throw new Error("Manifest mode needs both --baseline-manifest and --comparison-manifest");
    }
    // Read both files.
    const baselineManifest = await readJson(values["baseline-manifest"]);
    const comparisonManifest = await readJson(values["comparison-manifest"]);
    // Compare matching URLs.
    const results = await compareManifests(baselineManifest, comparisonManifest, { threshold, maxDiffPercent, diffDir: values["diff-dir"], matchBy: values["match-by"] });
    // Save the array of results.
    await writeJson(values.result, results);
    // Optionally write the HTML report.
    if (values.html) {
      // One card per comparison.
      await writeHtmlReport(values.html, results);
      // Tell the user where it is.
      console.log(`Wrote HTML report ${values.html}`);
    }
    // Count passes.
    const passed = results.filter((r) => r.passed).length;
    // Summary.
    console.log(`\n${passed} of ${results.length} comparisons passed. Wrote ${values.result}`);
    // Non-zero exit when any comparison failed.
    process.exit(passed === results.length ? 0 : 2);
  }

  // Two-image mode: positionals are [baseline, comparison].
  const result = await compareImages(positionals[0], positionals[1], { diffPath: values.diff, threshold, maxDiffPercent });
  // Save the result JSON.
  await writeJson(values.result, result);
  // Optionally write the HTML report (a single card).
  if (values.html) {
    // The report takes an array, so wrap the one result.
    await writeHtmlReport(values.html, [result]);
    // Tell the user where it is.
    console.log(`Wrote HTML report ${values.html}`);
  }

  // Report a dimension mismatch clearly.
  if (result.status === "dimension_mismatch") {
    // Print the explanation.
    console.error(`\n${result.error}`);
    // Mismatch is a failed comparison.
    process.exit(2);
  }
  // Mention a size change; the area only one image covers is already counted as changed.
  if (result.sizeChanged) {
    console.log(`\nImage sizes differ: baseline is ${result.baselineSize.width}x${result.baselineSize.height}, comparison is ${result.comparisonSize.width}x${result.comparisonSize.height}`);
  }
  // Print the key numbers.
  console.log(`\nDiffering pixels: ${result.diffPixels} of ${result.totalPixels} (${result.diffPercent}%)`);
  console.log(`Result: ${result.passed ? "PASSED (unchanged within tolerance)" : "FAILED (changed)"}`);
  console.log(`Diff image: ${result.diffPath}\nResult JSON: ${values.result}`);
  // Exit 0 on pass, 2 on fail.
  process.exit(result.passed ? 0 : 2);
}

// Run and convert errors into a message and exit code 1.
main().catch((error) => {
  // Message only.
  console.error(`\nError: ${error.message}`);
  // Signal a hard error.
  process.exit(1);
});
