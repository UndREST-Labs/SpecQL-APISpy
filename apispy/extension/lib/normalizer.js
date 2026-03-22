// lib/normalizer.js — request field extraction and normalisation for APISpy
// Intentionally conservative in v1: we do not aggressively guess path templates.
// Template matching heuristics should be improved in later iterations.

"use strict";

(function (exports) {

  /**
   * Known path-segment patterns that represent template parameters in
   * Azure Resource Manager URLs.  A segment is replaced with `{param}` when
   * it matches one of these rules.
   *
   * Rules are ordered from most specific to least specific.
   * Only UUID/GUID-shaped segments and numeric resource IDs are normalised
   * in v1 — we do NOT try to guess arbitrary resource names.
   */
  const TEMPLATE_RULES = [
    // GUIDs / UUIDs  (e.g. subscriptionId, tenantId)
    {
      test: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      replace: "{guid}",
    },
    // Pure numeric IDs
    {
      test: /^\d+$/,
      replace: "{id}",
    },
  ];

  /**
   * Attempt to identify the api-version query parameter from a parsed URL.
   * Returns null if absent.
   * @param {URL} parsed
   * @returns {string|null}
   */
  function extractApiVersion(parsed) {
    return parsed.searchParams.get("api-version") || null;
  }

  /**
   * Normalise a URL path minimally for v1.
   * - Strip trailing slash (unless root "/")
   * - Decode percent-encoding
   * - Replace known-shape segments (GUIDs, pure integers) with placeholders
   *
   * We do NOT attempt to match arbitrary resource-name segments to spec
   * path templates in v1 — the matcher will handle that separately.
   *
   * @param {string} rawPath  The raw URL pathname.
   * @returns {string}  Normalised path.
   */
  function normalisePath(rawPath) {
    let path;
    try {
      path = decodeURIComponent(rawPath);
    } catch (_) {
      path = rawPath;
    }

    // Strip trailing slash (keep root intact)
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }

    // Replace known-shape segments
    const segments = path.split("/");
    const normalised = segments.map((seg) => {
      for (const rule of TEMPLATE_RULES) {
        if (rule.test.test(seg)) return rule.replace;
      }
      return seg;
    });

    return normalised.join("/");
  }

  /**
   * Parse and normalise all relevant fields from a raw request URL + method.
   *
   * @param {string} rawUrl     Full request URL string.
   * @param {string} rawMethod  HTTP method string (may be mixed case).
   * @returns {{
   *   ok: boolean,
   *   error?: string,
   *   method: string,
   *   host: string,
   *   pathname: string,
   *   normalisedPath: string,
   *   apiVersion: string|null,
   *   fullUrl: string,
   * }}
   */
  function normalise(rawUrl, rawMethod) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (err) {
      return { ok: false, error: "invalid_url: " + String(err) };
    }

    const method = (rawMethod || "GET").toUpperCase().trim();
    const host   = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;
    const normalisedPath = normalisePath(pathname);
    const apiVersion = extractApiVersion(parsed);

    return {
      ok: true,
      method,
      host,
      pathname,
      normalisedPath,
      apiVersion,
      fullUrl: rawUrl,
    };
  }

  // Export
  exports.Normalizer = {
    normalise,
    normalisePath,
    extractApiVersion,
    TEMPLATE_RULES,
  };

}(typeof window !== "undefined" ? window : exports));
