// panel.js — APISpy DevTools Panel main script
// Wires together: network observation, filtering, normalisation, matching, and UI.

"use strict";

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  /** @type {Array<RequestEntry>} All observed requests. */
  requests: [],
  /** @type {string} Active filter key. */
  filter: "all",
  /** @type {number|null} Index of the selected row (for detail panel). */
  selectedIdx: null,
};

// ── DOM refs ─────────────────────────────────────────────────────────────────

const tbody        = document.getElementById("request-tbody");
const statusText   = document.getElementById("status-text");
const requestCount = document.getElementById("request-count");
const filterSelect = document.getElementById("filter-select");
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
}

/**
 * @typedef {object} RequestEntry
 * @property {number}  idx
 * @property {string}  time
 * @property {string}  method
 * @property {string}  host
 * @property {string}  pathname
 * @property {string|null} apiVersion
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

  tr.innerHTML = [
    cell(entry.time,                              "col-time"),
    methodCell(entry.method),
    cell(entry.host,                              "col-host"),
    cell(entry.pathname,                          "col-path"),
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
  detailHeading.textContent = entry.method + " " + entry.host + entry.pathname;
  detailFields.innerHTML = "";

  const fields = [
    ["Time",                entry.time],
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
 * Returns true if the entry should be shown given the current filter.
 * @param {RequestEntry} entry
 * @returns {boolean}
 */
function passesFilter(entry) {
  if (state.filter === "all") return true;
  return entry.result.status === state.filter;
}

// ── UI event listeners ────────────────────────────────────────────────────────

function attachUIListeners() {
  filterSelect.addEventListener("change", () => {
    state.filter = filterSelect.value;
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
