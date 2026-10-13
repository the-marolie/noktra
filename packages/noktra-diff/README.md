# noktra-diff

Compares two PNG images with [pixelmatch](https://github.com/mapbox/pixelmatch) and writes a diff image plus a JSON result. Needs no browser and no other engine.

## Install

```bash
npm install noktra-diff
```

Requires Node.js 20 or newer. For the full workflow (find routes, screenshot two sites, compare them), install [`noktra`](https://www.npmjs.com/package/noktra), which includes this package and the wizard.

## Files

- `src/index.js` – API: `compareImages()`, `compareManifests()`, `readPng()`.
- `src/cli.js` – command-line wrapper.
- `package.json` – dependencies: `pixelmatch` (pixel comparison), `pngjs` (PNG decode/encode).

## How the comparison works

1. Both files are decoded with `pngjs` into raw RGBA byte buffers (4 bytes per pixel).
2. If the dimensions differ, the result is `status: "dimension_mismatch"`, `passed: false` — pixelmatch cannot compare different sizes.
3. `pixelmatch(img1, img2, diffOut, width, height, { threshold })` compares each pixel pair, paints differing pixels red into `diffOut`, and returns the count.
4. `diffPercent = diffPixels / (width × height) × 100`, rounded to 4 decimals.
5. `changed = diffPixels > 0`; `passed = diffPercent <= maxDiffPercent`.

Two independent knobs:

- `--threshold` (0–1, default 0.1): **per-pixel color sensitivity**. How different two colors must be before the pixel counts as changed. 0 is strictest; raise it to ignore anti-aliasing noise.
- `--max-diff-percent` (default 0): **pass/fail tolerance**. Percentage of changed pixels you accept. With 0, any change fails.

## CLI

```bash
npm run diff -- baseline.png comparison.png --diff ./diff.png --result ./diff-result.json
npm run diff -- a.png b.png --threshold 0.2 --max-diff-percent 0.5
npm run diff -- --baseline-manifest run-1/capture-manifest.json --comparison-manifest run-2/capture-manifest.json --diff-dir ./diffs
```

Exit codes: 0 passed, 2 changed / dimension mismatch, 1 error (missing or non-PNG file, bad threshold).

Manifest mode matches captures by `url` and skips any URL not captured with `status: "ok"` in both runs (reported as `status: "skipped"`).

## JavaScript API

```js
import { compareImages } from "noktra-diff";

const result = await compareImages("baseline.png", "comparison.png", {
  diffPath: "diff.png",      // omit to skip writing the diff image
  threshold: 0.1,
  maxDiffPercent: 0,
});
if (!result.passed) console.log(`${result.diffPercent}% of pixels changed`);
```

## Output: diff-result.json

```jsonc
{
  "schemaVersion": 1,
  "createdAt": "...",
  "baselinePath": "a.png", "comparisonPath": "b.png",
  "baselineSize": { "width": 100, "height": 100 },
  "comparisonSize": { "width": 100, "height": 100 },
  "threshold": 0.1, "maxDiffPercent": 0,
  "status": "compared",           // or "dimension_mismatch"
  "diffPath": "d2.png",           // null if not written
  "diffPixels": 100, "totalPixels": 10000, "diffPercent": 1,
  "changed": true, "passed": false,
  "error": null                   // message for dimension_mismatch
}
```
