// panel.js — APISpy DevTools Panel main script
// Wires together: network observation, filtering, normalisation, matching, and UI.

"use strict";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * All status values that can appear in the table.
 * `out_of_scope` and requests with no inferred provider are never recorded,
 * so only provider-matched statuses are listed here.
 */
const ALL_STATUSES = Object.freeze([
  "exact_match",
  "route_match_version_mismatch",
  "provider_known_route_unknown",
  "no_spec_match",
  "arm_root_route",
]);

const DEFAULT_DETAIL_HEIGHT = 220; // px

/** CSV column headers (must match entryToCsvRow order). */
const CSV_HEADER = [
  "Time", "URL", "Batch Sub", "Batch Name", "Method", "Host", "Path",
  "Normalised Path", "api-version", "Status", "Reason",
  "Provider Namespace", "Matched Route", "Available Versions", "Shard", "Load Error",
].join(",");

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  /** @type {Array<RequestEntry>} All observed requests. */
  requests: [],
  /**
   * Set of status values currently visible.
   * An entry is shown when its status is in this set.
   * @type {Set<string>}
   */
  activeFilters: new Set(ALL_STATUSES),
  /** @type {number|null} Index of the selected row (for detail panel). */
  selectedIdx: null,
  /** @type {boolean} Whether newly added rows should be scrolled into view. */
  autoscroll: true,
  /** @type {number} Current height of the detail panel in px. */
  detailHeight: DEFAULT_DETAIL_HEIGHT,
};

// ── DOM refs ─────────────────────────────────────────────────────────────────

const tbody          = document.getElementById("request-tbody");
const statusText     = document.getElementById("status-text");
const requestCount   = document.getElementById("request-count");
const filterGroup    = document.getElementById("filter-group");
const btnClear       = document.getElementById("btn-clear");
const btnAutoscroll  = document.getElementById("btn-autoscroll");
const btnCopyAll     = document.getElementById("btn-copy-all");
const btnCsv         = document.getElementById("btn-csv");
const emptyState     = document.getElementById("empty-state");
const detailPanel    = document.getElementById("detail-panel");
const detailResizer  = document.getElementById("detail-resizer");
const detailClose    = document.getElementById("detail-close");
const detailCopy     = document.getElementById("detail-copy");
const detailNetwork  = document.getElementById("detail-find-network");
const detailFields   = document.getElementById("detail-fields");
const detailHeading  = document.getElementById("detail-heading");

// ── Initialisation ────────────────────────────────────────────────────────────

async function init() {
  setStatus("Loading index...");

  try {
    const meta = await Loader.getSourceMetadata();
    const providers = await Loader.listBundledProviders();
    const stamp = meta.generated_at ? new Date(meta.generated_at).toLocaleDateString() : "unknown";
    setStatus(providers.length + " providers bundled (export " + stamp + ")");
  } catch (err) {
    setStatus("Failed to load data manifest: " + err.message);
  }

  updateTbodyHeight();
  attachNetworkObserver();
  attachUIListeners();
}

// ── Layout / sizing ───────────────────────────────────────────────────────────

/**
 * Recalculate and apply the tbody height so it fills the space above the
 * detail panel (or all remaining space when the panel is hidden).
 */
function updateTbodyHeight() {
  const toolbarEl = document.querySelector(".toolbar");
  const theadEl   = document.querySelector(".request-table thead");
  const toolbarH  = toolbarEl ? toolbarEl.offsetHeight : 42;
  const theadH    = theadEl   ? theadEl.offsetHeight   : 28;
  const detailH   = detailPanel.classList.contains("hidden") ? 0 : state.detailHeight;
  tbody.style.height = Math.max(60, window.innerHeight - toolbarH - theadH - detailH) + "px";
}

// ── Network observation ───────────────────────────────────────────────────────

function attachNetworkObserver() {
  chrome.devtools.network.onRequestFinished.addListener(onRequestFinished);
}

/**
 * Called by the DevTools network observer for each finished request.
 * @param {chrome.devtools.network.Request} req
 */
async function onRequestFinished(req) {
  const url    = req.request && req.request.url;
  const method = req.request && req.request.method;
  if (!url) return;

  const scope = Filters.classifyScope(url);
  const norm = Normalizer.normalise(url, method);
  const entry = await buildEntry(req, norm, scope);

  // Record entries where a provider namespace was identified, or entries for
  // ARM root routes (valid ARM endpoints with no provider namespace such as
  // /subscriptions or /tenants).  Skip out-of-scope and no-spec-match entries.
  if (entry.result.provider_namespace !== null ||
      entry.result.status === Matcher.STATUS.ARM_ROOT_ROUTE) {
    state.requests.push(entry);
    renderRow(entry, state.requests.length - 1);
    updateCountBadge();
  }

  // Always expand ARM batch requests even if the parent row was filtered out.
  if (Filters.isBatchRequest(url, method)) {
    await expandBatchSubRequests(req);
  }
}

/**
 * Parse an ARM batch request body and add a row for each contained sub-request.
 * Sub-request bodies are read from req.request.postData.text.
 * @param {object} req  HAR-style request object.
 */
async function expandBatchSubRequests(req) {
  const bodyText = req.request && req.request.postData && req.request.postData.text;
  if (!bodyText) return;

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (_) {
    return;
  }

  const subRequests = Array.isArray(body.requests) ? body.requests : [];
  for (const sub of subRequests) {
    const subUrl    = sub.url    || sub.Url    || sub.URL;
    const subMethod = sub.httpMethod || sub.method || "GET";
    if (!subUrl) continue;

    // Build a minimal synthetic HAR-like object so buildEntry can process it.
    const syntheticReq = {
      startedDateTime: req.startedDateTime,
      request: { url: subUrl, method: subMethod, postData: null },
    };

    const scope = Filters.classifyScope(subUrl);
    const norm  = Normalizer.normalise(subUrl, subMethod);
    const entry = await buildEntry(syntheticReq, norm, scope);
    entry.isBatchSub = true;
    entry.batchName  = sub.name != null ? String(sub.name) : null;

    if (entry.result.provider_namespace === null) continue;

    state.requests.push(entry);
    renderRow(entry, state.requests.length - 1);
    updateCountBadge();
  }
}

/**
 * @typedef {object} RequestEntry
 * @property {number}  idx
 * @property {string}  time
 * @property {string|null} url  Full original request URL (for deep-linking).
 * @property {string}  method
 * @property {string}  host
 * @property {string}  pathname
 * @property {string|null} apiVersion
 * @property {boolean} [isBatchSub]  True when this row originated from a batch sub-request.
 * @property {string|null} [batchName]  Name/index of the sub-request within the batch.
 * @property {object}  norm
 * @property {object}  result
 * @property {object}  raw
 */

/**
 * Build a full RequestEntry from a finished network request.
 * @param {object} req  HAR-style request object from DevTools.
 * @param {object} norm  Output of Normalizer.normalise().
 * @param {object} scope  Output of Filters.classifyScope().
 * @returns {Promise<RequestEntry>}
 */
async function buildEntry(req, norm, scope) {
  const idx = state.requests.length;
  const time = req.startedDateTime
    ? new Date(req.startedDateTime).toLocaleTimeString()
    : "--:--:--";

  let result;
  if (!scope.inScope) {
    result = Matcher.classify(norm, null, { inScope: false });
  } else if (!norm.ok) {
    result = Matcher.classify(norm, null, { inScope: true });
  } else {
    // Infer provider namespace and load shard lazily
    const ns = Matcher.inferProviderNamespace(norm.pathname);
    let shard = null;
    let shardLoadError = null;
    if (ns) {
      try {
        shard = await Loader.loadShard(ns);
      } catch (err) {
        shardLoadError = err && err.message ? err.message : String(err);
        shard = null;
      }
    }
    result = Matcher.classify(norm, shard, { inScope: true, shardLoadError });
  }

  return {
    idx,
    time,
    url:        (req.request && req.request.url) || null,
    method:     norm.ok ? norm.method : (req.request && req.request.method || "?").toUpperCase(),
    host:       norm.ok ? norm.host : "?",
    pathname:   norm.ok ? norm.pathname : "?",
    normPath:   norm.ok ? norm.normalisedPath : "?",
    apiVersion: norm.ok ? norm.apiVersion : null,
    norm,
    result,
    raw: req,
  };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/**
 * Append a single table row for an entry.
 * @param {RequestEntry} entry
 * @param {number} idx
 */
function renderRow(entry, idx) {
  if (!passesFilter(entry)) return;

  const tr = document.createElement("tr");
  tr.dataset.idx = idx;
  tr.setAttribute("role", "button");
  tr.setAttribute("tabindex", "0");
  tr.setAttribute("aria-label", entry.method + " " + entry.pathname);
  if (entry.isBatchSub) tr.classList.add("batch-sub");

  tr.innerHTML = [
    cell(entry.time,                              "col-time"),
    methodCell(entry.method),
    cell(entry.host,                              "col-host"),
    batchPathCell(entry),
    cell(entry.apiVersion || "",                  "col-version"),
    statusCell(entry.result),
  ].join("");

  tr.addEventListener("click", () => selectRow(idx, tr));
  tr.addEventListener("keydown", (e) => { if (e.key === "Enter") selectRow(idx, tr); });
  tbody.appendChild(tr);

  if (state.autoscroll) {
    tbody.scrollTop = tbody.scrollHeight;
  }

  toggleEmptyState();
}

function cell(text, cls) {
  const safe = escHtml(text);
  return `<td class="${cls}" title="${safe}">${safe}</td>`;
}

/**
 * Render the path cell, prefixing batch sub-requests with a visual indicator.
 * @param {RequestEntry} entry
 * @returns {string}
 */
function batchPathCell(entry) {
  const safe = escHtml(entry.pathname);
  if (entry.isBatchSub) {
    const name = entry.batchName != null ? " [" + escHtml(entry.batchName) + "]" : "";
    return `<td class="col-path" title="${safe}"><span class="batch-sub-indicator">&#x21B3;</span>${safe}${name}</td>`;
  }
  return `<td class="col-path" title="${safe}">${safe}</td>`;
}

function methodCell(method) {
  const cls = "method-badge method-" + escHtml(method);
  return `<td class="col-method"><span class="${cls}">${escHtml(method)}</span></td>`;
}

function statusCell(result) {
  const status = result.status;
  const label  = escHtml(result.label || status);
  return `<td class="col-status"><span class="status-badge status-${escHtml(status)}">${label}</span></td>`;
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Re-render the table from scratch applying current filter. */
function rerender() {
  tbody.innerHTML = "";
  state.requests.forEach((entry, idx) => renderRow(entry, idx));
  toggleEmptyState();
}

function toggleEmptyState() {
  const hasRows = tbody.children.length > 0;
  emptyState.classList.toggle("hidden", hasRows);
}

function updateCountBadge() {
  requestCount.textContent = state.requests.length;
}

function setStatus(msg) {
  statusText.textContent = msg;
}

/** Temporarily show a message in the status bar, then restore the previous text. */
let _flashTimer = null;
let _flashBaseText = null;
function flashStatus(msg, durationMs) {
  // Capture the base text only on the first call (not mid-flash).
  if (!_flashTimer) {
    _flashBaseText = statusText.textContent;
  } else {
    clearTimeout(_flashTimer);
  }
  statusText.textContent = msg;
  _flashTimer = setTimeout(() => {
    statusText.textContent = _flashBaseText;
    _flashTimer = null;
    _flashBaseText = null;
  }, durationMs || 3000);
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function selectRow(idx, tr) {
  // Deselect previous
  tbody.querySelectorAll("tr.selected").forEach((r) => r.classList.remove("selected"));
  tr.classList.add("selected");
  state.selectedIdx = idx;
  showDetail(state.requests[idx]);
}

function showDetail(entry) {
  const r = entry.result;
  const heading = (entry.isBatchSub ? "[batch] " : "") + entry.method + " " + entry.host + entry.pathname;
  detailHeading.textContent = heading;
  detailFields.innerHTML = "";

  // Fields: [label, value, cssClass?, isLink?]
  const fields = [
    ["URL",                 entry.url || "",                             "url-field", true],
    ["Time",                entry.time],
    ...(entry.isBatchSub ? [["Batch sub-request", entry.batchName != null ? "#" + entry.batchName : "yes"]] : []),
    ["Method",              entry.method],
    ["Host",                entry.host],
    ["Path",                entry.pathname],
    ["Normalised path",     entry.normPath],
    ["api-version",         entry.apiVersion || ""],
    ["Status",              r.label || r.status, "status-text"],
    ["Provider namespace",  r.provider_namespace || ""],
    ["Matched route",       r.matched_route_key || ""],
    ["Available versions",  (r.matched_versions && r.matched_versions.join(", ")) || ""],
    ["Shard / source",      r.shard_name || ""],
    ["Reason",              r.reason || ""],
    ...(r.error ? [["Load error", r.error, "load-error"]] : []),
  ];

  fields.forEach(([label, value, extraClass, isLink]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    if (isLink && value) {
      const a = document.createElement("a");
      a.href = value;
      a.textContent = value;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      dd.appendChild(a);
    } else {
      dd.textContent = value;
    }
    if (extraClass) dd.classList.add(extraClass);
    detailFields.appendChild(dt);
    detailFields.appendChild(dd);
  });

  detailPanel.style.height = state.detailHeight + "px";
  detailPanel.classList.remove("hidden");
  updateTbodyHeight();
}

function closeDetail() {
  detailPanel.classList.add("hidden");
  tbody.querySelectorAll("tr.selected").forEach((r) => r.classList.remove("selected"));
  state.selectedIdx = null;
  updateTbodyHeight();
}

// ── Filtering ─────────────────────────────────────────────────────────────────

/**
 * Returns true if the entry should be shown given the current active filters.
 * @param {RequestEntry} entry
 * @returns {boolean}
 */
function passesFilter(entry) {
  return state.activeFilters.has(entry.result.status);
}

// ── Clipboard / export ────────────────────────────────────────────────────────

/**
 * Write text to the clipboard using the Clipboard API with an execCommand fallback.
 * @param {string} text
 */
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => execCommandCopy(text));
  } else {
    execCommandCopy(text);
  }
}

function execCommandCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch (_) {}
  document.body.removeChild(ta);
}

/**
 * Build a CSV row for a single entry.  All fields are double-quoted.
 * @param {RequestEntry} entry
 * @returns {string}
 */
function entryToCsvRow(entry) {
  const r = entry.result;
  const cols = [
    entry.time,
    entry.url || "",
    entry.isBatchSub ? "yes" : "no",
    entry.batchName || "",
    entry.method,
    entry.host,
    entry.pathname,
    entry.normPath,
    entry.apiVersion || "",
    r.status,
    r.reason || "",
    r.provider_namespace || "",
    r.matched_route_key || "",
    (r.matched_versions && r.matched_versions.join("; ")) || "",
    r.shard_name || "",
    r.error || "",
  ];
  return cols.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(",");
}

/** Copy all currently visible rows as tab-separated text. */
function copyAllVisible() {
  const headerCols = [
    "Time", "URL", "Batch Sub", "Batch Name", "Method", "Host", "Path",
    "Normalised Path", "api-version", "Status", "Reason",
    "Provider Namespace", "Matched Route", "Available Versions", "Shard", "Load Error",
  ];
  const visible = state.requests.filter((e) => passesFilter(e));
  const rows = [headerCols.join("\t")];
  visible.forEach((e) => {
    const r = e.result;
    rows.push([
      e.time,
      e.url || "",
      e.isBatchSub ? "yes" : "no",
      e.batchName || "",
      e.method,
      e.host,
      e.pathname,
      e.normPath,
      e.apiVersion || "",
      r.status,
      r.reason || "",
      r.provider_namespace || "",
      r.matched_route_key || "",
      (r.matched_versions && r.matched_versions.join("; ")) || "",
      r.shard_name || "",
      r.error || "",
    ].join("\t"));
  });
  copyToClipboard(rows.join("\n"));
}

/** Copy the selected entry's detail as plain text. */
function copyEntryDetail(entry) {
  const r = entry.result;
  const lines = [
    "URL: "                + (entry.url || ""),
    "Time: "               + entry.time,
    "Method: "             + entry.method,
    "Host: "               + entry.host,
    "Path: "               + entry.pathname,
    "Normalised Path: "    + entry.normPath,
    "api-version: "        + (entry.apiVersion || ""),
    "Status: "             + (r.label || r.status),
    "Reason: "             + (r.reason || ""),
    "Provider Namespace: " + (r.provider_namespace || ""),
    "Matched Route: "      + (r.matched_route_key || ""),
    "Available Versions: " + ((r.matched_versions && r.matched_versions.join(", ")) || ""),
    "Shard: "              + (r.shard_name || ""),
  ];
  if (entry.isBatchSub) {
    lines.splice(2, 0, "Batch Sub-Request: " + (entry.batchName != null ? "#" + entry.batchName : "yes"));
  }
  if (r.error) {
    lines.push("Load Error: " + r.error);
  }
  copyToClipboard(lines.join("\n"));
}

/** Trigger a CSV download of all requests. */
function saveCSV() {
  if (state.requests.length === 0) return;
  const lines = [CSV_HEADER];
  state.requests.forEach((e) => lines.push(entryToCsvRow(e)));
  const csv = lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  const ts   = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  a.href     = url;
  a.download = "apispy-" + ts + ".csv";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Draggable detail panel resize ────────────────────────────────────────────

function attachDetailResizer() {
  detailResizer.addEventListener("mousedown", (e) => {
    const startY = e.clientY;
    const startH = state.detailHeight;

    detailResizer.classList.add("dragging");
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";

    function onMouseMove(ev) {
      const delta = startY - ev.clientY; // drag up = taller
      const minH = 80;
      const maxH = Math.floor(window.innerHeight * 0.8);
      state.detailHeight = Math.min(maxH, Math.max(minH, startH + delta));
      detailPanel.style.height = state.detailHeight + "px";
      updateTbodyHeight();
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      detailResizer.classList.remove("dragging");
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    e.preventDefault();
  });
}

// ── UI event listeners ────────────────────────────────────────────────────────

function attachUIListeners() {
  // Multi-select filter toggle buttons
  filterGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn[data-status]");
    if (!btn) return;
    const status = btn.dataset.status;

    if (status === "all") {
      // Reset: activate all individual status filters
      ALL_STATUSES.forEach((s) => state.activeFilters.add(s));
      filterGroup.querySelectorAll(".filter-btn[data-status]").forEach((b) => b.classList.add("active"));
    } else {
      // Toggle the clicked status
      if (state.activeFilters.has(status)) {
        state.activeFilters.delete(status);
        btn.classList.remove("active");
      } else {
        state.activeFilters.add(status);
        btn.classList.add("active");
      }
      // Keep the "All" button highlighted only when every status is active
      const allBtn = filterGroup.querySelector(".filter-btn[data-status='all']");
      if (allBtn) {
        allBtn.classList.toggle("active", state.activeFilters.size === ALL_STATUSES.length);
      }
    }
    rerender();
  });

  // Autoscroll toggle
  btnAutoscroll.addEventListener("click", () => {
    state.autoscroll = !state.autoscroll;
    btnAutoscroll.classList.toggle("active", state.autoscroll);
  });

  // Copy all visible rows
  btnCopyAll.addEventListener("click", copyAllVisible);

  // Save CSV
  btnCsv.addEventListener("click", saveCSV);

  // Clear
  btnClear.addEventListener("click", () => {
    state.requests = [];
    state.selectedIdx = null;
    tbody.innerHTML = "";
    closeDetail();
    updateCountBadge();
    toggleEmptyState();
  });

  // Detail panel buttons
  detailClose.addEventListener("click", closeDetail);
  detailCopy.addEventListener("click", () => {
    if (state.selectedIdx != null && state.requests[state.selectedIdx]) {
      copyEntryDetail(state.requests[state.selectedIdx]);
    }
  });
  detailNetwork.addEventListener("click", () => {
    if (state.selectedIdx != null && state.requests[state.selectedIdx]) {
      const url = state.requests[state.selectedIdx].url;
      if (url) {
        copyToClipboard(url);
        flashStatus(
          "URL copied \u2014 open the Network panel, press Ctrl/Cmd+F and paste to locate this entry",
          4000
        );
      }
    }
  });

  // Draggable resize handle
  attachDetailResizer();

  // Keep layout correct when the DevTools window is resized
  window.addEventListener("resize", updateTbodyHeight);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

init();
