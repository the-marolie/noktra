// Promise-based file system for reading images and writing the report.
import fs from "node:fs/promises";
// Path helpers for creating the report folder and reading file names.
import path from "node:path";

/**
 * Read a PNG file and return it as a data URI so the report is one self-contained HTML file.
 * @param {string|null} filePath Path to the PNG, or null/undefined when there is no image.
 * @returns {Promise<string|null>} "data:image/png;base64,..." or null when unreadable.
 */
async function imageToDataUri(filePath) {
  // No path means no image for this slot.
  if (!filePath) {
    // The page renders a placeholder for null.
    return null;
  }
  // The file may be missing (e.g. a skipped comparison), so do not let that crash the report.
  try {
    // Read the bytes and encode them as base64 inside a data URI.
    const bytes = await fs.readFile(filePath);
    // Browsers decode data URIs directly, with no external file needed.
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    // Unreadable image: show a placeholder instead.
    return null;
  }
}

/**
 * Convert one comparison result into the plain data object the report page renders.
 * @param {object} result A compareImages() result (optionally with a `url` field).
 * @returns {Promise<object>} Snapshot data with embedded images.
 */
async function toSnapshotData(result) {
  // Human-readable outcome used for the badge and sidebar colour.
  let outcome = "unchanged";
  // Skipped comparisons (missing capture in one run).
  if (result.status === "skipped") {
    outcome = "skipped";
  } else if (result.status === "dimension_mismatch") {
    // Different sizes cannot be compared pixel by pixel.
    outcome = "mismatch";
  } else if (!result.passed) {
    // Compared and over the tolerance.
    outcome = "changed";
  }
  // Read the three images concurrently (any may be null).
  const [base, next, diff] = await Promise.all([
    imageToDataUri(result.baselinePath),
    imageToDataUri(result.comparisonPath),
    imageToDataUri(result.diffPath),
  ]);
  // Return only what the page needs.
  return {
    // Title: the URL when comparing manifests, otherwise the baseline file name.
    title: result.url ?? path.basename(result.baselinePath ?? "comparison"),
    outcome,
    diffPercent: result.diffPercent ?? null,
    error: result.error ?? null,
    base,
    next,
    diff,
  };
}

/**
 * Build a complete, self-contained, Percy-style HTML report.
 * @param {object[]} results Array of compareImages()/compareManifests() results.
 * @returns {Promise<string>} The HTML document as a string.
 */
export async function buildHtmlReport(results) {
  // Convert every result; Promise.all runs the image reads concurrently.
  const snapshots = await Promise.all(results.map(toSnapshotData));
  // Serialize for the page. "</" is escaped so a title can never close the <script> tag early.
  const json = JSON.stringify(snapshots).replace(/<\//g, "<\\/");
  // Summary counts for the header.
  const changed = snapshots.filter((s) => s.outcome === "changed").length;
  const unchanged = snapshots.filter((s) => s.outcome === "unchanged").length;
  const other = snapshots.length - changed - unchanged;
  // The page: sidebar + viewer, all CSS and JS inline. Rendering happens client-side from the JSON above.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visual diff report</title>
<style>
  :root { --bg: #f6f6f7; --panel: #fff; --line: #e3e3e6; --text: #1c1c1e; --muted: #6b6b73; --red: #e5484d; --green: #30a46c; --grey: #8b8b93; --accent: #5b5bd6; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; }
  .topbar { display: flex; align-items: center; gap: 16px; padding: 10px 16px; background: var(--panel); border-bottom: 1px solid var(--line); }
  .topbar h1 { font-size: 15px; margin: 0; }
  .topbar .summary { font-size: 13px; color: var(--muted); }
  .topbar .summary b { color: var(--text); }
  .layout { flex: 1; display: flex; min-height: 0; }
  .sidebar { width: 300px; flex-shrink: 0; background: var(--panel); border-right: 1px solid var(--line); overflow-y: auto; }
  .sidebar .filter { padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: 13px; display: flex; gap: 8px; }
  .sidebar .filter button { font-size: 12px; padding: 4px 8px; border: 1px solid var(--line); background: #fff; border-radius: 6px; cursor: pointer; }
  .sidebar .filter button.on { background: var(--text); color: #fff; border-color: var(--text); }
  .item { padding: 10px 12px; border-bottom: 1px solid var(--line); cursor: pointer; display: flex; gap: 10px; align-items: flex-start; }
  .item:hover { background: #fafafa; }
  .item.active { background: #eef0ff; }
  .item .dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; }
  .item .name { font-size: 12px; word-break: break-all; line-height: 1.35; }
  .item .pct { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .changed { background: var(--red); } .unchanged { background: var(--green); } .skipped, .mismatch { background: var(--grey); }
  .viewer { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .toolbar { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--panel); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .toolbar .title { font-size: 13px; font-weight: 600; word-break: break-all; flex: 1; min-width: 200px; }
  .pill { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; color: #fff; }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .seg button { border: 0; background: #fff; padding: 6px 10px; font-size: 12px; cursor: pointer; }
  .seg button + button { border-left: 1px solid var(--line); }
  .seg button.on { background: var(--text); color: #fff; }
  .toolbar label { font-size: 12px; display: flex; align-items: center; gap: 6px; }
  .toolbar .nav button { border: 1px solid var(--line); background: #fff; border-radius: 6px; padding: 5px 9px; cursor: pointer; font-size: 12px; }
  .stage { flex: 1; overflow: auto; padding: 16px; }
  .cols { display: flex; gap: 12px; align-items: flex-start; }
  .col { flex: 1; min-width: 0; }
  .cap { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin-bottom: 6px; }
  .frame { position: relative; background: #fff; border: 1px solid var(--line); line-height: 0; }
  .frame img { width: 100%; height: auto; display: block; }
  .frame .mask { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: .85; }
  .frame.nohl .mask { display: none; }
  .frame.flash .mask { animation: blink 1s steps(2, start) infinite; }
  @keyframes blink { to { visibility: hidden; } }
  .frame .top { position: absolute; inset: 0; width: 100%; height: 100%; }
  .frame.swipe .top { clip-path: inset(0 0 0 var(--cut, 50%)); }
  .frame .handle { position: absolute; top: 0; bottom: 0; left: var(--cut, 50%); width: 2px; background: var(--accent); pointer-events: none; }
  .frame .handle::after { content: "◀ ▶"; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--accent); color: #fff; font-size: 10px; padding: 3px 6px; border-radius: 999px; white-space: nowrap; }
  .empty { padding: 60px; text-align: center; color: var(--muted); border: 1px dashed var(--line); font-size: 13px; line-height: 1.4; }
  .note { font-size: 13px; color: var(--muted); padding: 0 0 12px; }
  .slider { width: 160px; }
  .hidden { display: none !important; }
</style>
</head>
<body>
<div class="topbar">
  <h1>Visual diff report</h1>
  <span class="summary"><b>${changed}</b> changed · <b>${unchanged}</b> unchanged · <b>${other}</b> skipped/mismatch</span>
  <span class="summary" style="margin-left:auto">Keys: ← → switch snapshot · D toggle highlights</span>
</div>
<div class="layout">
  <aside class="sidebar">
    <div class="filter">
      <button data-filter="all" class="on">All</button>
      <button data-filter="changed">Changed</button>
      <button data-filter="unchanged">Unchanged</button>
    </div>
    <div id="list"></div>
  </aside>
  <main class="viewer">
    <div class="toolbar">
      <span class="nav"><button id="prev">←</button> <button id="next">→</button></span>
      <span class="title" id="title"></span>
      <span class="pill" id="pill"></span>
      <span class="seg" id="modes">
        <button data-mode="side" class="on">Side by side</button>
        <button data-mode="overlay">Overlay</button>
        <button data-mode="swipe">Swipe</button>
        <button data-mode="new">New only</button>
      </span>
      <label><input type="checkbox" id="hl" checked> Highlight diffs</label>
      <label><input type="checkbox" id="flash"> Blink</label>
      <label id="opacityWrap" class="hidden">New opacity <input type="range" id="opacity" class="slider" min="0" max="1" step="0.05" value="0.5"></label>
      <label id="cutWrap" class="hidden">Swipe <input type="range" id="cut" class="slider" min="0" max="100" value="50"></label>
    </div>
    <div class="stage" id="stage"></div>
  </main>
</div>
<script>
  // All snapshot data, embedded at build time (images are base64 data URIs).
  const SNAPSHOTS = ${json};
  // Current UI state.
  const state = { index: 0, mode: "side", highlight: true, flash: false, opacity: 0.5, cut: 50, filter: "all" };
  // Short helper for DOM lookups.
  const $ = (sel) => document.querySelector(sel);
  // Frequently used elements.
  const list = $("#list"), stage = $("#stage"), title = $("#title"), pill = $("#pill");
  // Readable label for each outcome.
  const LABEL = { changed: "Changed", unchanged: "No changes", skipped: "Skipped", mismatch: "Size mismatch" };

  // Indices of snapshots that pass the current sidebar filter.
  function visibleIndices() {
    // "all" shows everything; otherwise match the outcome exactly.
    return SNAPSHOTS.map((s, i) => i).filter((i) => state.filter === "all" || SNAPSHOTS[i].outcome === state.filter);
  }

  // Escape text before inserting it as HTML.
  function esc(v) { return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  // Render the sidebar list.
  function renderList() {
    // Build one row per visible snapshot.
    list.innerHTML = visibleIndices().map((i) => {
      const s = SNAPSHOTS[i];
      // Percentage text, or the outcome label when there is no number.
      const pct = s.diffPercent === null ? LABEL[s.outcome] : s.diffPercent + "% changed";
      // Row markup; the data-i attribute links the row to its snapshot.
      return '<div class="item' + (i === state.index ? " active" : "") + '" data-i="' + i + '">' +
        '<span class="dot ' + s.outcome + '"></span><div><div class="name">' + esc(s.title) + '</div><div class="pct">' + esc(pct) + '</div></div></div>';
    }).join("");
  }

  // An <img> or a placeholder when the image is missing.
  function img(src, alt) { return src ? '<img src="' + src + '" alt="' + alt + '">' : '<div class="empty">No ' + alt + ' image</div>'; }
  // The "new" image drawn on top of "base" in overlay and swipe modes.
  function topImg(s, style) { return s.next ? '<img class="top" src="' + s.next + '" style="' + style + '" alt="new">' : ""; }
  // The red mask layered over the "new" image (only when a diff image exists).
  function mask(s) { return s.diff ? '<img class="mask" src="' + s.diff + '" alt="diff highlights">' : ""; }

  // Render the main viewer for the current snapshot and mode.
  function renderStage() {
    // The snapshot being shown.
    const s = SNAPSHOTS[state.index];
    // Header: title and outcome pill.
    title.textContent = s.title;
    pill.textContent = LABEL[s.outcome] + (s.diffPercent !== null ? " · " + s.diffPercent + "%" : "");
    pill.className = "pill " + s.outcome;
    // Classes that control highlight visibility and blinking.
    const fx = (state.highlight ? "" : " nohl") + (state.flash ? " flash" : "");
    // Explanatory note for non-compared results.
    let html = "";
    if (s.outcome === "mismatch") html = '<div class="note">' + esc(s.error) + ' — both images are shown but cannot be highlighted.</div>';
    if (s.outcome === "skipped") html = '<div class="note">' + esc(s.error) + '</div>';
    // Side by side: Base left, New (with highlights) right.
    if (state.mode === "side") {
      html += '<div class="cols"><div class="col"><div class="cap">Base</div><div class="frame">' + img(s.base, "base") + '</div></div>' +
        '<div class="col"><div class="cap">New</div><div class="frame' + fx + '">' + img(s.next, "new") + mask(s) + '</div></div></div>';
    // Overlay: New drawn on top of Base at adjustable opacity, highlights on top.
    } else if (state.mode === "overlay") {
      html += '<div class="cap">Base under New</div><div class="frame' + fx + '">' + img(s.base, "base") + topImg(s, "opacity:" + state.opacity) + mask(s) + '</div>';
    // Swipe: Base on the left of the divider, New on the right.
    } else if (state.mode === "swipe") {
      html += '<div class="cap">Base ◀ swipe ▶ New (drag on the image)</div><div class="frame swipe' + fx + '" style="--cut:' + state.cut + '%">' + img(s.base, "base") + topImg(s, "") + mask(s) + '<div class="handle"></div></div>';
    // New only: just the comparison image with highlights.
    } else {
      html += '<div class="cap">New</div><div class="frame' + fx + '">' + img(s.next, "new") + mask(s) + '</div>';
    }
    // Replace the stage contents.
    stage.innerHTML = html;
    // Show the slider that belongs to the current mode.
    $("#opacityWrap").classList.toggle("hidden", state.mode !== "overlay");
    $("#cutWrap").classList.toggle("hidden", state.mode !== "swipe");
    // Keep the sidebar highlight in sync.
    renderList();
  }

  // Move to another snapshot within the visible (filtered) list.
  function step(delta) {
    // Snapshots currently listed.
    const vis = visibleIndices();
    if (vis.length === 0) return;
    // Position of the current snapshot in the filtered list, or -1 if it is filtered out.
    const pos = vis.indexOf(state.index);
    // Wrap around at both ends.
    state.index = vis[(pos + delta + vis.length) % vis.length];
    renderStage();
    // Scroll the active row into view.
    const row = list.querySelector(".item.active");
    if (row) row.scrollIntoView({ block: "nearest" });
  }

  // Sidebar click selects a snapshot.
  list.addEventListener("click", (e) => { const row = e.target.closest(".item"); if (row) { state.index = Number(row.dataset.i); renderStage(); } });
  // Filter buttons.
  document.querySelectorAll(".filter button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".filter button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    state.filter = b.dataset.filter;
    // Jump to the first visible snapshot if the current one is filtered out.
    const vis = visibleIndices();
    if (!vis.includes(state.index) && vis.length) state.index = vis[0];
    renderStage();
  }));
  // Compare-mode buttons.
  document.querySelectorAll("#modes button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#modes button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    state.mode = b.dataset.mode;
    renderStage();
  }));
  // Highlight toggle, blink toggle, sliders, prev/next.
  $("#hl").addEventListener("change", (e) => { state.highlight = e.target.checked; renderStage(); });
  $("#flash").addEventListener("change", (e) => { state.flash = e.target.checked; renderStage(); });
  $("#opacity").addEventListener("input", (e) => { state.opacity = Number(e.target.value); const t = stage.querySelector(".top"); if (t) t.style.opacity = state.opacity; });
  $("#cut").addEventListener("input", (e) => { state.cut = Number(e.target.value); const f = stage.querySelector(".frame"); if (f) f.style.setProperty("--cut", state.cut + "%"); });
  $("#prev").addEventListener("click", () => step(-1));
  $("#next").addEventListener("click", () => step(1));
  // Keyboard shortcuts: arrows to move, D to toggle highlights.
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
    if (e.key.toLowerCase() === "d") { $("#hl").checked = !$("#hl").checked; state.highlight = $("#hl").checked; renderStage(); }
  });
  // Dragging on a swipe frame moves the divider.
  stage.addEventListener("pointermove", (e) => {
    if (state.mode !== "swipe" || e.buttons !== 1) return;
    const f = stage.querySelector(".frame"); const r = f.getBoundingClientRect();
    state.cut = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    f.style.setProperty("--cut", state.cut + "%"); $("#cut").value = state.cut;
  });
  // Prevent the browser's native image drag from interfering with swiping.
  stage.addEventListener("dragstart", (e) => e.preventDefault());

  // Start on the first changed snapshot if there is one, otherwise the first.
  const firstChanged = SNAPSHOTS.findIndex((s) => s.outcome === "changed");
  state.index = firstChanged >= 0 ? firstChanged : 0;
  // Initial render.
  if (SNAPSHOTS.length) renderStage(); else stage.innerHTML = '<div class="empty">No comparisons in this report.</div>';
</script>
</body>
</html>`;
}

/**
 * Write the HTML report to disk, creating its folder first.
 * @param {string} filePath Destination path for the .html file.
 * @param {object[]} results Comparison results to include.
 * @returns {Promise<void>} Resolves when written.
 */
export async function writeHtmlReport(filePath, results) {
  // Ensure the folder exists.
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // Build and save the document.
  await fs.writeFile(filePath, await buildHtmlReport(results));
}
