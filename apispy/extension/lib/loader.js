// lib/loader.js — lazy shard loader for APISpy
// Loads the top-level data manifest once, then fetches individual provider
// shards on demand.  Everything is static and local — no remote fetching.

"use strict";

(function (exports) {

  const DATA_MANIFEST_URL = chrome.runtime.getURL("data/manifest.json");

  /** Cached top-level manifest (loaded once). */
  let _manifestPromise = null;
  /** Map of provider_namespace → loaded shard data (or Promise). */
  const _shardCache = new Map();

  /**
   * Load and cache the top-level data manifest.
   * @returns {Promise<object>}  The manifest JSON object.
   */
  function loadManifest() {
    if (!_manifestPromise) {
      _manifestPromise = fetch(DATA_MANIFEST_URL)
        .then((r) => {
          if (!r.ok) throw new Error("Failed to load data/manifest.json: " + r.status);
          return r.json();
        })
        .catch((err) => {
          _manifestPromise = null; // allow retry
          throw err;
        });
    }
    return _manifestPromise;
  }

  /**
   * Given the top-level manifest, find the shard entry for a given provider
   * namespace.  Matching is case-insensitive.
   *
   * @param {object} manifest  Loaded manifest object.
   * @param {string} providerNamespace
   * @returns {object|null}  The shard entry or null if not bundled.
   */
  function findShardEntry(manifest, providerNamespace) {
    const lower = providerNamespace.toLowerCase();
    return (
      (manifest.shards || []).find(
        (s) => s.provider_namespace.toLowerCase() === lower
      ) || null
    );
  }

  /**
   * Load (and cache) the shard for the given provider namespace.
   * Returns null if the shard is not in the bundled manifest.
   *
   * @param {string} providerNamespace  e.g. "Microsoft.Storage"
   * @returns {Promise<object|null>}  Parsed shard JSON or null.
   */
  async function loadShard(providerNamespace) {
    const cacheKey = providerNamespace.toLowerCase();

    if (_shardCache.has(cacheKey)) {
      return _shardCache.get(cacheKey);
    }

    const manifest = await loadManifest();
    const entry = findShardEntry(manifest, providerNamespace);

    if (!entry) {
      _shardCache.set(cacheKey, null);
      return null;
    }

    const promise = fetch(chrome.runtime.getURL("data/shards/" + entry.filename))
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load shard " + entry.filename + ": " + r.status);
        return r.json();
      })
      .catch((err) => {
        _shardCache.delete(cacheKey); // allow retry
        throw err;
      });

    _shardCache.set(cacheKey, promise);
    return promise;
  }

  /**
   * Return the list of provider namespaces that are bundled (from manifest).
   * @returns {Promise<string[]>}
   */
  async function listBundledProviders() {
    const manifest = await loadManifest();
    return (manifest.shards || []).map((s) => s.provider_namespace);
  }

  /**
   * Return the source metadata from the manifest (generated_at, commit, etc.)
   * @returns {Promise<object>}
   */
  async function getSourceMetadata() {
    const manifest = await loadManifest();
    return manifest.source_metadata || {};
  }

  // Export
  exports.Loader = {
    loadManifest,
    loadShard,
    listBundledProviders,
    getSourceMetadata,
    findShardEntry,
  };

}(typeof window !== "undefined" ? window : exports));
