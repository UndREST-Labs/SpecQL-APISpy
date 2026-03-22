// panel.js — APISpy DevTools Panel main script
// Wires together: network observation, filtering, normalisation, matching, and UI.

"use strict";

// ── Constants ─────────────────────────────────────────────────────────────────

/** All known result status values — used to drive the multi-select filter. */
const ALL_STATUSES = Object.freeze([
  "exact_match",
  "route_match_version_mismatch",
  "provider_known_route_unknown",
  "no_spec_match",
  "out_of_scope",
]);

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
};

// ── DOM refs ─────────────────────────────────────────────────────────────────

const tbody        = document.getElementById("request-tbody");
const statusText   = document.getElementById("status-text");
const requestCount = document.getElementById("request-count");
const filterGroup  = document.getElementById("filter-group");
const btnClear     = document.getElementById("btn-clear");
const emptyState   = document.getElementById("empty-state");
const detailPanel  = document.getElementById("detail-panel");
const detailClose  = document.getElementById("detail-close");
const detailFields = document.getElementById("detail-fields");
const detailHeading = document.getElementById("detail-heading");

// ── Initialisation ────────────────────────────────────────────────────────────

async function init() {
  setStatus("Loading index…");

  try {
    const meta = await Loader.getSourceMetadata();
    const providers = await Loader.listBundledProviders();
    const stamp = meta.generated_at ? new Date(meta.generated_at).toLocaleDateString() : "unknown";
    setStatus("Ready — " + providers.length + " providers bundled (export " + stamp + ")");
  } catch (err) {
    setStatus("⚠️ Failed to load data manifest: " + err.message);
  }

  attachNetworkObserver();
  attachUIListeners();
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
  state.requests.push(entry);
  renderRow(entry, state.requests.length - 1);
  updateCountBadge();

  // Expand ARM batch requests: classify each sub-request independently.
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

    state.requests.push(entry);
    renderRow(entry, state.requests.length - 1);
    updateCountBadge();
  }
}

/**
 * @typedef {object} RequestEntry
 * @property {number}  idx
 * @property {string}  time
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
    return `<td class="col-path" title="${safe}"><span class="batch-sub-indicator">↳</span>${safe}${name}</td>`;
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
  const heading = (entry.isBatchSub ? "↳ [batch] " : "") + entry.method + " " + entry.host + entry.pathname;
  detailHeading.textContent = heading;
  detailFields.innerHTML = "";

  const fields = [
    ["Time",                entry.time],
    ...(entry.isBatchSub ? [["Batch sub-request", entry.batchName != null ? "#" + entry.batchName : "yes"]] : []),
    ["Method",              entry.method],
    ["Host",                entry.host],
    ["Path",                entry.pathname],
    ["Normalised path",     entry.normPath],
    ["api-version",         entry.apiVersion || "—"],
    ["Status",              r.label || r.status, "status-text"],
    ["Provider namespace",  r.provider_namespace || "—"],
    ["Matched route",       r.matched_route_key || "—"],
    ["Available versions",  (r.matched_versions && r.matched_versions.join(", ")) || "—"],
    ["Shard / source",      r.shard_name || "—"],
    ["Reason",              r.reason || "—"],
    ...(r.error ? [["Load error", r.error, "load-error"]] : []),
  ];

  fields.forEach(([label, value, extraClass]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    if (extraClass) dd.classList.add(extraClass);
    detailFields.appendChild(dt);
    detailFields.appendChild(dd);
  });

  detailPanel.classList.remove("hidden");
}

function closeDetail() {
  detailPanel.classList.add("hidden");
  tbody.querySelectorAll("tr.selected").forEach((r) => r.classList.remove("selected"));
  state.selectedIdx = null;
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

// ── UI event listeners ────────────────────────────────────────────────────────

function attachUIListeners() {
  // Multi-select filter toggle buttons
  filterGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn[data-status]");
    if (!btn) return;
    const status = btn.dataset.status;

    if (status === "all") {
      // Reset — activate all individual status filters
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

  btnClear.addEventListener("click", () => {
    state.requests = [];
    state.selectedIdx = null;
    tbody.innerHTML = "";
    closeDetail();
    updateCountBadge();
    toggleEmptyState();
  });

  detailClose.addEventListener("click", closeDetail);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

init();
