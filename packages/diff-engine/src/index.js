// Import pixelmatch, a small library that compares two images pixel by pixel and paints the differences.
import pixelmatch from "pixelmatch";
// Import the PNG class from pngjs, which decodes PNG files into raw RGBA pixel buffers and back.
import { PNG } from "pngjs";
// Promise-based file system for reading and writing files.
import fs from "node:fs/promises";
// Path helpers for creating output folders.
import path from "node:path";

// Version number written into diff-result.json.
export const DIFF_SCHEMA_VERSION = 1;

/**
 * Read a PNG file from disk and decode it into pixels.
 * @param {string} filePath Path to the PNG file.
 * @returns {Promise<PNG>} A pngjs PNG object with `width`, `height` and `data` (RGBA bytes).
 */
export async function readPng(filePath) {
  // Raw file bytes.
  let buffer;
  // Reading fails when the file is missing or unreadable.
  try {
    // Load the whole file into memory.
    buffer = await fs.readFile(filePath);
  } catch {
    // Friendly message naming the file.
    throw new Error(`Image file not found or unreadable: ${filePath}`);
  }
  // Decoding fails when the file is not a valid PNG.
  try {
    // `PNG.sync.read` parses the bytes synchronously and returns width, height and an RGBA data buffer.
    return PNG.sync.read(buffer);
  } catch (error) {
    // Explain that only PNG is supported in this MVP.
    throw new Error(`Could not decode PNG (only PNG is supported): ${filePath} - ${error.message}`);
  }
}

/**
 * Compare two PNG images and optionally write a diff image.
 *
 * Percentage formula: diffPercent = (diffPixels / (width * height)) * 100
 *
 * @param {string} baselinePath Path to the reference ("before") image.
 * @param {string} comparisonPath Path to the new ("after") image.
 * @param {object} [options] Comparison settings.
 * @param {string} [options.diffPath] Where to write the diff PNG; skipped when omitted.
 * @param {number} [options.threshold=0.1] pixelmatch color sensitivity, 0 (strict) to 1 (lenient).
 * @param {number} [options.maxDiffPercent=0] Largest diffPercent that still counts as "passed".
 * @returns {Promise<object>} A result object (same shape as diff-result.json).
 */
export async function compareImages(baselinePath, comparisonPath, options = {}) {
  // Read settings with defaults.
  const diffPath = options.diffPath;
  const threshold = options.threshold ?? 0.1;
  const maxDiffPercent = options.maxDiffPercent ?? 0;

  // Decode both images.
  const baseline = await readPng(baselinePath);
  const comparison = await readPng(comparisonPath);

  // Shared fields present in every result, success or not.
  const base = {
    schemaVersion: DIFF_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    baselinePath,
    comparisonPath,
    baselineSize: { width: baseline.width, height: baseline.height },
    comparisonSize: { width: comparison.width, height: comparison.height },
    threshold,
    maxDiffPercent,
  };

  // pixelmatch requires identical dimensions, so detect a mismatch and report it clearly.
  if (baseline.width !== comparison.width || baseline.height !== comparison.height) {
    // Return a failed result instead of throwing, so callers get structured information.
    return {
      ...base,
      status: "dimension_mismatch",
      diffPath: null,
      diffPixels: null,
      totalPixels: null,
      diffPercent: null,
      changed: true,
      passed: false,
      error: `Image sizes differ: baseline is ${baseline.width}x${baseline.height}, comparison is ${comparison.width}x${comparison.height}`,
    };
  }

  // Dimensions are equal, so use the baseline's.
  const width = baseline.width;
  const height = baseline.height;
  // Create an empty image of the same size to receive the diff visualisation.
  const diff = new PNG({ width, height });

  // pixelmatch compares the two RGBA buffers, paints differing pixels red into `diff.data`,
  // and returns how many pixels differed. `threshold` controls how different a pixel's color
  // must be (in YIQ color space) before it counts; 0.1 is the library's recommended default.
  // `diffMask: true` leaves unchanged pixels transparent, so the PNG works as an overlay in the HTML report.
  const diffPixels = pixelmatch(baseline.data, comparison.data, diff.data, width, height, { threshold, diffMask: true });

  // Total number of pixels in the image.
  const totalPixels = width * height;
  // Percentage of pixels that differ, rounded to 4 decimal places for readability.
  const diffPercent = Number(((diffPixels / totalPixels) * 100).toFixed(4));

  // Write the diff image only when a path was requested.
  if (diffPath) {
    // Create the folder if needed.
    await fs.mkdir(path.dirname(diffPath), { recursive: true });
    // Encode the diff pixels back into PNG bytes and save them.
    await fs.writeFile(diffPath, PNG.sync.write(diff));
  }

  // Build the final result.
  return {
    ...base,
    // "compared" means both images were readable and the same size.
    status: "compared",
    // Where the diff image was written, or null.
    diffPath: diffPath ?? null,
    diffPixels,
    totalPixels,
    diffPercent,
    // Any differing pixel at all means the page changed.
    changed: diffPixels > 0,
    // "passed" applies the tolerance: small changes under maxDiffPercent are acceptable.
    passed: diffPercent <= maxDiffPercent,
    error: null,
  };
}

/**
 * Compare matching screenshots from two snapshot capture manifests (by URL).
 * This is optional convenience; compareImages() works without any manifest.
 *
 * @param {object} baselineManifest Parsed capture-manifest.json of the baseline run.
 * @param {object} comparisonManifest Parsed capture-manifest.json of the new run.
 * @param {object} [options] Same options as compareImages, plus `diffDir` for output images and `matchBy`.
 * @param {"url"|"path"} [options.matchBy="url"] Match captures by full URL, or by path+query only
 *   (use "path" when the two runs were taken on different hostnames, e.g. v4 vs dev).
 * @returns {Promise<object[]>} One compareImages() result per matched URL.
 */
export async function compareManifests(baselineManifest, comparisonManifest, options = {}) {
  // How captures are paired between the two runs.
  const matchBy = options.matchBy ?? "url";
  // Turn a URL into its matching key: the full URL, or just the path and query string.
  const keyFor = (url) => (matchBy === "path" ? new URL(url).pathname + new URL(url).search : url);
  // Validate both inputs are capture manifests.
  if (!Array.isArray(baselineManifest?.captures) || !Array.isArray(comparisonManifest?.captures)) {
    // Explain the expected shape.
    throw new Error('Both files must be capture manifests with a "captures" array (see snapshot-engine README)');
  }
  // Index the comparison captures by their key for quick lookup.
  const comparisonByUrl = new Map(comparisonManifest.captures.map((c) => [keyFor(c.url), c]));
  // Collect one result per baseline capture.
  const results = [];
  // Walk through each baseline capture with its index (for diff file names).
  for (let index = 0; index < baselineManifest.captures.length; index += 1) {
    // Current baseline record.
    const baselineCapture = baselineManifest.captures[index];
    // Matching record in the comparison run, if any.
    const comparisonCapture = comparisonByUrl.get(keyFor(baselineCapture.url));
    // Skip URLs that were not captured successfully in both runs, but say so in the output.
    if (!comparisonCapture || baselineCapture.status !== "ok" || comparisonCapture.status !== "ok") {
      // A placeholder result keeps the output complete and honest.
      results.push({ url: baselineCapture.url, status: "skipped", passed: false, error: "Missing or failed capture in one of the runs" });
      // Next URL.
      continue;
    }
    // Diff image path inside diffDir when provided, named by index.
    const diffPath = options.diffDir ? path.join(options.diffDir, `${String(index + 1).padStart(3, "0")}-diff.png`) : undefined;
    // Run the single-image comparison.
    const result = await compareImages(baselineCapture.imagePath, comparisonCapture.imagePath, { ...options, diffPath });
    // Attach the URL so the result is self-describing.
    results.push({ url: baselineCapture.url, ...result });
  }
  // Return all results.
  return results;
}
