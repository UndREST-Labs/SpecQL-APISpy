// lib/matcher.js — classifies normalised requests against the SpecRecon index
//
// Result states
// ─────────────
//   exact_match                — host + method + path template + api-version found
//   route_match_version_mismatch — route found but requested api-version absent
//   provider_known_route_unknown — provider namespace known; route not found
//   no_spec_match              — no provider namespace inferred or provider unknown
//   out_of_scope               — request is not Azure/Microsoft API traffic
//
// Route lookup strategy (v2 — ARM-aware)
// ────────────────────────────────────────
//   Route keys are tried in order of specificity:
//     1. norm.armPath  — ARM-structurally-templated path (subscriptionId,
//        resourceGroupName, {name}, etc.) — preferred because spec route keys
//        use semantic placeholders, not literal resource names.
//     2. norm.normalisedPath — generic-normalised path ({guid}, {id}) — kept as
//        a fallback to preserve backward compatibility with any shard whose
//        keys were generated from generic-normalised paths.
//   Using the ARM-templated path first reduces false "provider_known_route_unknown"
//   results caused by literal Azure resource names that the generic normaliser
//   does not replace (vault names, site names, storage account names, etc.).
//
// All results are returned as plain objects (never booleans).

"use strict";

(function (exports) {

  /**
   * Result states as a frozen enum-like object.
   */
  const STATUS = Object.freeze({
    EXACT_MATCH:               "exact_match",
    ROUTE_MISMATCH:            "route_match_version_mismatch",
    PROVIDER_KNOWN_NO_ROUTE:   "provider_known_route_unknown",
    NO_SPEC_MATCH:             "no_spec_match",
    ARM_ROOT_ROUTE:            "arm_root_route",
    OUT_OF_SCOPE:              "out_of_scope",
  });

  /**
   * Human-readable labels for each status.
   */
  const STATUS_LABELS = Object.freeze({
    [STATUS.EXACT_MATCH]:             "✅ Exact match",
    [STATUS.ROUTE_MISMATCH]:          "⚠️ Version mismatch",
    [STATUS.PROVIDER_KNOWN_NO_ROUTE]: "🔶 Unknown route",
    [STATUS.NO_SPEC_MATCH]:           "❌ No spec match",
    [STATUS.ARM_ROOT_ROUTE]:          "ℹ️ ARM root route",
    [STATUS.OUT_OF_SCOPE]:            "Out of scope",
  });

  /**
   * ARM root-level path keywords whose first segment unambiguously identifies
   * a request as targeting the Azure Resource Manager root surface (no
   * provider namespace in the URL).
   *
   * Examples: /subscriptions, /tenants, /providers,
   *           /subscriptions/{id}/providers (trailing /providers without a
   *           {Namespace} suffix).
   *
   * These are valid ARM endpoints documented by Microsoft, but they carry no
   * provider namespace in the URL, which means they cannot be matched against
   * a provider shard.  Under the classification model they receive the
   * ARM_ROOT_ROUTE status rather than NO_SPEC_MATCH to make the distinction
   * between "genuinely unrecognised" and "documented but provider-less" clear.
   */
  const ARM_ROOT_KEYWORDS = new Set([
    "subscriptions",
    "tenants",
    "providers",
    "managementGroups",
  ]);

  /**
   * Returns true when the request looks like a valid ARM root or tenant-scope
   * endpoint that has no provider namespace in the URL.
   *
   * Conditions:
   *   1. Host must be exactly "management.azure.com".
   *   2. The first non-empty path segment must be a known ARM root keyword.
   *
   * @param {object} norm  Output of Normalizer.normalise().
   * @returns {boolean}
   */
  function isArmRootPath(norm) {
    if (!norm || norm.host !== "management.azure.com") return false;
    const segs = (norm.pathname || "").split("/");
    for (let i = 0; i < segs.length; i++) {
      if (segs[i] !== "") return ARM_ROOT_KEYWORDS.has(segs[i]);
    }
    return false;
  }

  /**
   * Try to infer the provider namespace from a URL path.
   * Looks for /providers/Some.Namespace/ or /providers/Some.Namespace at end.
   *
   * Examples:
   *   /subscriptions/{guid}/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/x
   *     → "Microsoft.Storage"
   *   /providers/Microsoft.AAD/domainServices
   *     → "Microsoft.AAD"
   *
   * Returns null if no provider segment is found.
   *
   * @param {string} path  Normalised or raw URL path.
   * @returns {string|null}
   */
  function inferProviderNamespace(path) {
    // Match /providers/Namespace.Part (may have more segments after)
    const match = path.match(/\/providers\/([A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9.]+?)(?:\/|$)/);
    return match ? match[1] : null;
  }

  /**
   * Build the canonical route key used in the shard "routes" map.
   * Format: "METHOD /path/template"
   *
   * @param {string} method  Uppercase HTTP method.
   * @param {string} path    Path (may be normalised or raw).
   * @returns {string}
   */
  function buildRouteKey(method, path) {
    return method + " " + path;
  }

  /**
   * Replace ALL `{xxx}` placeholder names in a route key with `{name}`.
   *
   * Azure REST API spec path templates use resource-specific parameter names
   * such as `{vaultName}`, `{secretName}`, and `{accountName}`, while the ARM
   * normaliser always emits the structural placeholder `{name}` for resource-
   * name positions.  Normalising both sides to `{name}` before comparison
   * bridges this gap without requiring shard regeneration.
   *
   * @param {string} str  Route key or path string.
   * @returns {string}
   * @private
   */
  function _normalisePlaceholders(str) {
    return str.replace(/\{[^}]+\}/g, "{name}");
  }

  /**
   * Canonicalise a route key for resilient comparison across shard variations.
   *
   * Applies three normalisations on top of `_normalisePlaceholders`:
   *
   *   1. Placeholder normalisation: `{vaultName}` → `{name}` (same as
   *      `_normalisePlaceholders`).
   *
   *   2. ARM keyword case normalisation: fixed ARM scope keyword segments
   *      (`subscriptions`, `resourcegroups`, `tenants`, `locations`,
   *      `managementgroups`, `providers`) are lowercased.  Shard files
   *      generated from different versions of azure-rest-api-specs use
   *      inconsistent casing (e.g. `resourceGroups` vs `resourcegroups`,
   *      `managementGroups` vs `managementgroups`), so exact comparison
   *      fails without this step.
   *
   *   3. Trailing-slash stripping: some shard keys for collection list
   *      routes end with `/` (e.g. `.../deployments/`) while the normaliser
   *      always strips trailing slashes.  Stripping on both sides makes the
   *      comparison slash-agnostic.
   *
   * @param {string} str  Route key string ("METHOD /path/template").
   * @returns {string}    Canonicalised route key.
   * @private
   */
  function _canonicaliseRouteKey(str) {
    // 1. Normalise all {xxx} placeholders to {name}
    let result = _normalisePlaceholders(str);

    // 2. Lowercase fixed ARM keyword path segments (case varies across shard
    //    generations: resourceGroups vs resourcegroups, managementGroups vs
    //    managementgroups, Subscriptions vs subscriptions, etc.)
    result = result.replace(
      /\/(subscriptions|resourcegroups|tenants|locations|managementgroups|providers)(?=\/|$)/gi,
      (_, kw) => "/" + kw.toLowerCase()
    );

    // 3. Strip trailing slash from path portion (some shard keys for
    //    collection routes end with '/', normaliser never emits one)
    result = result.replace(/\s(.+)\/$/, (_, path) => " " + path);

    return result;
  }

  /**
   * Build a secondary route index keyed by canonicalised route keys.
   *
   * Each entry stores both the original route definition and the original
   * route key so callers can report the real spec key to the user rather than
   * the normalised form.
   *
   * The canonical key applies three normalisations via `_canonicaliseRouteKey`:
   *   - `{xxx}` placeholders → `{name}`
   *   - ARM scope keyword segments lowercased
   *   - Trailing slash stripped from path
   *
   * When two shard routes canonicalise to the same key the first entry wins.
   *
   * @param {object} routes  Shard routes map (routeKey → routeDef).
   * @returns {object}       Canonical key → `{ routeDef, originalKey }`.
   * @private
   */
  function _buildCanonicalRouteIndex(routes) {
    const index = Object.create(null);
    for (const routeKey of Object.keys(routes)) {
      const canonKey = _canonicaliseRouteKey(routeKey);
      if (!index[canonKey]) {
        index[canonKey] = { routeDef: routes[routeKey], originalKey: routeKey };
      }
    }
    return index;
  }

  /**
   * Build a secondary index of shard routes whose path ends with `/{default}`.
   *
   * Some Azure REST API specs model singleton resources using the parameter
   * name `{default}` (e.g. `GET /providers/Microsoft.Resources/dataBoundaries/{default}`).
   * There is exactly one valid value for `{default}`: the literal string
   * "default".  Clients sometimes call the parent path without the trailing
   * "/default" suffix (e.g. `GET /providers/Microsoft.Resources/dataBoundaries`).
   *
   * This index maps the canonical parent-path route key (the shard route key
   * with `/{default}` stripped and then canonicalised) to the original route
   * entry.  It is used as a last-resort fallback so that requests omitting the
   * "/default" singleton suffix are classified as "route match" rather than
   * "unknown route".
   *
   * Only shard routes whose last path segment is literally `{default}` in the
   * original key are indexed.  Generic resource-name placeholders such as
   * `{vaultName}` or `{deploymentName}` are intentionally excluded so that list
   * requests for a resource type are not incorrectly matched against the
   * single-resource GET route for that type.
   *
   * @param {object} routes  Shard routes map (routeKey → routeDef).
   * @returns {object}       Canonical parent key → `{ routeDef, originalKey }`.
   * @private
   */
  function _buildDefaultSingletonIndex(routes) {
    const index = Object.create(null);
    for (const routeKey of Object.keys(routes)) {
      // Split "METHOD /path" into method and path segments
      const spaceIdx = routeKey.indexOf(" ");
      if (spaceIdx < 0) continue;
      const pathPart = routeKey.slice(spaceIdx + 1);
      const segs = pathPart.split("/");
      // Only index routes whose last segment is the literal placeholder {default}
      if (segs[segs.length - 1] !== "{default}") continue;

      // Build the parent route key: strip the trailing /{default} segment
      const parentPathPart = segs.slice(0, -1).join("/");
      const parentRouteKey  = routeKey.slice(0, spaceIdx + 1) + parentPathPart;
      const parentCanonKey  = _canonicaliseRouteKey(parentRouteKey);

      if (!index[parentCanonKey]) {
        index[parentCanonKey] = { routeDef: routes[routeKey], originalKey: routeKey };
      }
    }
    return index;
  }

  /**
   * Resolve a match result for a found route entry against the request's
   * api-version.
   *
   * Centralises the "found route — check api-version" logic that is common to
   * the direct lookup, canonical-key fallback, and singleton-suffix fallback.
   *
   * @param {object}      routeDef         Route definition from the shard.
   * @param {string}      originalKey      Original shard route key.
   * @param {string}      providerNamespace  Provider namespace string.
   * @param {string|null} apiVersion       Request api-version (may be null).
   * @returns {object}    Match result (_result object).
   * @private
   */
  function _resolveRouteMatch(routeDef, originalKey, providerNamespace, apiVersion) {
    const versions = Object.keys(routeDef.versions || {});

    if (!apiVersion) {
      return _result(STATUS.ROUTE_MISMATCH, {
        provider_namespace:  providerNamespace,
        matched_route_key:   originalKey,
        matched_versions:    versions,
        reason:              "no_api_version_in_request",
        shard_name:          providerNamespace,
      });
    }

    if (routeDef.versions[apiVersion]) {
      return _result(STATUS.EXACT_MATCH, {
        provider_namespace:  providerNamespace,
        matched_route_key:   originalKey,
        matched_versions:    versions,
        matched_version:     apiVersion,
        shard_name:          providerNamespace,
        reason:              "exact",
      });
    }

    return _result(STATUS.ROUTE_MISMATCH, {
      provider_namespace:  providerNamespace,
      matched_route_key:   originalKey,
      matched_versions:    versions,
      reason:              "api_version_not_in_spec",
      shard_name:          providerNamespace,
    });
  }

  /**
   * WeakMap cache for route indices keyed on the shard routes object.
   *
   * Indices are built lazily the first time a shard is matched and then reused
   * for every subsequent request to the same shard (same routes object
   * reference).  The WeakMap allows the cached indices to be garbage-collected
   * when the shard is no longer referenced.
   *
   * @type {WeakMap<object, { canon: object, singleton: object }>}
   * @private
   */
  const _routeIndexCache = new WeakMap();

  /**
   * Return (or lazily build and cache) the canonical and singleton indices
   * for a given routes object.
   *
   * @param {object} routes  Shard routes map (routeKey → routeDef).
   * @returns {{ canon: object, singleton: object }}
   * @private
   */
  function _getRouteIndices(routes) {
    if (_routeIndexCache.has(routes)) {
      return _routeIndexCache.get(routes);
    }
    const indices = {
      canon:     _buildCanonicalRouteIndex(routes),
      singleton: _buildDefaultSingletonIndex(routes),
    };
    _routeIndexCache.set(routes, indices);
    return indices;
  }

  /**
   * Attempt to match a normalised request against a loaded shard.
   *
   * Strategy (v3 — ARM-aware):
   *   1. Build candidate route keys from norm.armPath (ARM-templated) and
   *      norm.normalisedPath (generic-normalised), in that priority order.
   *   2. Try each candidate in order; use the first matching route key.
   *   3. If found, check whether the api-version exists in that route's versions.
   *   4. Canonical-key fallback: normalise both sides (placeholders + ARM
   *      keyword casing + trailing slash) and retry.
   *   5. Default-singleton suffix fallback: if the spec defines the route with
   *      a `/{default}` suffix that the client omitted, match against that
   *      singleton route rather than reporting "unknown route".
   *   6. If no key matches, report provider_known_route_unknown.
   *
   * Trying norm.armPath first reduces false "provider_known_route_unknown"
   * results caused by literal Azure resource names (vault names, site names,
   * storage account names, etc.) that the generic normaliser does not replace
   * but the ARM structural templating stage does.
   *
   * @param {object} norm    Output of Normalizer.normalise().
   * @param {object} shard   Loaded shard JSON for the inferred provider.
   * @returns {object}       Match result object.
   */
  function matchAgainstShard(norm, shard) {
    const providerNamespace = shard.provider_namespace;
    const hostData = shard.hosts && shard.hosts[norm.host];

    if (!hostData) {
      // Provider is known (we have a shard) but this host isn't in it
      return _result(STATUS.PROVIDER_KNOWN_NO_ROUTE, {
        provider_namespace: providerNamespace,
        reason: "host_not_in_shard",
        shard_name: shard.metadata && shard.metadata.provider_namespace,
      });
    }

    const routes = hostData.routes || {};

    // Build candidate path list: prefer armPath, fall back to normalisedPath.
    // armPath equals normalisedPath when no ARM structural rules applied, so
    // deduplication avoids a redundant lookup in that case.
    const candidatePaths = [];
    if (norm.armPath && norm.armPath !== norm.normalisedPath) {
      candidatePaths.push(norm.armPath);
    }
    candidatePaths.push(norm.normalisedPath);

    for (const candidatePath of candidatePaths) {
      const routeKey = buildRouteKey(norm.method, candidatePath);
      if (!routes[routeKey]) continue;
      return _resolveRouteMatch(routes[routeKey], routeKey, providerNamespace, norm.apiVersion);
    }

    // Canonical-key fallback.
    // Applies placeholder normalisation + ARM keyword lowercasing + trailing-
    // slash stripping to handle the two known shard inconsistencies:
    //   • ARM scope keywords: `resourceGroups` vs `resourcegroups`,
    //     `managementGroups` vs `managementgroups`, etc.
    //   • Collection list routes: shard key ends with '/', normalised path
    //     never does (e.g. ".../deployments/" in the shard vs
    //     ".../deployments" from the normaliser).
    //
    // Indices are cached per routes object (_getRouteIndices) and also reused
    // by the {default} singleton-suffix fallback below.
    if (norm.armPath) {
      const { canon: canonIndex, singleton: singletonIndex } = _getRouteIndices(routes);
      const canonKey = _canonicaliseRouteKey(buildRouteKey(norm.method, norm.armPath));

      const entry = canonIndex[canonKey];
      if (entry) {
        return _resolveRouteMatch(entry.routeDef, entry.originalKey, providerNamespace, norm.apiVersion);
      }

      // {default} singleton-suffix fallback.
      //
      // Some Azure ARM specs define singleton resources using the parameter
      // name `{default}` — e.g. `.../dataBoundaries/{default}`.  Clients
      // sometimes call the parent path without the trailing "/default" suffix
      // (e.g. `GET /providers/Microsoft.Resources/dataBoundaries`).
      //
      // The singleton index maps parent canonical keys to the `{default}`
      // singleton route so that these requests are classified as "route match"
      // rather than "unknown route".
      const singletonEntry = singletonIndex[canonKey];
      if (singletonEntry) {
        return _resolveRouteMatch(singletonEntry.routeDef, singletonEntry.originalKey, providerNamespace, norm.apiVersion);
      }
    }

    // No route key matched any candidate path
    return _result(STATUS.PROVIDER_KNOWN_NO_ROUTE, {
      provider_namespace: providerNamespace,
      reason:             "route_not_in_shard",
      shard_name:         providerNamespace,
    });
  }

  /**
   * Main classification entry point.
   * Accepts a normalised request and a (possibly null) shard.
   *
   * @param {object}      norm   Output of Normalizer.normalise() — must have ok===true.
   * @param {object|null} shard  Loaded shard JSON for the inferred provider, or null.
   * @param {object}      [opts]
   * @param {boolean}     [opts.inScope=true]       Whether the request is in scope per filters.
   * @param {string|null} [opts.shardLoadError=null] Error message if shard fetch/parse failed.
   * @returns {object}  Classification result.
   */
  function classify(norm, shard, opts) {
    const inScope        = (opts && opts.inScope        !== undefined) ? opts.inScope        : true;
    const shardLoadError = (opts && opts.shardLoadError !== undefined) ? opts.shardLoadError : null;

    if (!inScope) {
      return _result(STATUS.OUT_OF_SCOPE, {
        reason: "not_azure_microsoft",
      });
    }

    if (!norm || !norm.ok) {
      return _result(STATUS.NO_SPEC_MATCH, {
        reason: "normalisation_failed",
      });
    }

    if (!shard) {
      const inferredNs = inferProviderNamespace(norm.pathname);
      if (shardLoadError) {
        return _result(STATUS.NO_SPEC_MATCH, {
          provider_namespace: inferredNs || null,
          reason:             "shard_load_failed",
          error:              shardLoadError,
        });
      }
      if (!inferredNs) {
        // No provider namespace in the URL.  Distinguish between valid ARM
        // root/tenant endpoints (e.g. /subscriptions, /tenants, /providers)
        // and genuinely non-matching requests.
        if (isArmRootPath(norm)) {
          return _result(STATUS.ARM_ROOT_ROUTE, {
            reason: "arm_root_no_provider",
          });
        }
        return _result(STATUS.NO_SPEC_MATCH, {
          provider_namespace: null,
          reason: "no_provider_inferred",
        });
      }
      return _result(STATUS.NO_SPEC_MATCH, {
        provider_namespace: inferredNs,
        reason: "provider_shard_not_bundled",
      });
    }

    return matchAgainstShard(norm, shard);
  }

  /**
   * Convenience: build a result object with standard fields.
   * @private
   */
  function _result(status, extra) {
    return Object.assign(
      {
        status,
        label:              STATUS_LABELS[status] || status,
        provider_namespace: null,
        matched_route_key:  null,
        matched_versions:   null,
        matched_version:    null,
        shard_name:         null,
        reason:             null,
        error:              null,
      },
      extra
    );
  }

  // Export
  exports.Matcher = {
    classify,
    matchAgainstShard,
    inferProviderNamespace,
    isArmRootPath,
    buildRouteKey,
    normalisePlaceholders:  _normalisePlaceholders,
    canonicaliseRouteKey:   _canonicaliseRouteKey,
    STATUS,
    STATUS_LABELS,
  };

}(typeof window !== "undefined" ? window : exports));
