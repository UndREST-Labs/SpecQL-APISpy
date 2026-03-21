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
    [STATUS.OUT_OF_SCOPE]:            "— Out of scope",
  });

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
   * Attempt to match a normalised request against a loaded shard.
   *
   * Strategy (v1 — conservative):
   *   1. Look for an exact route key (method + normalised path).
   *   2. If found, check whether the api-version exists in that route's versions.
   *   3. If no exact key, report provider_known_route_unknown.
   *
   * Future versions may add fuzzy path-template matching.
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

    // Exact route key lookup
    const routeKey = buildRouteKey(norm.method, norm.normalisedPath);
    if (routes[routeKey]) {
      const routeDef = routes[routeKey];
      const versions = Object.keys(routeDef.versions || {});

      if (!norm.apiVersion) {
        // No api-version in request — treat as route found, version unknown
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

      // Route found but api-version not in spec
      return _result(STATUS.ROUTE_MISMATCH, {
        provider_namespace:  providerNamespace,
        matched_route_key:   routeKey,
        matched_versions:    versions,
        reason:              "api_version_not_in_spec",
        shard_name:          providerNamespace,
      });
    }

    // Route not found in this provider's shard
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
    buildRouteKey,
    STATUS,
    STATUS_LABELS,
  };

}(typeof window !== "undefined" ? window : exports));
