// tests/test_normalizer.js — unit tests for lib/normalizer.js

"use strict";

const { URL } = require("url");
if (typeof global.URL === "undefined") global.URL = URL;

const mockExports = {};
eval(require("fs").readFileSync(__dirname + "/../extension/lib/normalizer.js", "utf8")
  .replace('typeof window !== "undefined" ? window : exports', 'mockExports'));
const { Normalizer } = mockExports;

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

console.log("\n=== Normalizer.normalise — basic ===");
{
  const r = Normalizer.normalise(
    "https://management.azure.com/subscriptions/abc123/resourceGroups/myRg/providers/Microsoft.Storage/storageAccounts/myAcct?api-version=2023-01-01",
    "get"
  );
  assert(r.ok === true,              "ok=true for valid URL");
  eq(r.method, "GET",                "method uppercased");
  eq(r.host, "management.azure.com", "host lowercased");
  eq(r.apiVersion, "2023-01-01",     "api-version extracted");
  assert(r.normalisedPath.includes("/subscriptions/"), "path contains /subscriptions/");
}

console.log("\n=== Normalizer.normalise — GUID replacement ===");
{
  const r = Normalizer.normalise(
    "https://management.azure.com/subscriptions/12345678-1234-1234-1234-123456789abc?api-version=2023-01-01",
    "GET"
  );
  assert(r.ok === true,         "ok=true");
  assert(r.normalisedPath.includes("{guid}"), "GUID replaced with {guid}");
}

console.log("\n=== Normalizer.normalise — numeric ID replacement ===");
{
  const r = Normalizer.normalise(
    "https://management.azure.com/subscriptions/99999?api-version=2023-01-01",
    "GET"
  );
  assert(r.normalisedPath.includes("{id}"), "numeric segment replaced with {id}");
}

console.log("\n=== Normalizer.normalise — trailing slash stripped ===");
{
  const r = Normalizer.normalise("https://management.azure.com/subscriptions/", "GET");
  assert(!r.normalisedPath.endsWith("/") || r.normalisedPath === "/",
    "trailing slash stripped");
}

console.log("\n=== Normalizer.normalise — missing api-version ===");
{
  const r = Normalizer.normalise("https://management.azure.com/subscriptions", "GET");
  assert(r.ok === true,          "ok=true");
  eq(r.apiVersion, null,         "apiVersion=null when absent");
}

console.log("\n=== Normalizer.normalise — invalid URL ===");
{
  const r = Normalizer.normalise("not a url", "GET");
  assert(r.ok === false,         "ok=false for invalid URL");
  assert(typeof r.error === "string", "error string present");
}

console.log("\n=== Normalizer.normalisePath — standalone ===");
eq(Normalizer.normalisePath("/a/b/c"), "/a/b/c", "clean path unchanged");
eq(Normalizer.normalisePath("/a/b/c/"), "/a/b/c", "trailing slash removed");
eq(Normalizer.normalisePath("/"), "/", "root preserved");

// ── Azure ARM structural templating ──────────────────────────────────────────

console.log("\n=== Normalizer.templateAzureArmPath — representative ARM paths ===");
{
  // Example 1: KeyVault — literal vault name → {name}
  eq(
    Normalizer.templateAzureArmPath(
      "/subscriptions/{guid}/resourceGroups/rg-prod/providers/Microsoft.KeyVault/vaults/myvault"
    ),
    "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.KeyVault/vaults/{name}",
    "KeyVault vault name templated to {name}"
  );

  // Example 2: Web — site name and slot name → {name}
  eq(
    Normalizer.templateAzureArmPath(
      "/subscriptions/{guid}/resourceGroups/rg1/providers/Microsoft.Web/sites/site1/slots/staging"
    ),
    "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Web/sites/{name}/slots/{name}",
    "Web app and slot names templated to {name}"
  );

  // Example 3: operations — literal type collection preserved
  eq(
    Normalizer.templateAzureArmPath("/providers/Microsoft.Authorization/operations"),
    "/providers/Microsoft.Authorization/operations",
    "operations collection preserved as literal type segment"
  );

  // Example 4: resource collection — literal trailing type preserved
  eq(
    Normalizer.templateAzureArmPath(
      "/subscriptions/{guid}/providers/Microsoft.ResourceGraph/resources"
    ),
    "/subscriptions/{subscriptionId}/providers/Microsoft.ResourceGraph/resources",
    "resource collection preserved as literal type segment"
  );

  // Example 5: Storage — default singleton preserved, other names → {name}
  eq(
    Normalizer.templateAzureArmPath(
      "/subscriptions/{guid}/resourceGroups/rg1/providers/Microsoft.Storage/storageAccounts/mystorage/blobServices/default/containers/logs"
    ),
    "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Storage/storageAccounts/{name}/blobServices/default/containers/{name}",
    "Storage: 'default' singleton preserved, other resource names templated"
  );

  // No-provider path: scope rules only
  eq(
    Normalizer.templateAzureArmPath("/subscriptions/{guid}/resourceGroups/my-rg"),
    "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}",
    "scope-only path: subscription and resourceGroup templated"
  );

  // Tenant scope
  eq(
    Normalizer.templateAzureArmPath("/tenants/some-tenant-id/providers/Microsoft.AAD/domainServices/myds"),
    "/tenants/{tenantId}/providers/Microsoft.AAD/domainServices/{name}",
    "tenant scope and resource name templated"
  );

  // Path with no ARM structure — unchanged
  eq(
    Normalizer.templateAzureArmPath("/healthz"),
    "/healthz",
    "non-ARM path returned unchanged"
  );

  // Allowlist: listKeys in name position stays literal
  eq(
    Normalizer.templateAzureArmPath(
      "/subscriptions/{guid}/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/myacct/listKeys"
    ),
    "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Storage/storageAccounts/{name}/listKeys",
    "listKeys action preserved as literal in name position"
  );
}

console.log("\n=== Normalizer.isLiteralArmSegment ===");
assert(Normalizer.isLiteralArmSegment("default"),   "default is a literal segment");
assert(Normalizer.isLiteralArmSegment("listKeys"),  "listKeys is a literal segment");
assert(Normalizer.isLiteralArmSegment("start"),     "start is a literal segment");
assert(Normalizer.isLiteralArmSegment("operations"),"operations is a literal segment");
assert(!Normalizer.isLiteralArmSegment("myvault"),  "myvault is NOT a literal segment");
assert(!Normalizer.isLiteralArmSegment("site1"),    "site1 is NOT a literal segment");
assert(!Normalizer.isLiteralArmSegment(""),         "empty string is NOT a literal segment");

console.log("\n=== Normalizer.normalise — armPath field ===");
{
  const r = Normalizer.normalise(
    "https://management.azure.com/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/rg-prod/providers/Microsoft.KeyVault/vaults/myvault?api-version=2023-01-01",
    "GET"
  );
  assert(r.ok === true,                      "ok=true");
  assert(typeof r.armPath === "string",      "armPath field is a string");
  eq(
    r.armPath,
    "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.KeyVault/vaults/{name}",
    "armPath has ARM semantic placeholders"
  );
  assert(r.normalisedPath.includes("{guid}"),         "normalisedPath retains {guid} from generic stage");
  assert(!r.normalisedPath.includes("{subscriptionId}"), "normalisedPath does NOT have {subscriptionId}");
  assert(r.armPath.includes("{subscriptionId}"),      "armPath has {subscriptionId}");
  assert(r.armPath.includes("{resourceGroupName}"),   "armPath has {resourceGroupName}");
  assert(r.armPath.includes("{name}"),                "armPath has {name} for vault name");
}

{
  // armPath equals normalisedPath when no ARM-specific segments are present
  const r = Normalizer.normalise("https://management.azure.com/healthz", "GET");
  assert(r.ok === true, "ok=true for non-ARM path");
  eq(r.armPath, r.normalisedPath, "armPath equals normalisedPath for non-ARM path");
}

console.log(`\nNormalizer: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
