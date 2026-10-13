# noktra-diff

Compares screenshots pixel by pixel with [pixelmatch](https://github.com/mapbox/pixelmatch). It writes a diff image with the changed pixels in red, a JSON result with pass/fail per page, and optionally a self-contained HTML report. It needs no browser.

Part of [noktra](https://github.com/the-marolie/noktra), a visual regression testing toolkit. For the complete workflow (find routes, screenshot two sites, compare them), install [`noktra`](https://www.npmjs.com/package/noktra).

## Install

```bash
npm install noktra-diff
```

Requires Node.js 20 or newer.

## Command line

Compare two images:

```bash
noktra-diff <baseline.png> <comparison.png> [options]
```

Or compare every matching page in two capture manifests from `noktra-snapshot`:

```bash
noktra-diff --baseline-manifest <a.json> --comparison-manifest <b.json> [options]
```

| Option | Description | Default |
|---|---|---|
| `--diff <file>` | Where to write the diff image (two-image mode) | `./diff.png` |
| `--diff-dir <dir>` | Folder for diff images (manifest mode) | `./diffs` |
| `--result <file>` | Where to write the JSON result | `./diff-result.json` |
| `--threshold <0..1>` | How different a pixel's colour must be to count as changed | `0.1` |
| `--max-diff-percent <n>` | Percentage of changed pixels that still passes | `0` |
| `--match-by <url\|path>` | (manifest mode) Pair pages by full URL, or by path and query only | `url` |
| `--html <file>` | Also write an HTML report | — |
| `--help` | Show usage | — |

```bash
noktra-diff before.png after.png --diff diff.png
noktra-diff a.png b.png --threshold 0.2 --max-diff-percent 0.5
noktra-diff --baseline-manifest run-1/capture-manifest.json \
            --comparison-manifest run-2/capture-manifest.json \
            --diff-dir diffs --html report.html
```

Use `--match-by path` when the two runs captured different domains, such as production and staging.

**Exit codes:** `0` every comparison passed, `2` at least one changed or was skipped, `1` error (missing or non-PNG file, invalid threshold).

## How comparison works

- Both PNGs are decoded and compared pixel by pixel. Each pixel that differs is painted red in the diff image; unchanged pixels are transparent, so the diff can be laid over a screenshot.
- `diffPercent` is the share of pixels that changed. A comparison is `changed` when any pixel differs, and `passed` when `diffPercent` is at most `--max-diff-percent`.
- **Images of different sizes are still compared.** Full-page screenshots often differ in height when content is added or removed. Both images are placed on a canvas the size of the larger one, and the area that only one image covers counts as changed. The result has `sizeChanged: true`.

There are two separate settings:

- **`--threshold`** controls per-pixel sensitivity. `0` is strictest; raise it to ignore anti-aliasing noise.
- **`--max-diff-percent`** controls pass/fail. With the default `0`, any change fails.

In manifest mode, a page that wasn't captured successfully in both runs is listed with `status: "skipped"` and counts as not passed.

## HTML report

`--html` writes a single self-contained HTML file with every screenshot embedded. For each page it shows the baseline and the new screenshot in four views: side by side, overlay, swipe, and new only. The diff highlights can be toggled or set to blink. Pages can be filtered by changed, unchanged or skipped, and the arrow keys move between pages.

## JavaScript API

```js
import { compareImages, compareManifests } from "noktra-diff";
import { writeHtmlReport } from "noktra-diff/report";

const result = await compareImages("before.png", "after.png", { diffPath: "diff.png" });
if (!result.passed) console.log(`${result.diffPercent}% of pixels changed`);

const results = await compareManifests(baselineManifest, comparisonManifest, {
  diffDir: "diffs",
  matchBy: "path",
});
await writeHtmlReport("report.html", results);
```

### `compareImages(baselinePath, comparisonPath, options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `diffPath` | string | — | Where to write the diff image; not written when omitted |
| `threshold` | number | `0.1` | Per-pixel colour sensitivity, `0` to `1` |
| `maxDiffPercent` | number | `0` | Largest `diffPercent` that still passes |

### `compareManifests(baselineManifest, comparisonManifest, options?)`

Takes two parsed capture manifests and returns one result per baseline page. Accepts the same options as `compareImages`, plus:

| Option | Type | Default | Description |
|---|---|---|---|
| `diffDir` | string | — | Folder for the diff images, named `001-diff.png`, `002-diff.png`, … |
| `matchBy` | `"url"` or `"path"` | `"url"` | Pair pages by full URL, or by path and query only |

### Other exports

| Export | Description |
|---|---|
| `writeHtmlReport(path, results)` (from `noktra-diff/report`) | Write the HTML report for an array of results |
| `buildHtmlReport(results)` (from `noktra-diff/report`) | Return the report HTML as a string |
| `readPng(path)` | Decode a PNG file into pixels |

## Output: diff-result.json

In two-image mode, one object; in manifest mode, an array with one per page, each with a `url` field added.

```jsonc
{
  "schemaVersion": 1,
  "createdAt": "2026-10-14T12:10:00.000Z",
  "baselinePath": "run-1/001-home.png",
  "comparisonPath": "run-2/001-home.png",
  "baselineSize": { "width": 1280, "height": 2140 },
  "comparisonSize": { "width": 1280, "height": 2200 },
  "threshold": 0.1,
  "maxDiffPercent": 0,
  "status": "compared",           // "compared"; "skipped" in manifest mode when a capture is missing
  "sizeChanged": true,
  "diffPath": "diffs/001-diff.png",
  "diffPixels": 96000,
  "totalPixels": 2816000,
  "diffPercent": 3.4091,
  "changed": true,
  "passed": false,
  "error": null
}
```

## License

MIT
