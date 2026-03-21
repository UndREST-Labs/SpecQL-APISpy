// tests/test_matcher.js — unit tests for lib/matcher.js

"use strict";

const { URL } = require("url");
if (typeof global.URL === "undefined") global.URL = URL;

// Load normalizer (matcher depends on nothing, but we use normalizer to build norm objects)
const normExports = {};
eval(require("fs").readFileSync(__dirname + "/../extension/lib/normalizer.js", "utf8")
  .replace('typeof window !== "undefined" ? window : exports', 'normExports'));
const { Normalizer } = normExports;

const matchExports = {};
eval(require("fs").readFileSync(__dirname + "/../extension/lib/matcher.js", "utf8")
  .replace('typeof window !== "undefined" ? window : exports', 'matchExports'));
const { Matcher } = matchExports;

let pass = 0;
let fail = 0;

function assert(condition, label) {
  if (condition) {
    console.log("  ✅ " + label);
    pass++;
  } else {
    console.error("  ❌ FAIL: " + label);
    fail++;
  }
}

function eq(a, b, label) {
  assert(a === b, label + " (got: " + JSON.stringify(a) + ", expected: " + JSON.stringify(b) + ")");
}

// ── Minimal synthetic shard fixture ──────────────────────────────────────────
//
// Route keys must match what Normalizer.normalise() actually produces.
// The normalizer replaces GUIDs → {guid} and integers → {id} but does NOT
// replace arbitrary resource names in v1.  We therefore use route paths that
// only contain GUID-shaped variable segments so the exact-lookup still works.

const MOCK_SHARD = {
  metadata: { provider_namespace: "Microsoft.FakeProvider" },
  provider_namespace: "Microsoft.FakeProvider",
  hosts: {
    "management.azure.com": {
      routes: {
        // Path uses only GUID segment → normalizer produces matching key
        "GET /subscriptions/{guid}/providers/Microsoft.FakeProvider/operations": {
          method: "GET",
          path_template: "/subscriptions/{subscriptionId}/providers/Microsoft.FakeProvider/operations",
          provider_namespace: "Microsoft.FakeProvider",
          versions: {
            "2024-01-01": { is_preview: false, spec_files: ["fake/2024-01-01/fake.json"] },
            "2023-01-01": { is_preview: false, spec_files: ["fake/2023-01-01/fake.json"] },
          },
        },
      },
    },
  },
};

// ── Helper ────────────────────────────────────────────────────────────────────

function norm(url, method) {
  return Normalizer.normalise(url, method);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log("\n=== Matcher.inferProviderNamespace ===");
eq(Matcher.inferProviderNamespace("/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/x"),
   "Microsoft.Storage", "infers Microsoft.Storage from path");
eq(Matcher.inferProviderNamespace("/providers/Microsoft.AAD/operations"),
   "Microsoft.AAD", "infers Microsoft.AAD from /providers/ root");
eq(Matcher.inferProviderNamespace("/subscriptions/abc"),
   null, "returns null when no provider segment");

console.log("\n=== Matcher.classify — out of scope ===");
{
  const n = norm("https://example.com/api/data", "GET");
  const r = Matcher.classify(n, null, { inScope: false });
  eq(r.status, Matcher.STATUS.OUT_OF_SCOPE, "out-of-scope status");
}

console.log("\n=== Matcher.classify — no shard / no provider inferred ===");
{
  const n = norm("https://management.azure.com/subscriptions/abc", "GET");
  const r = Matcher.classify(n, null, { inScope: true });
  eq(r.status, Matcher.STATUS.NO_SPEC_MATCH, "no_spec_match when no shard");
}

console.log("\n=== Matcher.classify — exact match ===");
{
  // Only the subscription GUID is normalised; the rest of the path is literal.
  const n = norm(
    "https://management.azure.com/subscriptions/12345678-1234-1234-1234-123456789abc/providers/Microsoft.FakeProvider/operations?api-version=2024-01-01",
    "GET"
  );
  const r = Matcher.classify(n, MOCK_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.EXACT_MATCH, "exact_match status");
  eq(r.provider_namespace, "Microsoft.FakeProvider", "correct provider_namespace");
  eq(r.matched_version, "2024-01-01", "correct matched_version");
  assert(Array.isArray(r.matched_versions), "matched_versions is array");
}

console.log("\n=== Matcher.classify — route match, version mismatch ===");
{
  const n = norm(
    "https://management.azure.com/subscriptions/12345678-1234-1234-1234-123456789abc/providers/Microsoft.FakeProvider/operations?api-version=2025-99-99",
    "GET"
  );
  const r = Matcher.classify(n, MOCK_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.ROUTE_MISMATCH, "route_match_version_mismatch status");
  assert(r.matched_versions.includes("2024-01-01"), "matched_versions contains known version");
}

console.log("\n=== Matcher.classify — provider known, route unknown ===");
{
  const n = norm(
    "https://management.azure.com/subscriptions/12345678-1234-1234-1234-123456789abc/providers/Microsoft.FakeProvider/unknownResource?api-version=2024-01-01",
    "GET"
  );
  const r = Matcher.classify(n, MOCK_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.PROVIDER_KNOWN_NO_ROUTE, "provider_known_route_unknown status");
  eq(r.provider_namespace, "Microsoft.FakeProvider", "provider_namespace still reported");
}

console.log("\n=== Matcher.classify — no api-version → route_match_version_mismatch ===");
{
  const n = norm(
    "https://management.azure.com/subscriptions/12345678-1234-1234-1234-123456789abc/providers/Microsoft.FakeProvider/operations",
    "GET"
  );
  const r = Matcher.classify(n, MOCK_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.ROUTE_MISMATCH, "missing api-version → route_mismatch");
  eq(r.reason, "no_api_version_in_request", "correct reason");
}

console.log("\n=== Matcher.STATUS_LABELS ===");
Object.values(Matcher.STATUS).forEach((s) => {
  assert(Matcher.STATUS_LABELS[s], "label defined for status: " + s);
});

console.log(`\nMatcher: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
