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

console.log("\n=== Matcher.classify — shard_load_failed ===");
{
  const n = norm(
    "https://management.azure.com/subscriptions/12345678-1234-1234-1234-123456789abc/providers/Microsoft.FakeProvider/operations?api-version=2024-01-01",
    "GET"
  );
  const r = Matcher.classify(n, null, { inScope: true, shardLoadError: "HTTP 503: Service Unavailable" });
  eq(r.status, Matcher.STATUS.NO_SPEC_MATCH, "no_spec_match when shard load fails");
  eq(r.reason, "shard_load_failed", "reason=shard_load_failed");
  eq(r.error, "HTTP 503: Service Unavailable", "error message preserved");
  assert(r.provider_namespace === "Microsoft.FakeProvider", "provider_namespace inferred even on load failure");
}

console.log("\n=== Matcher.STATUS_LABELS ===");
Object.values(Matcher.STATUS).forEach((s) => {
  assert(Matcher.STATUS_LABELS[s], "label defined for status: " + s);
});

// ── ARM-templated route matching ──────────────────────────────────────────────
//
// These tests verify that the matcher uses norm.armPath (ARM-templated path)
// for route lookup, enabling requests with literal Azure resource names to
// match spec routes that use semantic placeholders like {name}.
//
// The shard below uses ARM-style placeholder keys as they appear in real
// SpecRecon shards derived from Azure REST API specs.

const ARM_MOCK_SHARD = {
  metadata: { provider_namespace: "Microsoft.KeyVault" },
  provider_namespace: "Microsoft.KeyVault",
  hosts: {
    "management.azure.com": {
      routes: {
        // KeyVault vault — spec route uses {subscriptionId}/{resourceGroupName}/{name}
        "GET /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.KeyVault/vaults/{name}": {
          method: "GET",
          path_template: "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.KeyVault/vaults/{vaultName}",
          provider_namespace: "Microsoft.KeyVault",
          versions: {
            "2023-07-01": { is_preview: false, spec_files: ["keyvault/2023-07-01/vaults.json"] },
            "2022-07-01": { is_preview: false, spec_files: ["keyvault/2022-07-01/vaults.json"] },
          },
        },
        // Storage blobServices/default — 'default' singleton preserved in spec key
        "GET /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Storage/storageAccounts/{name}/blobServices/default": {
          method: "GET",
          path_template: "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Storage/storageAccounts/{accountName}/blobServices/default",
          provider_namespace: "Microsoft.Storage",
          versions: {
            "2023-01-01": { is_preview: false, spec_files: ["storage/2023-01-01/blob.json"] },
          },
        },
        // Web app slots — two levels of resource names → {name}/{name}
        "GET /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Web/sites/{name}/slots/{name}": {
          method: "GET",
          path_template: "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Web/sites/{name}/slots/{slotName}",
          provider_namespace: "Microsoft.Web",
          versions: {
            "2023-12-01": { is_preview: false, spec_files: ["web/2023-12-01/sites.json"] },
          },
        },
      },
    },
  },
};

console.log("\n=== Matcher.classify — ARM-templated path: vault name → exact match ===");
{
  // Live request carries literal vault name "myvault".
  // Generic normaliser leaves it as-is; ARM templater replaces it with {name}.
  // The match succeeds via the ARM-templated path.
  const n = norm(
    "https://management.azure.com/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/rg-prod/providers/Microsoft.KeyVault/vaults/myvault?api-version=2023-07-01",
    "GET"
  );
  assert(n.normalisedPath.includes("myvault"),    "normalisedPath retains literal vault name");
  assert(!n.normalisedPath.includes("{name}"),    "normalisedPath does NOT have {name}");
  assert(n.armPath.includes("{name}"),            "armPath replaces vault name with {name}");
  assert(n.armPath.includes("{subscriptionId}"),  "armPath has {subscriptionId}");
  assert(n.armPath.includes("{resourceGroupName}"), "armPath has {resourceGroupName}");

  const r = Matcher.classify(n, ARM_MOCK_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.EXACT_MATCH, "exact_match via ARM-templated path");
  eq(r.matched_version, "2023-07-01",      "correct api-version matched");
  eq(r.provider_namespace, "Microsoft.KeyVault", "correct provider_namespace");
}

console.log("\n=== Matcher.classify — ARM-templated path: version mismatch via ARM path ===");
{
  const n = norm(
    "https://management.azure.com/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/rg-prod/providers/Microsoft.KeyVault/vaults/myvault?api-version=2099-01-01",
    "GET"
  );
  const r = Matcher.classify(n, ARM_MOCK_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.ROUTE_MISMATCH, "route found via ARM path but version absent → mismatch");
  assert(Array.isArray(r.matched_versions) && r.matched_versions.includes("2023-07-01"),
    "matched_versions lists known versions");
}

console.log("\n=== Matcher.classify — ARM-templated path: 'default' singleton preserved ===");
{
  // blobServices/default — 'default' must remain literal (it's in allowlist)
  // so the ARM path matches the spec key which also uses 'default' literally.
  const n = norm(
    "https://management.azure.com/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/rg1/providers/Microsoft.Storage/storageAccounts/mystorage/blobServices/default?api-version=2023-01-01",
    "GET"
  );
  assert(n.armPath.includes("blobServices/default"), "armPath preserves 'default' literal");
  assert(!n.armPath.includes("blobServices/{name}"), "armPath does NOT template 'default'");

  const r = Matcher.classify(n, ARM_MOCK_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.EXACT_MATCH, "exact_match with 'default' singleton preserved");
}

console.log("\n=== Matcher.classify — ARM-templated path: Web app slot → exact match ===");
{
  const n = norm(
    "https://management.azure.com/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/rg1/providers/Microsoft.Web/sites/mysite/slots/staging?api-version=2023-12-01",
    "GET"
  );
  eq(
    n.armPath,
    "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Web/sites/{name}/slots/{name}",
    "armPath templates both site name and slot name"
  );
  const r = Matcher.classify(n, ARM_MOCK_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.EXACT_MATCH, "exact_match for web app slot via ARM path");
}

console.log("\n=== Matcher.classify — ARM fallback: generic normalisedPath still works ===");
{
  // MOCK_SHARD uses the old-style {guid} key — the matcher must fall back to
  // normalisedPath when armPath doesn't match, preserving backward compatibility.
  const n = norm(
    "https://management.azure.com/subscriptions/12345678-1234-1234-1234-123456789abc/providers/Microsoft.FakeProvider/operations?api-version=2024-01-01",
    "GET"
  );
  // armPath uses {subscriptionId}, MOCK_SHARD key uses {guid} — no arm match.
  // normalisedPath uses {guid} — matches MOCK_SHARD key.
  assert(n.armPath.includes("{subscriptionId}"),  "armPath has {subscriptionId}");
  assert(n.normalisedPath.includes("{guid}"),     "normalisedPath has {guid}");

  const r = Matcher.classify(n, MOCK_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.EXACT_MATCH, "exact_match via normalisedPath fallback when armPath misses");
}

console.log(`\nMatcher: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
