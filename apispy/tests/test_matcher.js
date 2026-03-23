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
console.log("\n=== Matcher.canonicaliseRouteKey ===");
eq(
  Matcher.canonicaliseRouteKey("GET /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Resources/deployments"),
  "get /subscriptions/{name}/resourcegroups/{name}/providers/microsoft.resources/deployments",
  "canonicaliseRouteKey: placeholders→{name}, lowercase, no trailing slash"
);
eq(
  Matcher.canonicaliseRouteKey("GET /subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/"),
  "get /subscriptions/{name}/resourcegroups/{name}/providers/microsoft.resources/deployments",
  "canonicaliseRouteKey: trailing slash stripped, case-insensitive equality with resourceGroups variant"
);
// Demonstrate that resourceGroups and resourcegroups variants canonicalise to same key
assert(
  Matcher.canonicaliseRouteKey("GET /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Resources/deployments") ===
  Matcher.canonicaliseRouteKey("GET /subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/"),
  "resourceGroups and resourcegroups (+ trailing slash) canonicalise to same key"
);

// ── inferProviderNamespace — casing normalisation ─────────────────────────────
console.log("\n=== Matcher.inferProviderNamespace — casing normalisation ===");
eq(
  Matcher.inferProviderNamespace("//providers/microsoft.management/getEntities"),
  "Microsoft.Management",
  "lowercase 'microsoft.management' normalised to 'Microsoft.Management'"
);
eq(
  Matcher.inferProviderNamespace("/providers/microsoft.insights/metrics"),
  "Microsoft.Insights",
  "lowercase 'microsoft.insights' normalised to 'Microsoft.Insights'"
);
eq(
  Matcher.inferProviderNamespace("/subscriptions/abc/providers/Microsoft.KeyVault/vaults/x"),
  "Microsoft.KeyVault",
  "already-canonical 'Microsoft.KeyVault' unchanged"
);
eq(
  Matcher.inferProviderNamespace("/providers/Microsoft.AAD/operations"),
  "Microsoft.AAD",
  "Microsoft.AAD preserved (only first letter of each segment changed)"
);

// ── inferLastProviderNamespace ────────────────────────────────────────────────
console.log("\n=== Matcher.inferLastProviderNamespace ===");
eq(
  Matcher.inferLastProviderNamespace("/subscriptions/x/resourceGroups/rg/providers/Microsoft.KeyVault/vaults/v/providers/microsoft.Insights/metrics"),
  "Microsoft.Insights",
  "nested provider: last namespace returned and capitalised"
);
eq(
  Matcher.inferLastProviderNamespace("/subscriptions/x/providers/Microsoft.KeyVault/vaults/v"),
  null,
  "single provider: returns null (not an extension resource)"
);
eq(
  Matcher.inferLastProviderNamespace("/providers/Microsoft.Management/managementGroups/mg/providers/Microsoft.Quota/groupQuotas/q"),
  "Microsoft.Quota",
  "management+quota nested path: last = Microsoft.Quota"
);
eq(
  Matcher.inferLastProviderNamespace("/subscriptions/abc"),
  null,
  "no provider: returns null"
);

// ── shard with resourceGroups/resourcegroups case + trailing slash ────────────
// Reproduces Issue 3: spec files sometimes spell the path segment as
// "resourcegroups" (lowercase) and append a trailing slash.
const CASE_TRAILING_SHARD = {
  metadata: { provider_namespace: "Microsoft.Resources" },
  provider_namespace: "Microsoft.Resources",
  hosts: {
    "management.azure.com": {
      routes: {
        // Lowercase resourcegroups + trailing slash — as seen in real spec files
        "GET /subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/": {
          method: "GET",
          path_template: "/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/",
          provider_namespace: "Microsoft.Resources",
          versions: {
            "2022-09-01": { is_preview: false, spec_files: ["resources/2022-09-01/deployments.json"] },
            "2022-12-01": { is_preview: false, spec_files: ["resources/2022-12-01/deployments.json"] },
          },
        },
      },
    },
  },
};

console.log("\n=== Matcher.classify — canonical fallback: resourcegroups case + trailing slash ===");
{
  // The URL uses capitalised /resourceGroups/ (as Azure Portal always does).
  // The shard has lowercase /resourcegroups/ with a trailing slash.
  // Canonical comparison (lowercase + trailing slash strip) bridges the gap.
  const n = norm(
    "https://management.azure.com/subscriptions/7d8bc1a3-741d-40ab-916f-a209b0507a47/resourceGroups/SpecRecon-Demo-RG/providers/Microsoft.Resources/deployments?api-version=2022-12-01",
    "GET"
  );
  eq(
    n.armPath,
    "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Resources/deployments",
    "armPath has resourceGroups (capitalised, no trailing slash)"
  );

  const r = Matcher.classify(n, CASE_TRAILING_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.EXACT_MATCH,
    "exact_match: canonical fallback bridges resourceGroups↔resourcegroups and trailing slash");
  eq(r.matched_version, "2022-12-01", "correct api-version matched");
}

// ── double-slash path normalisation ──────────────────────────────────────────
// Reproduces Issue 2: Azure Portal occasionally emits paths starting with "//".
// The canonical comparison bridges the case difference.
const MGMT_SHARD = {
  metadata: { provider_namespace: "Microsoft.Management" },
  provider_namespace: "Microsoft.Management",
  hosts: {
    "management.azure.com": {
      routes: {
        "POST /providers/Microsoft.Management/getEntities": {
          method: "POST",
          path_template: "/providers/Microsoft.Management/getEntities",
          provider_namespace: "Microsoft.Management",
          versions: {
            "2018-03-01-preview": { is_preview: true, spec_files: ["management/2018-03-01-preview/entities.json"] },
          },
        },
      },
    },
  },
};

console.log("\n=== Normalizer + Matcher — double-slash path collapsed ===");
{
  const n = norm(
    "https://management.azure.com//providers/microsoft.management/getEntities?api-version=2018-03-01-preview",
    "POST"
  );
  eq(n.normalisedPath, "/providers/microsoft.management/getEntities",
    "normalisedPath: double slash collapsed to single slash");
  eq(n.armPath, "/providers/microsoft.management/getEntities",
    "armPath: double slash collapsed");
  eq(Matcher.inferProviderNamespace(n.pathname), "Microsoft.Management",
    "inferProviderNamespace normalises casing from double-slash path");

  const r = Matcher.classify(n, MGMT_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.EXACT_MATCH,
    "exact_match: double-slash normalised, namespace casing resolved via canonical comparison");
  eq(r.matched_version, "2018-03-01-preview", "correct api-version matched");
}

// ── {resourceUri} suffix matching — extension resources ───────────────────────
// Reproduces Issue 1: Insights metrics on a KeyVault resource.
// The Insights shard has GET /{resourceUri}/providers/Microsoft.Insights/metrics.
// panel.js loads this shard as the extension (last provider) shard.
const INSIGHTS_SHARD = {
  metadata: { provider_namespace: "Microsoft.Insights" },
  provider_namespace: "Microsoft.Insights",
  hosts: {
    "management.azure.com": {
      routes: {
        "GET /{resourceUri}/providers/Microsoft.Insights/metrics": {
          method: "GET",
          path_template: "/{resourceUri}/providers/Microsoft.Insights/metrics",
          provider_namespace: "Microsoft.Insights",
          versions: {
            "2019-07-01": { is_preview: false, spec_files: ["insights/2019-07-01/metrics.json"] },
            "2021-05-01": { is_preview: false, spec_files: ["insights/2021-05-01/metrics.json"] },
          },
        },
        "GET /{resourceUri}/providers/Microsoft.Insights/metricDefinitions": {
          method: "GET",
          path_template: "/{resourceUri}/providers/Microsoft.Insights/metricDefinitions",
          provider_namespace: "Microsoft.Insights",
          versions: {
            "2018-01-01": { is_preview: false, spec_files: ["insights/2018-01-01/metricDefinitions.json"] },
          },
        },
      },
    },
  },
};

console.log("\n=== Matcher.classify — {resourceUri} suffix matching: exact match ===");
{
  // Real scenario: Azure Portal navigates to a KeyVault and asks Insights for metrics.
  // armPath: .../providers/Microsoft.KeyVault/vaults/{name}/providers/microsoft.Insights/metrics
  // Matched via suffix /providers/microsoft.Insights/metrics (endsWith).
  const n = norm(
    "https://management.azure.com/subscriptions/7d8bc1a3-741d-40ab-916f-a209b0507a47/resourceGroups/SpecRecon-Demo-RG/providers/Microsoft.KeyVault/vaults/SpecRecon-Demo-KV/providers/microsoft.Insights/metrics?api-version=2019-07-01",
    "GET"
  );
  eq(
    n.armPath,
    "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.KeyVault/vaults/{name}/providers/microsoft.Insights/metrics",
    "armPath preserves nested provider namespace literal (microsoft.Insights, not {name})"
  );
  assert(n.armPath.includes("/providers/microsoft.Insights/metrics"), "nested extension provider namespace is literal in armPath");

  const r = Matcher.classify(n, INSIGHTS_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.EXACT_MATCH,
    "exact_match via {resourceUri} suffix matching");
  eq(r.matched_version, "2019-07-01", "correct api-version matched");
  eq(r.provider_namespace, "Microsoft.Insights", "provider_namespace is Insights shard's namespace");
  eq(r.matched_route_key, "GET /{resourceUri}/providers/Microsoft.Insights/metrics",
    "matched_route_key is the original {resourceUri} shard key");
}

console.log("\n=== Matcher.classify — {resourceUri} suffix matching: version mismatch ===");
{
  const n = norm(
    "https://management.azure.com/subscriptions/7d8bc1a3-741d-40ab-916f-a209b0507a47/resourceGroups/MyRG/providers/Microsoft.KeyVault/vaults/MyVault/providers/microsoft.Insights/metrics?api-version=2099-01-01",
    "GET"
  );
  const r = Matcher.classify(n, INSIGHTS_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.ROUTE_MISMATCH,
    "route found via {resourceUri} suffix but api-version absent → version mismatch");
  assert(Array.isArray(r.matched_versions) && r.matched_versions.includes("2019-07-01"),
    "matched_versions lists spec versions");
}

console.log("\n=== Matcher.classify — {resourceUri}: metricDefinitions via different suffix ===");
{
  const n = norm(
    "https://management.azure.com/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/myVm/providers/microsoft.Insights/metricDefinitions?api-version=2018-01-01",
    "GET"
  );
  const r = Matcher.classify(n, INSIGHTS_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.EXACT_MATCH,
    "exact_match for metricDefinitions via {resourceUri} suffix matching");
  eq(r.matched_route_key, "GET /{resourceUri}/providers/Microsoft.Insights/metricDefinitions",
    "correct {resourceUri} route matched for metricDefinitions");
}

console.log("\n=== Matcher.classify — Pass 3 normalisedPath fallback: eventtypes/management/values ===");
// The ARM templater converts the literal "management" segment to {name} in armPath.
// normalisedPath preserves the literal so its canonical form matches the shard.
{
  const EVENTTYPES_SHARD = {
    metadata: { provider_namespace: "Microsoft.Insights" },
    provider_namespace: "Microsoft.Insights",
    hosts: {
      "management.azure.com": {
        routes: {
          "GET /subscriptions/{subscriptionId}/providers/Microsoft.Insights/eventtypes/management/values": {
            path_template: "/subscriptions/{subscriptionId}/providers/Microsoft.Insights/eventtypes/management/values",
            provider_namespace: "Microsoft.Insights",
            versions: {
              "2015-04-01": { is_preview: false, spec_files: ["insights/2015-04-01/events.json"] },
            },
          },
        },
      },
    },
  };

  const n = norm(
    "https://management.azure.com/subscriptions/7d8bc1a3-741d-40ab-916f-a209b0507a47/providers/microsoft.insights/eventtypes/management/values?api-version=2015-04-01",
    "GET"
  );
  // armPath over-converts "management" to {name}; normalisedPath preserves it
  assert(n.armPath.includes("/{name}/values"),
    "armPath over-converts literal 'management' to {name}");
  assert(n.normalisedPath.includes("/management/values"),
    "normalisedPath preserves literal 'management'");

  const r = Matcher.classify(n, EVENTTYPES_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.EXACT_MATCH,
    "exact_match via normalisedPath canonical fallback");
  eq(r.matched_version, "2015-04-01", "correct api-version matched");
  eq(r.matched_route_key,
    "GET /subscriptions/{subscriptionId}/providers/Microsoft.Insights/eventtypes/management/values",
    "matched original shard route key with literal 'management'");

  // Wrong api-version → version mismatch, not route unknown
  const nBad = norm(
    "https://management.azure.com/subscriptions/7d8bc1a3-741d-40ab-916f-a209b0507a47/providers/microsoft.insights/eventtypes/management/values?api-version=2099-01-01",
    "GET"
  );
  const rBad = Matcher.classify(nBad, EVENTTYPES_SHARD, { inScope: true });
  eq(rBad.status, Matcher.STATUS.ROUTE_MISMATCH,
    "version mismatch (not route_not_in_shard) when api-version absent from spec");
}

console.log("\n=== Matcher.classify — Pass 5 last-provider-suffix: authorization/permissions on resource ===");
// Azure spec uses {resourceProviderNamespace}/{parentResourcePath}/{resourceType}/{resourceName}
// (4 template segments) for the resource ancestry, but the actual request has 3 segments
// (e.g. Microsoft.Logic/workflows/{name}).  Canonical segment-count matching fails;
// the last-provider-suffix index must bridge the gap.
{
  const AUTH_SHARD = {
    metadata: { provider_namespace: "Microsoft.Authorization" },
    provider_namespace: "Microsoft.Authorization",
    hosts: {
      "management.azure.com": {
        routes: {
          // subscription-level permissions (single /providers/)
          "GET /subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Authorization/permissions": {
            path_template: "/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Authorization/permissions",
            provider_namespace: "Microsoft.Authorization",
            versions: {
              "2022-04-01": { is_preview: false, spec_files: ["authorization/2022-04-01/permissions.json"] },
            },
          },
          // resource-level permissions (two /providers/ segments; {parentResourcePath} is multi-segment)
          "GET /subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/{resourceProviderNamespace}/{parentResourcePath}/{resourceType}/{resourceName}/providers/Microsoft.Authorization/permissions": {
            path_template: "/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/{resourceProviderNamespace}/{parentResourcePath}/{resourceType}/{resourceName}/providers/Microsoft.Authorization/permissions",
            provider_namespace: "Microsoft.Authorization",
            versions: {
              "2022-04-01": { is_preview: false, spec_files: ["authorization/2022-04-01/permissions.json"] },
            },
          },
        },
      },
    },
  };

  const n = norm(
    "https://management.azure.com/subscriptions/7d8bc1a3-741d-40ab-916f-a209b0507a47/resourceGroups/rg/providers/Microsoft.Logic/workflows/myWorkflow/providers/microsoft.authorization/permissions?api-version=2022-04-01",
    "GET"
  );

  const r = Matcher.classify(n, AUTH_SHARD, { inScope: true });
  eq(r.status, Matcher.STATUS.EXACT_MATCH,
    "exact_match via Pass 5 last-provider-suffix (resource-level permissions)");
  eq(r.matched_version, "2022-04-01", "correct api-version matched");
  assert(
    r.matched_route_key.includes("{resourceProviderNamespace}"),
    "matched the resource-level route with multi-segment placeholder ancestry"
  );

  // Version mismatch on resource-level permissions
  const nBad = norm(
    "https://management.azure.com/subscriptions/7d8bc1a3-741d-40ab-916f-a209b0507a47/resourceGroups/rg/providers/Microsoft.Logic/workflows/myWorkflow/providers/microsoft.authorization/permissions?api-version=2099-01-01",
    "GET"
  );
  const rBad = Matcher.classify(nBad, AUTH_SHARD, { inScope: true });
  eq(rBad.status, Matcher.STATUS.ROUTE_MISMATCH,
    "version mismatch (not route_not_in_shard) when api-version absent from spec");
}

console.log(`\nMatcher: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
