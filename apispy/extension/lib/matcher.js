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
// Route lookup strategy (v3 — ARM-aware + extension-resource + canonical)
// ────────────────────────────────────────────────────────────────────────
//   Route keys are tried in order of specificity:
//     1. norm.armPath  — ARM-structurally-templated path (subscriptionId,
//        resourceGroupName, {name}, etc.) — preferred because spec route keys
//        use semantic placeholders, not literal resource names.
//     2. norm.normalisedPath — generic-normalised path ({guid}, {id}) — kept as
//        a fallback to preserve backward compatibility with any shard whose
//        keys were generated from generic-normalised paths.
//     3. Canonical-key fallback — all {xxx} → {name}, lowercased, trailing
//        slash stripped.  Bridges mismatches caused by spec-specific parameter
//        names (e.g. {vaultName} vs {name}), mixed-case segment spelling (e.g.
//        resourcegroups vs resourceGroups in some spec files), and trailing
//        slashes present in some spec route keys.
//     4. {resourceUri} suffix matching — for Azure extension-resource routes
//        whose paths start with /{resourceUri}/…  (e.g.
//        GET /{resourceUri}/providers/Microsoft.Insights/metrics).  Matches by
//        checking whether the request's arm path ends with the route suffix.
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
    [STATUS.OUT_OF_SCOPE]:            "Out of scope",
  });

  // ── Provider namespace helpers ────────────────────────────────────────────

  /**
   * Normalise the casing of an extracted Azure provider namespace so that
   * case drift in live URLs (e.g. "microsoft.management" from an Azure Portal
   * request) does not prevent loading the correct shard.
   *
   * Azure provider namespaces always follow PascalCase per segment
   * (e.g. "Microsoft.KeyVault", "Microsoft.Management").  This function
   * capitalises the first letter of each dot-separated segment while leaving
   * the remainder unchanged so that names like "Microsoft.AAD" are preserved
   * correctly.
   *
   * @param {string} ns  Raw provider namespace string.
   * @returns {string}   Namespace with first letter of each segment capitalised.
   * @private
   */
  function _normaliseNamespaceCasing(ns) {
    return ns.split(".").map(function (seg) {
      return seg.length ? seg.charAt(0).toUpperCase() + seg.slice(1) : seg;
    }).join(".");
  }

  /**
   * Try to infer the provider namespace from a URL path.
   * Looks for the FIRST /providers/Some.Namespace/ or /providers/Some.Namespace
   * at end.
   *
   * The extracted namespace is normalised to PascalCase per segment so that
   * URL casing differences (e.g. "microsoft.management") are resolved to the
   * canonical form ("Microsoft.Management") used as shard file keys.
   *
   * Examples:
   *   /subscriptions/{guid}/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/x
   *     → "Microsoft.Storage"
   *   /providers/microsoft.management/getEntities
   *     → "Microsoft.Management"
   *
   * Returns null if no provider segment is found.
   *
   * @param {string} path  Normalised or raw URL path.
   * @returns {string|null}
   */
  function inferProviderNamespace(path) {
    // Match /providers/Namespace.Part (may have more segments after)
    const match = path.match(/\/providers\/([A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9.]+?)(?:\/|$)/);
    return match ? _normaliseNamespaceCasing(match[1]) : null;
  }

  /**
   * For paths with a nested /providers/ segment (Azure extension resources),
   * return the LAST provider namespace in the path.  Returns null when the path
   * has fewer than two /providers/ occurrences (i.e. normal non-extension paths).
   *
   * Extension resources are Azure resources whose properties are exposed via a
   * secondary provider appended to the parent resource ID, e.g.:
   *
   *   /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.KeyVault/
   *   vaults/{vault}/providers/Microsoft.Insights/metrics
   *                                              ↑ last provider = Microsoft.Insights
   *
   * The last provider namespace is used by panel.js as a fallback shard to
   * load when the primary (first) provider shard does not contain the route.
   *
   * @param {string} path  Normalised or raw URL path.
   * @returns {string|null}
   */
  function inferLastProviderNamespace(path) {
    const re = /\/providers\/([A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9.]+?)(?:\/|$)/g;
    let last = null;
    let count = 0;
    let m;
    while ((m = re.exec(path)) !== null) {
      last = m[1];
      count++;
    }
    // Only return for nested (extension) provider paths
    return (count >= 2 && last) ? _normaliseNamespaceCasing(last) : null;
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
   * Return a canonical form of a route key for case-insensitive, trailing-slash-
   * tolerant, and placeholder-agnostic comparison.
   *
   * Three normalisations are applied:
   *   1. All `{xxx}` → `{name}` (placeholder-name agnostic, as in v2).
   *   2. Trailing slashes stripped from the path portion — some spec route keys
   *      end with `/` (e.g. `GET …/deployments/`) while the normalised request
   *      path never does.
   *   3. Entire key lowercased — spec files occasionally use `resourcegroups`
   *      (lowercase) while the ARM normaliser always emits `resourceGroups`.
   *      Lowercasing both sides makes the comparison case-insensitive.
   *
   * @param {string} routeKey  e.g. "GET /subscriptions/{subscriptionId}/…"
   * @returns {string}
   * @private
   */
  function _canonicaliseRouteKey(routeKey) {
    return _normalisePlaceholders(routeKey).replace(/\/+$/, "").toLowerCase();
  }

  /**
   * Build a secondary route index keyed by canonical route keys.
   *
   * Each entry stores both the original route definition and the original
   * route key so callers can report the real spec key to the user rather than
   * the normalised form.
   *
   * When two shard routes canonicalise to the same key (extremely rare in
   * practice) the first entry wins.
   *
   * @param {object} routes  Shard routes map (routeKey → routeDef).
   * @returns {object}       Canonical key → `{ routeDef, originalKey }`.
   * @private
   */
  function _buildNormalisedRouteIndex(routes) {
    const index = Object.create(null);
    for (const routeKey of Object.keys(routes)) {
      const normKey = _canonicaliseRouteKey(routeKey);
      if (!index[normKey]) {
        index[normKey] = { routeDef: routes[routeKey], originalKey: routeKey };
      }
    }
    return index;
  }

  /**
   * Build an index of shard routes that use the `{resourceUri}` (or any single
   * leading placeholder) pattern, keyed by the canonical suffix that follows the
   * leading placeholder.
   *
   * Azure extension-resource specs define routes like:
   *   GET /{resourceUri}/providers/Microsoft.Insights/metrics
   *
   * where `{resourceUri}` expands to the full parent resource path.  These
   * routes cannot be matched by exact key lookup.  Instead, we extract the
   * suffix (/providers/Microsoft.Insights/metrics) and check whether the
   * request's arm path ends with that suffix.
   *
   * Only routes whose path starts with a single placeholder segment are indexed.
   * Routes with a non-placeholder leading segment (e.g. /subscriptions/…) are
   * handled by the standard lookup passes and are not included here.
   *
   * @param {object} routes  Shard routes map.
   * @returns {object}  Canonical suffix → { routeDef, originalKey }.
   * @private
   */
  function _buildResourceUriSuffixIndex(routes) {
    const index = Object.create(null);
    // Route key format: "METHOD /{placeholder}/rest/of/path"
    // We capture the method and the suffix (everything after the first /{…}).
    const RESOURCE_URI_ROUTE_RE = /^([A-Z]+) \/\{[^}]+\}(\/.+)$/;
    for (const routeKey of Object.keys(routes)) {
      const m = RESOURCE_URI_ROUTE_RE.exec(routeKey);
      if (!m) continue;
      const method = m[1];
      const suffix = m[2]; // e.g. "/providers/Microsoft.Insights/metrics"
      const canonKey = _canonicaliseRouteKey(method + " " + suffix);
      if (!index[canonKey]) {
        index[canonKey] = { routeDef: routes[routeKey], originalKey: routeKey };
      }
    }
    return index;
  }

  /**
   * Attempt to match a normalised request against a loaded shard.
   *
   * Strategy (v3 — ARM-aware + canonical + resourceUri):
   *   1. Exact key from norm.armPath  (ARM-templated path).
   *   2. Exact key from norm.normalisedPath (generic-normalised, backward compat).
   *   3. Canonical-key fallback: all {xxx}→{name}, lowercase, trailing slash
   *      stripped.  Handles spec files with non-canonical casing (resourcegroups
   *      vs resourceGroups) and trailing slashes in route keys.
   *   4. {resourceUri} suffix matching: for Azure extension-resource routes
   *      whose path starts with /{resourceUri}/…  Matches when the arm path
   *      ends with the route's suffix after the {resourceUri} placeholder.
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

    // ── Pass 1 & 2: exact key lookup ─────────────────────────────────────────
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

      const routeDef = routes[routeKey];
      const versions = Object.keys(routeDef.versions || {});

      if (!norm.apiVersion) {
        return _result(STATUS.ROUTE_MISMATCH, {
          provider_namespace:  providerNamespace,
          matched_route_key:   routeKey,
          matched_versions:    versions,
          reason:              "no_api_version_in_request",
          shard_name:          providerNamespace,
        });
      }

      if (routeDef.versions[norm.apiVersion]) {
        return _result(STATUS.EXACT_MATCH, {
          provider_namespace:  providerNamespace,
          matched_route_key:   routeKey,
          matched_versions:    versions,
          matched_version:     norm.apiVersion,
          shard_name:          providerNamespace,
          reason:              "exact",
        });
      }

      return _result(STATUS.ROUTE_MISMATCH, {
        provider_namespace:  providerNamespace,
        matched_route_key:   routeKey,
        matched_versions:    versions,
        reason:              "api_version_not_in_spec",
        shard_name:          providerNamespace,
      });
    }

    // ── Pass 3: canonical-key fallback ───────────────────────────────────────
    // All {xxx}→{name}, lowercase, trailing slash stripped.
    // This handles: spec-specific param names ({vaultName} vs {name}),
    // mixed-case segment spelling (resourcegroups vs resourceGroups in spec
    // files), and trailing slashes on some spec route keys.
    if (norm.armPath) {
      const canonIndex = _buildNormalisedRouteIndex(routes);
      const canonKey   = _canonicaliseRouteKey(buildRouteKey(norm.method, norm.armPath));
      const entry      = canonIndex[canonKey];
      if (entry) {
        const { routeDef, originalKey } = entry;
        const versions = Object.keys(routeDef.versions || {});

        if (!norm.apiVersion) {
          return _result(STATUS.ROUTE_MISMATCH, {
            provider_namespace:  providerNamespace,
            matched_route_key:   originalKey,
            matched_versions:    versions,
            reason:              "no_api_version_in_request",
            shard_name:          providerNamespace,
          });
        }

        if (routeDef.versions[norm.apiVersion]) {
          return _result(STATUS.EXACT_MATCH, {
            provider_namespace:  providerNamespace,
            matched_route_key:   originalKey,
            matched_versions:    versions,
            matched_version:     norm.apiVersion,
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
    }

    // ── Pass 4: {resourceUri} suffix matching ─────────────────────────────────
    // Extension-resource routes in Azure specs use /{resourceUri}/… to represent
    // a variable-length parent resource path.  We match these by checking whether
    // the request's arm path ends with the suffix that follows {resourceUri}.
    //
    // Example: GET /{resourceUri}/providers/Microsoft.Insights/metrics
    //   suffix  = /providers/Microsoft.Insights/metrics
    //   armPath = /subscriptions/{subscriptionId}/…/vaults/{name}/providers/Microsoft.Insights/metrics
    //   endsWith? YES → match!
    if (norm.armPath) {
      const suffixIndex = _buildResourceUriSuffixIndex(routes);
      const canonArmPath = _normalisePlaceholders(norm.armPath).toLowerCase();
      const method = norm.method.toLowerCase();

      for (const suffixKey of Object.keys(suffixIndex)) {
        if (!suffixKey.startsWith(method + " ")) continue;
        const suffix = suffixKey.slice(method.length + 1); // e.g. "/providers/microsoft.insights/metrics"
        if (suffix && canonArmPath.endsWith(suffix)) {
          const { routeDef, originalKey } = suffixIndex[suffixKey];
          const versions = Object.keys(routeDef.versions || {});

          if (!norm.apiVersion) {
            return _result(STATUS.ROUTE_MISMATCH, {
              provider_namespace:  providerNamespace,
              matched_route_key:   originalKey,
              matched_versions:    versions,
              reason:              "no_api_version_in_request",
              shard_name:          providerNamespace,
            });
          }

          if (routeDef.versions[norm.apiVersion]) {
            return _result(STATUS.EXACT_MATCH, {
              provider_namespace:  providerNamespace,
              matched_route_key:   originalKey,
              matched_versions:    versions,
              matched_version:     norm.apiVersion,
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
      return _result(STATUS.NO_SPEC_MATCH, {
        provider_namespace: inferredNs || null,
        reason: inferredNs ? "provider_shard_not_bundled" : "no_provider_inferred",
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
    inferLastProviderNamespace,
    buildRouteKey,
    normalisePlaceholders: _normalisePlaceholders,
    canonicaliseRouteKey:  _canonicaliseRouteKey,
    STATUS,
    STATUS_LABELS,
  };

}(typeof window !== "undefined" ? window : exports));
