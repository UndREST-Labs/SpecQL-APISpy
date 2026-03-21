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

console.log(`\nNormalizer: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
