# API Index Schema Reference

This document describes every field in the `api-index.json` file produced by
`scripts/export/export_api_inventory.py`.

---

## Top-Level Structure

```json
{
  "metadata": { ... },
  "operations": [ ... ],
  "summary": { ... }
}
```

| Field        | Type   | Description                                    |
|--------------|--------|------------------------------------------------|
| `metadata`   | object | Provenance and version information             |
| `operations` | array  | One entry per API operation found in the specs |
| `summary`    | object | Aggregate statistics for the export run        |

---

## `metadata` Block

```json
{
  "generated_at": "2026-03-21T04:00:00Z",
  "source_repo": "Azure/azure-rest-api-specs",
  "source_branch": "main",
  "source_commit": "a1b2c3d4e5f6...",
  "export_scope": "specification",
  "tool_name": "SpecRecon",
  "tool_component": "SpeQL",
  "schema_version": "2.0.0"
}
```

| Field            | Type   | Description                                                                  |
|------------------|--------|------------------------------------------------------------------------------|
| `generated_at`   | string | ISO 8601 UTC timestamp of when the export was produced                       |
| `source_repo`    | string | The upstream Azure REST API specs repository (`Azure/azure-rest-api-specs`)  |
| `source_branch`  | string | The branch used (always `main` for the daily export)                         |
| `source_commit`  | string | Git commit SHA of the specs checkout, or `"unknown"` if unavailable          |
| `export_scope`   | string | The directory name passed as `--source` (typically `"specification"`)        |
| `tool_name`      | string | Always `"SpecRecon"`                                                         |
| `tool_component` | string | Always `"SpeQL"`                                                             |
| `schema_version` | string | Schema version (`"2.0.0"`); increment when breaking changes are introduced   |

---

## `operations` Array — Entry Fields

Each element in the `operations` array represents one HTTP operation (method + path)
found in a spec file.

```json
{
  "host": "management.azure.com",
  "method": "GET",
  "path_template": "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Storage/storageAccounts/{accountName}",
  "operation_id": "StorageAccounts_GetProperties",
  "api_versions": ["2023-01-01"],
  "spec_file": "specification/storage/resource-manager/Microsoft.Storage/stable/2023-01-01/storage.json",
  "plane": "management",
  "is_preview": false,
  "lookup_key": "management.azure.com|GET|/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Storage/storageAccounts/{accountName}"
}
```

### Field Reference

| Field             | Type    | Description |
|-------------------|---------|-------------|
| `host`            | string  | Hostname from the spec (lowercased). E.g. `"management.azure.com"`, `"myvault.vault.azure.net"`, or `"unknown"`. |
| `method`          | string  | HTTP method in uppercase: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, `TRACE`. |
| `path_template`   | string  | Canonical URL path template from the spec, including path parameter placeholders like `{subscriptionId}`. |
| `operation_id`    | string  | `operationId` from the spec, or `""` when not present. |
| `api_versions`    | array   | All API version strings associated with this operation (derived from the file path). |
| `spec_file`       | string  | Relative path to the source spec file within the repository, using forward slashes. |
| `plane`           | string  | Control plane classification: `"management"`, `"data"`, or `"unknown"`. |
| `is_preview`      | boolean | `true` when the operation is from a preview spec or has a preview API version. |
| `lookup_key`      | string  | Pre-computed normalized key: `"<host>|<METHOD>|<path_template>"`. Designed for fast runtime matching in browser extensions. |

> **Derivable fields (not stored):** `provider_namespace` and `resource_provider_family`
> can be extracted from `path_template` using the pattern
> `/providers/(<Namespace>)/(<ResourceType>)/…`.
> `stable_versions` and `preview_versions` can be split from `api_versions` using `is_preview`.

### Classification Rules

**`plane` classification (in priority order):**
1. Host is `management.azure.com` or `management.core.windows.net` → `"management"`
2. Host ends with a known data-plane suffix (`.blob.core.windows.net`, `.vault.azure.net`, etc.) → `"data"`
3. Path contains `/providers/` or `/subscriptions/` → `"management"`
4. Otherwise → `"unknown"`

**`is_preview` / stability classification:**
1. If the spec file path contains a `preview/` directory component → preview
2. If the spec file path contains a `stable/` directory component → stable
3. If the API version string contains `preview` (case-insensitive) → preview
4. If the API version string is a bare `YYYY-MM-DD` date → stable
5. Otherwise → `"unknown"`

---

## `summary` Block

```json
{
  "total_operations": 12345,
  "total_spec_files": 678,
  "providers": ["Microsoft.Compute", "Microsoft.Network", "Microsoft.Storage"],
  "planes": {
    "management": 10000,
    "data": 2000,
    "unknown": 345
  },
  "errors": 0
}
```

| Field              | Type    | Description                                                              |
|--------------------|---------|--------------------------------------------------------------------------|
| `total_operations` | integer | Total number of operation entries in the `operations` array              |
| `total_spec_files` | integer | Number of JSON files inspected during the export run                     |
| `providers`        | array   | Sorted list of distinct provider namespaces found (excludes `"unknown"`) |
| `planes`           | object  | Count of operations per plane: `management`, `data`, `unknown`           |
| `errors`           | integer | Number of files that could not be parsed (skipped with a warning)        |

---

## Minified Format (`api-index.min.json`)

The minified file contains identical data to `api-index.json` but is serialized
without indentation or unnecessary whitespace:

```json
{"metadata":{...},"operations":[{...}],"summary":{...}}
```

This is the preferred format for runtime consumers (browser extensions, scripts)
where file size matters.

---

## Schema Evolution

The `schema_version` field in `metadata` follows [Semantic Versioning](https://semver.org/):

- **Patch** bumps (`2.0.x`): bug fixes, documentation changes
- **Minor** bumps (`2.x.0`): new fields added (backwards-compatible)
- **Major** bumps (`x.0.0`): fields removed or renamed (breaking changes)

Consumers should check `schema_version` before processing the index.

### Changelog

| Version | Changes |
|---------|---------|
| `2.0.0` | **Breaking**: removed `provider_namespace`, `resource_provider_family`, `stable_versions`, `preview_versions`, `source_kind`, `tags`, `parameter_names`, `required_query_parameters`, and `has_api_version_parameter` from each operation entry. `lookup_key` is retained for fast browser-extension matching. Retained fields are sufficient for an MVP runtime consumer. |
| `1.0.0` | Initial schema release. |
