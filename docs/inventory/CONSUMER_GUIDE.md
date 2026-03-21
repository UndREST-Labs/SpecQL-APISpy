# Consumer Guide — Using the API Inventory Index

This guide is for developers who want to consume `api-index.json` produced by the
SpecRecon export pipeline, for example to build the **APISpy** browser extension
or any other tool that performs "spec vs reality" comparison of Azure REST API calls.

---

## Overview

The `api-index.json` file is a normalized catalogue of every Azure REST API
operation defined in the
[Azure REST API Specifications](https://github.com/Azure/azure-rest-api-specs)
repository.

Each entry in the `operations` array represents one HTTP method + path template
combination and includes metadata such as the provider namespace, API version,
plane (management/data), stability (stable/preview), and a pre-computed lookup
key.

See [API_INDEX_SCHEMA.md](./API_INDEX_SCHEMA.md) for the full field reference.

---

## Questions the Index Can Answer

Given an observed API call (intercepted by a browser extension or proxy), the
index can answer:

| Question | How to answer |
|----------|---------------|
| Is this API call documented in the specs? | Look up the `lookup_key` in the index |
| What operation is this call? | Read `operation_id` from the matching entry |
| Is the call using a preview API version? | Check `is_preview` / `preview_versions` |
| Is there a version mismatch? | Compare the observed `api-version` against `api_versions` |
| Is this operation preview-only? | Check `stable_versions` — if empty, it is preview-only |
| Which Azure service / provider owns this path? | Read `provider_namespace` |
| Is this a management-plane or data-plane call? | Read `plane` |

---

## Matching Algorithm

Given an observed request, follow these steps to find a match in the index:

### Step 1 — Normalize the observed call

```
host        = observed host, lowercased (e.g. "management.azure.com")
method      = observed HTTP method, uppercased (e.g. "GET")
path        = observed URL path, without query string
api_version = extracted from the "api-version" query parameter
```

### Step 2 — Build a candidate lookup key

```
candidate_key = host + "|" + method + "|" + path
```

**Example:**

```
management.azure.com|GET|/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/myRG/providers/Microsoft.Storage/storageAccounts/myaccount
```

### Step 3 — Exact lookup (fast path)

Try an exact match against the `lookup_key` field. This works when the
observed path perfectly matches the spec path template, which is only the case
when the path contains no concrete parameter values.

### Step 4 — Template matching (common case)

Because observed URLs contain concrete values (e.g. a real subscription GUID,
resource group name, account name), you need to replace parameter values with
`{paramName}` placeholders before matching.

The simplest approach is to load all `lookup_key` values that share the same
`host` and `method`, then:

1. Replace each `{...}` placeholder in the spec path template with a regex
   that matches one path segment: `[^/]+`
2. Test the observed path against each compiled regex

```python
import re

def match_operation(host, method, observed_path, operations):
    candidates = [
        op for op in operations
        if op["host"] == host.lower() and op["method"] == method.upper()
    ]
    for op in candidates:
        # re.escape escapes braces too, so replace escaped {param} placeholders with a segment regex
        pattern = re.sub(r"\\{[^}]+\\}", r"[^/]+", re.escape(op["path_template"]))
        if re.fullmatch(pattern, observed_path):
            return op
    return None
```

### Step 5 — Partial / provider-family match (fallback)

If no template match is found, try a broader match based on the provider
namespace and resource family extracted from the observed path:

```python
from scripts.export.normalize_api_inventory import (
    extract_provider_namespace,
    extract_resource_provider_family,
)

provider = extract_provider_namespace(observed_path)
family   = extract_resource_provider_family(observed_path)

related = [
    op for op in operations
    if op["provider_namespace"] == provider
    and op["resource_provider_family"] == family
]
```

This tells you: "The call is to a known Azure provider/resource family, but no
exact operation match was found."

---

## "Spec vs Reality" Comparison

The key insight behind SpecRecon's "spec vs reality" approach:

> **If an observed Azure API call cannot be matched in the index, it is either
> undocumented, using a private API endpoint, or the index is out of date.**

Possible outcomes when matching an observed call:

| Outcome | Meaning |
|---------|---------|
| Exact match, `is_preview: false` | The call is fully documented and stable |
| Exact match, `is_preview: true` | The call is documented but preview-only |
| Template match but version not in `api_versions` | Version mismatch — call uses an undocumented version |
| Provider/family match only | Partial match — possibly a subresource or unlisted path |
| No match | Undocumented call — potential shadow API or private endpoint |

---

## Loading the Index

### JavaScript (browser extension / Node.js)

```javascript
// In a service worker or background script:
const response = await fetch(chrome.runtime.getURL("api-index.min.json"));
const index = await response.json();

// Build a lookup map for fast access by host+method:
const byHostMethod = {};
for (const op of index.operations) {
  const key = `${op.host}|${op.method}`;
  (byHostMethod[key] ??= []).push(op);
}
```

### Python

```python
import json
from pathlib import Path

index = json.loads(Path("inventory/api-index.json").read_text())
operations = index["operations"]

# Index by lookup_key for O(1) exact lookup:
by_key = {op["lookup_key"]: op for op in operations}
```

---

## Versioning and Freshness

- The `metadata.generated_at` field tells you when the index was produced.
- The `metadata.source_commit` field identifies the exact state of the
  Azure REST API specs used.
- Check `metadata.schema_version` before processing; see
  [API_INDEX_SCHEMA.md](./API_INDEX_SCHEMA.md#schema-evolution) for the
  evolution policy.

The index is regenerated daily by the SpecRecon CI workflow. Consumers should
periodically refresh their copy.

---

## Future Enrichment

The export schema is designed to support future enrichment without breaking
changes:

- **CodeQL-backed findings overlay** — SpeQL security findings (SAS URI
  exposure, missing authentication checks, etc.) could be attached to matching
  operations as an additional `findings` array.
- **Deprecation signals** — Azure deprecation notices from the specs could
  populate a `deprecated` field per operation.
- **Cross-version delta** — Comparing two index snapshots can surface new,
  changed, or removed operations between spec versions.
