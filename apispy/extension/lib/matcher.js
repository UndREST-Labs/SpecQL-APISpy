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
   * Build a secondary route index keyed by placeholder-normalised route keys.
   *
   * Each entry stores both the original route definition and the original
   * route key so callers can report the real spec key to the user rather than
   * the normalised form.
   *
   * When two shard routes normalise to the same key (extremely rare in
   * practice — it would require two spec operations with identical path
   * structure but different only in parameter names) the first entry wins.
   *
   * @param {object} routes  Shard routes map (routeKey → routeDef).
   * @returns {object}       Normalised key → `{ routeDef, originalKey }`.
   * @private
   */
  function _buildNormalisedRouteIndex(routes) {
    const index = Object.create(null);
    for (const routeKey of Object.keys(routes)) {
      const normKey = _normalisePlaceholders(routeKey);
      if (!index[normKey]) {
        index[normKey] = { routeDef: routes[routeKey], originalKey: routeKey };
      }
    }
    return index;
  }

  /**
   * Attempt to match a normalised request against a loaded shard.
   *
   * Strategy (v2 — ARM-aware):
   *   1. Build candidate route keys from norm.armPath (ARM-templated) and
   *      norm.normalisedPath (generic-normalised), in that priority order.
   *   2. Try each candidate in order; use the first matching route key.
   *   3. If found, check whether the api-version exists in that route's versions.
   *   4. If no key matches, report provider_known_route_unknown.
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

    // Normalised-placeholder fallback.
    // Shard route keys may use spec-specific parameter names (e.g. {vaultName},
    // {secretName}) while armPath uses the structural placeholder {name} for all
    // resource-name positions.  Build a secondary index with every {xxx} replaced
    // by {name} so the lookup succeeds when only the placeholder name differs.
    if (norm.armPath) {
      const normIndex = _buildNormalisedRouteIndex(routes);
      const normKey   = _normalisePlaceholders(buildRouteKey(norm.method, norm.armPath));
      const entry     = normIndex[normKey];
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
    buildRouteKey,
    normalisePlaceholders: _normalisePlaceholders,
    STATUS,
    STATUS_LABELS,
  };

}(typeof window !== "undefined" ? window : exports));
