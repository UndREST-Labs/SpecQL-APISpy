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
  // /subscriptions/abc has no provider namespace but IS a valid ARM root path.
  // Under the updated classification it returns arm_root_route, not no_spec_match.
  const n = norm("https://management.azure.com/subscriptions/abc", "GET");
  const r = Matcher.classify(n, null, { inScope: true });
  eq(r.status, Matcher.STATUS.ARM_ROOT_ROUTE, "arm_root_route for /subscriptions/... with no provider namespace");
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

// ── Normalised-placeholder fallback ──────────────────────────────────────────
//
// Real SpecRecon shard files use spec-specific parameter names such as
// {vaultName}, {secretName}, {keyName}, etc. — not the structural {name}
// placeholder emitted by the ARM normaliser.  The matcher must bridge this
// gap via a normalised-placeholder fallback that maps all {xxx} → {name}
// before comparing route keys.
//
// These tests reproduce the exact scenario shown in the GitHub issue where
// requests to known KeyVault routes were incorrectly classified as
// "Unknown route / route_not_in_shard".

const REAL_SHARD_FORMAT = {
  metadata: { provider_namespace: "Microsoft.KeyVault" },
  provider_namespace: "Microsoft.KeyVault",
  hosts: {
    "management.azure.com": {
      routes: {
        // Route key uses spec-specific {vaultName} — not the structural {name}
        "GET /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.KeyVault/vaults/{vaultName}": {
          method: "GET",
          path_template: "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.KeyVault/vaults/{vaultName}",
          provider_namespace: "Microsoft.KeyVault",
          versions: {
            "2024-11-01": { is_preview: false, spec_files: ["keyvault/2024-11-01/vaults.json"] },
            "2023-07-01": { is_preview: false, spec_files: ["keyvault/2023-07-01/vaults.json"] },
          },
        },
        // Multi-level resource names: {vaultName}/keys/{keyName}
        "GET /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.KeyVault/vaults/{vaultName}/keys/{keyName}": {
          method: "GET",
          path_template: "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.KeyVault/vaults/{vaultName}/keys/{keyName}",
          provider_namespace: "Microsoft.KeyVault",
          versions: {
            "2024-11-01": { is_preview: false, spec_files: ["keyvault/2024-11-01/keys.json"] },
          },
        },
        // Singleton 'default' preserved in spec key (blobServices/default pattern)
        "GET /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Storage/storageAccounts/{accountName}/blobServices/default": {
          method: "GET",
          path_template: "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Storage/storageAccounts/{accountName}/blobServices/default",
          provider_namespace: "Microsoft.Storage",
          versions: {
            "2023-01-01": { is_preview: false, spec_files: ["storage/2023-01-01/blob.json"] },
          },
        },
      },
    },
  },
};

console.log("\n=== Matcher.classify — normalised-placeholder fallback: real shard {vaultName} ===");
{
  // Reproduces the GitHub issue: a GET request to a real KeyVault vault URL
  // was flagged as "Unknown route / route_not_in_shard" because the shard
  // key uses {vaultName} while armPath produces {name}.
  const n = norm(
    "https://management.azure.com/subscriptions/7d8bc1a3-741d-40ab-916f-a209b0507a47/resourceGroups/SpecRecon-Demo-RG/providers/Microsoft.KeyVault/vaults/SpecRecon-Demo-KV?api-version=2024-11-01",
    "GET"
  );
  eq(
    n.armPath,
    "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.KeyVault/vaults/{name}",
    "armPath uses structural {name} (not literal vault name)"
  );

  const r = Matcher.classify(n, REAL_SHARD_FORMAT, { inScope: true });
  eq(r.status, Matcher.STATUS.EXACT_MATCH,
    "exact_match via normalised-placeholder fallback (shard uses {vaultName})");
  eq(r.matched_version, "2024-11-01", "correct api-version matched");
  eq(r.provider_namespace, "Microsoft.KeyVault", "correct provider_namespace");
  // matched_route_key should be the original shard key (not the normalised form)
  eq(
    r.matched_route_key,
    "GET /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.KeyVault/vaults/{vaultName}",
    "matched_route_key is the original shard key with spec-specific param names"
  );
}

console.log("\n=== Matcher.classify — normalised-placeholder fallback: version mismatch ===");
{
  const n = norm(
    "https://management.azure.com/subscriptions/7d8bc1a3-741d-40ab-916f-a209b0507a47/resourceGroups/SpecRecon-Demo-RG/providers/Microsoft.KeyVault/vaults/SpecRecon-Demo-KV?api-version=2099-01-01",
    "GET"
  );
  const r = Matcher.classify(n, REAL_SHARD_FORMAT, { inScope: true });
  eq(r.status, Matcher.STATUS.ROUTE_MISMATCH,
    "route_mismatch when route found via normalised fallback but api-version absent");
  assert(Array.isArray(r.matched_versions) && r.matched_versions.includes("2024-11-01"),
    "matched_versions lists known versions");
}

console.log("\n=== Matcher.classify — normalised-placeholder fallback: multi-level resource names ===");
{
  // Shard key: ...vaults/{vaultName}/keys/{keyName}
  // armPath:   ...vaults/{name}/keys/{name}
  const n = norm(
    "https://management.azure.com/subscriptions/7d8bc1a3-741d-40ab-916f-a209b0507a47/resourceGroups/myRG/providers/Microsoft.KeyVault/vaults/myVault/keys/myKey?api-version=2024-11-01",
    "GET"
  );
  eq(
    n.armPath,
    "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.KeyVault/vaults/{name}/keys/{name}",
    "armPath templates both vault name and key name to {name}"
  );
  const r = Matcher.classify(n, REAL_SHARD_FORMAT, { inScope: true });
  eq(r.status, Matcher.STATUS.EXACT_MATCH,
    "exact_match for multi-level resource names via normalised-placeholder fallback");
}

console.log("\n=== Matcher.classify — normalised-placeholder fallback: 'default' singleton ===");
{
  // Spec key uses {accountName} for the storage account name but 'default' literal
  // for the blobServices singleton.  Both must match correctly.
  const n = norm(
    "https://management.azure.com/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/rg1/providers/Microsoft.Storage/storageAccounts/mystorage/blobServices/default?api-version=2023-01-01",
    "GET"
  );
  assert(n.armPath.includes("blobServices/default"), "armPath preserves 'default' literal");
  const r = Matcher.classify(n, REAL_SHARD_FORMAT, { inScope: true });
  eq(r.status, Matcher.STATUS.EXACT_MATCH,
    "exact_match: 'default' singleton preserved and {accountName}→{name} normalised");
}

console.log("\n=== Matcher.normalisePlaceholders ===");
eq(
  Matcher.normalisePlaceholders("/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.KeyVault/vaults/{vaultName}"),
  "/subscriptions/{name}/resourceGroups/{name}/providers/Microsoft.KeyVault/vaults/{name}",
  "all placeholders replaced with {name}"
);
eq(
  Matcher.normalisePlaceholders("/providers/Microsoft.AAD/operations"),
  "/providers/Microsoft.AAD/operations",
  "path with no placeholders unchanged"
);
eq(
  Matcher.normalisePlaceholders("GET /subscriptions/{subscriptionId}/providers/Microsoft.Foo/things/{thingName}"),
  "GET /subscriptions/{name}/providers/Microsoft.Foo/things/{name}",
  "route key string normalised correctly"
);

// ── canonicaliseRouteKey ──────────────────────────────────────────────────────
//
// Verifies that _canonicaliseRouteKey applies all three normalisations:
//   1. {xxx} placeholder → {name}
//   2. ARM keyword segments lowercased (resourceGroups → resourcegroups, etc.)
//   3. Trailing slash stripped

console.log("\n=== Matcher.canonicaliseRouteKey ===");
eq(
  Matcher.canonicaliseRouteKey(
    "GET /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/"
  ),
  "GET /subscriptions/{name}/resourcegroups/{name}/providers/Microsoft.Resources/deployments",
  "canonical: placeholders + lowercase resourceGroups + trailing slash stripped"
);
eq(
  Matcher.canonicaliseRouteKey(
    "GET /subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/"
  ),
  "GET /subscriptions/{name}/resourcegroups/{name}/providers/Microsoft.Resources/deployments",
  "canonical: already lowercase resourcegroups, trailing slash stripped"
);
eq(
  Matcher.canonicaliseRouteKey(
    "GET /subscriptions/{name}/managementGroups/{name}/providers/Microsoft.Foo/bars/{barName}"
  ),
  "GET /subscriptions/{name}/managementgroups/{name}/providers/Microsoft.Foo/bars/{name}",
  "canonical: managementGroups lowercased, bar placeholder normalised"
);
eq(
  Matcher.canonicaliseRouteKey("GET /providers/Microsoft.AAD/operations"),
  "GET /providers/Microsoft.AAD/operations",
  "canonical: no change for already-clean key"
);

// ── Canonical-key fallback: keyword casing mismatch ──────────────────────────
//
// Reproduces the real-world scenario seen in the issue report where
// GET .../resourceGroups/.../providers/Microsoft.Resources/deployments
// was flagged as "Unknown route / route_not_in_shard" because the shard key
// used lowercase "resourcegroups" while the normaliser emits "resourceGroups".

const LOWERCASE_KEYWORD_SHARD = {
  metadata: { provider_namespace: "Microsoft.Resources" },
  provider_namespace: "Microsoft.Resources",
  hosts: {
    "management.azure.com": {
      routes: {
        // Shard key uses lowercase 'resourcegroups' and has trailing slash
        // (as generated from some azure-rest-api-specs versions)
        "GET /subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/": {
          method: "GET",
          path_template: "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/",
          provider_namespace: "Microsoft.Resources",
          versions: {
            "2022-12-01": { is_preview: false, spec_files: ["resources/2022-12-01/deployments.json"] },
            "2024-11-01": { is_preview: false, spec_files: ["resources/2024-11-01/deployments.json"] },
          },
        },
        // Also verify camelCase version still matches (mixed shards)
        "GET /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Resources/deploymentStacks": {
          method: "GET",
          path_template: "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Resources/deploymentStacks",
          provider_namespace: "Microsoft.Resources",
          versions: {
            "2024-03-01": { is_preview: false, spec_files: ["resources/2024-03-01/deploymentStacks.json"] },
          },
        },
      },
    },
  },
};

console.log("\n=== Matcher.classify — canonical fallback: lowercase 'resourcegroups' in shard ===");
{
  // Real-world failing case from the issue report:
  // Shard key: "GET /subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/"
  // armPath:   "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Resources/deployments"
  // Mismatch: 'resourceGroups' vs 'resourcegroups', plus trailing slash
  const n = norm(
    "https://management.azure.com/subscriptions/7d8bc1a3-741d-40ab-916f-a209b0507a47/resourceGroups/CT-UMAMI-RG/providers/Microsoft.Resources/deployments?api-version=2022-12-01",
    "GET"
  );
  assert(n.armPath.includes("resourceGroups"),         "armPath has camelCase resourceGroups");
  assert(!n.armPath.endsWith("/"),                     "armPath has no trailing slash");

  const r = Matcher.classify(n, LOWERCASE_KEYWORD_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.EXACT_MATCH,
    "exact_match despite shard using lowercase 'resourcegroups' + trailing slash");
  eq(r.matched_version, "2022-12-01", "correct api-version matched");
  eq(r.provider_namespace, "Microsoft.Resources", "correct provider_namespace");
  assert(
    r.matched_route_key ===
    "GET /subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/",
    "matched_route_key is the original shard key (with lowercase + trailing slash preserved)"
  );
}

console.log("\n=== Matcher.classify — canonical fallback: version mismatch with lowercase shard key ===");
{
  const n = norm(
    "https://management.azure.com/subscriptions/7d8bc1a3-741d-40ab-916f-a209b0507a47/resourceGroups/CT-UMAMI-RG/providers/Microsoft.Resources/deployments?api-version=2099-01-01",
    "GET"
  );
  const r = Matcher.classify(n, LOWERCASE_KEYWORD_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.ROUTE_MISMATCH,
    "version_mismatch when route matched via canonical fallback but api-version absent");
  assert(Array.isArray(r.matched_versions) && r.matched_versions.includes("2022-12-01"),
    "matched_versions contains known version");
}

console.log("\n=== Matcher.classify — canonical fallback: camelCase shard key still matches ===");
{
  // camelCase shard keys (the majority) continue to match after canonical normalisation
  const n = norm(
    "https://management.azure.com/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/rg1/providers/Microsoft.Resources/deploymentStacks?api-version=2024-03-01",
    "GET"
  );
  const r = Matcher.classify(n, LOWERCASE_KEYWORD_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.EXACT_MATCH,
    "camelCase shard key still yields exact_match via canonical fallback");
  eq(r.matched_version, "2024-03-01", "correct api-version matched");
}

// ── ARM_ROOT_ROUTE status ─────────────────────────────────────────────────────
//
// Valid ARM root/tenant-scope endpoints on management.azure.com that have no
// provider namespace in the URL must receive ARM_ROOT_ROUTE rather than
// NO_SPEC_MATCH so callers can distinguish them from genuinely unrecognised
// requests.

console.log("\n=== Matcher.STATUS — ARM_ROOT_ROUTE defined ===");
assert(Matcher.STATUS.ARM_ROOT_ROUTE === "arm_root_route", "ARM_ROOT_ROUTE status value is 'arm_root_route'");
assert(typeof Matcher.STATUS_LABELS[Matcher.STATUS.ARM_ROOT_ROUTE] === "string", "ARM_ROOT_ROUTE has a label");

console.log("\n=== Matcher.isArmRootPath ===");
{
  // management.azure.com paths that start at an ARM root keyword
  const mkNorm = (pathname) => ({ host: "management.azure.com", pathname });
  assert(Matcher.isArmRootPath(mkNorm("/subscriptions")),       "/subscriptions is ARM root path");
  assert(Matcher.isArmRootPath(mkNorm("/tenants")),             "/tenants is ARM root path");
  assert(Matcher.isArmRootPath(mkNorm("/providers")),           "/providers is ARM root path");
  assert(Matcher.isArmRootPath(mkNorm("/managementGroups")),    "/managementGroups is ARM root path");
  assert(Matcher.isArmRootPath(mkNorm("/subscriptions/abc/providers")), "/subscriptions/.../providers is ARM root path");

  // Non-management.azure.com host — must return false
  assert(!Matcher.isArmRootPath({ host: "graph.microsoft.com", pathname: "/subscriptions" }),
    "isArmRootPath returns false for non-management.azure.com host");
  assert(!Matcher.isArmRootPath({ host: "login.microsoftonline.com", pathname: "/subscriptions" }),
    "isArmRootPath returns false for login host");

  // Path with provider namespace — not a root-only path (isArmRootPath still
  // returns true because the first segment is still 'subscriptions', which is
  // correct: the caller uses isArmRootPath only when no provider was inferred)
  assert(Matcher.isArmRootPath(mkNorm("/subscriptions/abc/providers/Microsoft.Compute/virtualMachines")),
    "isArmRootPath is first-segment only; provider inference handles the rest");
}

console.log("\n=== Matcher.classify — ARM_ROOT_ROUTE: /subscriptions ===");
{
  const n = norm("https://management.azure.com/subscriptions?api-version=2022-12-01", "GET");
  const r = Matcher.classify(n, null, { inScope: true });
  eq(r.status, Matcher.STATUS.ARM_ROOT_ROUTE, "/subscriptions → arm_root_route");
  eq(r.reason, "arm_root_no_provider", "reason=arm_root_no_provider");
}

console.log("\n=== Matcher.classify — ARM_ROOT_ROUTE: /tenants ===");
{
  const n = norm("https://management.azure.com/tenants?api-version=2022-12-01", "GET");
  const r = Matcher.classify(n, null, { inScope: true });
  eq(r.status, Matcher.STATUS.ARM_ROOT_ROUTE, "/tenants → arm_root_route");
}

console.log("\n=== Matcher.classify — ARM_ROOT_ROUTE: /providers (no namespace) ===");
{
  const n = norm("https://management.azure.com/providers?api-version=2022-12-01", "GET");
  const r = Matcher.classify(n, null, { inScope: true });
  eq(r.status, Matcher.STATUS.ARM_ROOT_ROUTE, "/providers without namespace → arm_root_route");
}

console.log("\n=== Matcher.classify — ARM_ROOT_ROUTE: /subscriptions/{id}/providers ===");
{
  const n = norm(
    "https://management.azure.com/subscriptions/12345678-1234-1234-1234-123456789abc/providers?api-version=2022-12-01",
    "GET"
  );
  // inferProviderNamespace returns null (/providers has no {namespace} after it)
  const r = Matcher.classify(n, null, { inScope: true });
  eq(r.status, Matcher.STATUS.ARM_ROOT_ROUTE, "/subscriptions/{id}/providers → arm_root_route");
}

console.log("\n=== Matcher.classify — NO_SPEC_MATCH still returned for non-ARM root paths ===");
{
  // Non-management host with path starting at 'subscriptions' — not ARM root
  const n = norm("https://api.example.com/subscriptions?api-version=2022-12-01", "GET");
  const r = Matcher.classify(n, null, { inScope: true });
  eq(r.status, Matcher.STATUS.NO_SPEC_MATCH, "non-management host: still no_spec_match (not arm_root_route)");
}

console.log(`\nMatcher: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
