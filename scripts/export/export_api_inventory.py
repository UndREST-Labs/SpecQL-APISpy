#!/usr/bin/env python3
"""
export_api_inventory.py — SpecRecon API Inventory Export

Walks the azure-rest-api-specs/specification/ directory tree, parses every
OpenAPI/Swagger JSON spec file, and produces a normalized api-index.json that
can later be used for "spec vs reality" comparison of Azure REST API calls.

Usage:
    python3 scripts/export/export_api_inventory.py [options]

Options:
    --source      Path to the specifications directory (default: azure-rest-api-specs/specification)
    --output-dir  Directory where the output files are written (default: inventory/)
    --minified    Also produce a minified api-index.min.json (no indentation)
    --verbose     Print per-file progress messages
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# Allow running as a standalone script or as a package member
_HERE = Path(__file__).parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from normalize_api_inventory import (
    classify_plane,
    classify_stability,
    detect_source_kind,
    extract_api_version_from_path,
    extract_provider_namespace,
    extract_resource_provider_family,
    generate_lookup_key,
    is_preview_version,
    normalize_method,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TOOL_NAME = "SpecRecon"
TOOL_COMPONENT = "SpeQL"
SCHEMA_VERSION = "1.0.0"
SOURCE_REPO = "Azure/azure-rest-api-specs"
SOURCE_BRANCH = "main"

# Directories whose contents should be skipped entirely
_SKIP_DIRS = {
    "examples",
    "example",
    "quickstart-templates",
    "tests",
    "test",
    "mock",
    "mocks",
    "samples",
    "sample",
    "scenarios",
    "scenario",
    "restler",
    "node_modules",
}


# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------

def _get_git_commit(repo_path: Path) -> str:
    """Try to retrieve the HEAD commit SHA from *repo_path*."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(repo_path),
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return "unknown"


# ---------------------------------------------------------------------------
# Spec-file discovery
# ---------------------------------------------------------------------------

def _should_skip_dir(dir_name: str) -> bool:
    """Return True when a directory should be excluded from traversal."""
    return dir_name.lower() in _SKIP_DIRS


def discover_spec_files(source_dir: Path) -> list:
    """Yield all JSON spec files under *source_dir*, skipping skip-listed dirs."""
    spec_files = []
    for root, dirs, files in os.walk(source_dir):
        # Prune directories in-place so os.walk doesn't descend into them
        dirs[:] = [d for d in dirs if not _should_skip_dir(d)]
        for fname in files:
            if fname.endswith(".json"):
                spec_files.append(Path(root) / fname)
    return spec_files


# ---------------------------------------------------------------------------
# Parameter extraction helpers
# ---------------------------------------------------------------------------

def _extract_parameter_info(parameters: list) -> dict:
    """Return a dict with parameter analysis for a list of parameter objects."""
    names = []
    required_query = []
    has_api_version = False

    for param in parameters:
        if not isinstance(param, dict):
            continue
        # Parameters may be $ref objects; skip them conservatively
        if "$ref" in param:
            continue
        name = param.get("name", "")
        location = param.get("in", "")
        required = param.get("required", False)

        if name:
            names.append(name)

        if name.lower() == "api-version":
            has_api_version = True

        if location == "query" and required:
            required_query.append(name)

    return {
        "parameter_names": names,
        "required_query_parameters": required_query,
        "has_api_version_parameter": has_api_version,
    }


# ---------------------------------------------------------------------------
# Spec-file parsing
# ---------------------------------------------------------------------------

def _detect_host(spec: dict, file_path: Path) -> str:
    """Extract the host from a Swagger 2.0 or OpenAPI 3.x spec."""
    # Swagger 2.0
    host = spec.get("host", "")
    if host:
        return host.lower()

    # OpenAPI 3.x — take the first server URL's host
    servers = spec.get("servers", [])
    if servers and isinstance(servers, list):
        first_url = servers[0].get("url", "") if isinstance(servers[0], dict) else ""
        if first_url:
            # Strip scheme and path to get just the host
            stripped = first_url.split("//", 1)[-1].split("/")[0]
            return stripped.lower()

    return "unknown"


def _parse_spec_file(file_path: Path, source_dir: Path, verbose: bool) -> tuple:
    """Parse a single spec file and return (list_of_operations, error_or_None).

    Each operation is a dict matching the api-index.json schema.
    """
    rel_path = file_path.relative_to(source_dir.parent) if source_dir.parent in file_path.parents else file_path

    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as fh:
            spec = json.load(fh)
    except json.JSONDecodeError as exc:
        return [], f"JSON decode error in {file_path}: {exc}"
    except OSError as exc:
        return [], f"Cannot read {file_path}: {exc}"

    if not isinstance(spec, dict):
        return [], None  # Not a spec object — skip silently

    # Accept Swagger 2.0 and OpenAPI 3.x
    is_swagger2 = str(spec.get("swagger", "")).startswith("2")
    is_openapi3 = str(spec.get("openapi", "")).startswith("3")
    if not is_swagger2 and not is_openapi3:
        return [], None  # Not a recognized OpenAPI spec — skip

    host = _detect_host(spec, file_path)
    api_version_from_path = extract_api_version_from_path(str(file_path))
    api_version_from_info = spec.get("info", {}).get("version", "")
    api_version = api_version_from_path if api_version_from_path != "unknown" else api_version_from_info

    # Path-level parameters (merged into operation-level ones later)
    paths_blocks = {
        "paths": spec.get("paths", {}),
        "x-ms-paths": spec.get("x-ms-paths", {}),
    }

    operations = []

    for block_key, paths_obj in paths_blocks.items():
        if not isinstance(paths_obj, dict):
            continue
        source_kind = detect_source_kind(block_key)

        for path_template, path_item in paths_obj.items():
            if not isinstance(path_item, dict):
                continue

            path_level_params = path_item.get("parameters", [])

            http_methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"]
            for method_lower in http_methods:
                operation = path_item.get(method_lower)
                if not isinstance(operation, dict):
                    continue

                method = normalize_method(method_lower)

                # Merge path-level and operation-level parameters
                op_params = operation.get("parameters", [])
                all_params = path_level_params + op_params
                param_info = _extract_parameter_info(all_params)

                operation_id = operation.get("operationId", "")
                tags = operation.get("tags", [])

                provider_namespace = extract_provider_namespace(path_template)
                resource_provider_family = extract_resource_provider_family(path_template)
                plane = classify_plane(host, path_template)
                stability = classify_stability(str(file_path), api_version)
                preview = is_preview_version(api_version) or stability == "preview"
                lookup_key = generate_lookup_key(host, method, path_template)

                stable_versions = [] if preview else ([api_version] if api_version and api_version != "unknown" else [])
                preview_versions = [api_version] if preview and api_version and api_version != "unknown" else []
                all_versions = [api_version] if api_version and api_version != "unknown" else []

                entry = {
                    "host": host,
                    "method": method,
                    "path_template": path_template,
                    "provider_namespace": provider_namespace,
                    "resource_provider_family": resource_provider_family,
                    "operation_id": operation_id,
                    "api_versions": all_versions,
                    "stable_versions": stable_versions,
                    "preview_versions": preview_versions,
                    "spec_file": str(rel_path).replace("\\", "/"),
                    "source_kind": source_kind,
                    "plane": plane,
                    "is_preview": preview,
                    "tags": tags,
                    "parameter_names": param_info["parameter_names"],
                    "required_query_parameters": param_info["required_query_parameters"],
                    "has_api_version_parameter": param_info["has_api_version_parameter"],
                    "lookup_key": lookup_key,
                }
                operations.append(entry)

    if verbose and operations:
        print(f"  [{len(operations):4d} ops] {rel_path}")

    return operations, None


# ---------------------------------------------------------------------------
# Summary helpers
# ---------------------------------------------------------------------------

def _build_summary(operations: list, spec_file_count: int, error_count: int) -> dict:
    providers = sorted({op["provider_namespace"] for op in operations if op["provider_namespace"] != "unknown"})
    planes: dict = {}
    for op in operations:
        planes[op["plane"]] = planes.get(op["plane"], 0) + 1

    return {
        "total_operations": len(operations),
        "total_spec_files": spec_file_count,
        "providers": providers,
        "planes": planes,
        "errors": error_count,
    }


# ---------------------------------------------------------------------------
# Main export logic
# ---------------------------------------------------------------------------

def run_export(source_dir: Path, output_dir: Path, minified: bool, verbose: bool) -> int:
    """Execute the full export pipeline.  Returns an exit code (0 = success)."""

    print(f"[SpecRecon] Starting API inventory export")
    print(f"[SpecRecon] Source : {source_dir}")
    print(f"[SpecRecon] Output : {output_dir}")

    if not source_dir.is_dir():
        print(f"[ERROR] Source directory not found: {source_dir}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)

    # Metadata
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    source_commit = _get_git_commit(source_dir.parent if source_dir.parent.is_dir() else source_dir)

    metadata = {
        "generated_at": generated_at,
        "source_repo": SOURCE_REPO,
        "source_branch": SOURCE_BRANCH,
        "source_commit": source_commit,
        "export_scope": source_dir.name,
        "tool_name": TOOL_NAME,
        "tool_component": TOOL_COMPONENT,
        "schema_version": SCHEMA_VERSION,
    }

    # Discover spec files
    print(f"[SpecRecon] Scanning spec files …")
    spec_files = discover_spec_files(source_dir)
    print(f"[SpecRecon] Found {len(spec_files)} JSON files to inspect")

    all_operations = []
    errors = []

    for i, spec_file in enumerate(spec_files, start=1):
        if verbose:
            print(f"[{i}/{len(spec_files)}] {spec_file.name}", end="  ")
        ops, err = _parse_spec_file(spec_file, source_dir, verbose)
        if err:
            errors.append(err)
            if verbose:
                print(f"[WARN] {err}")
            else:
                print(f"[WARN] {err}", file=sys.stderr)
        all_operations.extend(ops)

    summary = _build_summary(all_operations, len(spec_files), len(errors))

    payload = {
        "metadata": metadata,
        "operations": all_operations,
        "summary": summary,
    }

    # Write full JSON
    full_path = output_dir / "api-index.json"
    with open(full_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
    print(f"[SpecRecon] Written: {full_path}")

    # Write minified JSON (optional)
    if minified:
        min_path = output_dir / "api-index.min.json"
        with open(min_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False)
        print(f"[SpecRecon] Written: {min_path}")

    # Print summary
    print()
    print("=" * 60)
    print(f"  SpecRecon API Inventory Export — Summary")
    print("=" * 60)
    print(f"  Spec files processed : {summary['total_spec_files']}")
    print(f"  Operations indexed   : {summary['total_operations']}")
    print(f"  Providers found      : {len(summary['providers'])}")
    print(f"  Plane breakdown      : {summary['planes']}")
    print(f"  Errors / skipped     : {summary['errors']}")
    print("=" * 60)

    return 0


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Export a normalized API inventory from Azure REST API specs.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--source",
        default="azure-rest-api-specs/specification",
        help="Path to the specifications directory (default: azure-rest-api-specs/specification)",
    )
    parser.add_argument(
        "--output-dir",
        default="inventory/",
        help="Directory to write the output files (default: inventory/)",
    )
    parser.add_argument(
        "--minified",
        action="store_true",
        help="Also produce a minified api-index.min.json",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print per-file progress messages",
    )
    return parser


def main():
    parser = _build_parser()
    args = parser.parse_args()

    source_dir = Path(args.source).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    sys.exit(run_export(source_dir, output_dir, args.minified, args.verbose))


if __name__ == "__main__":
    main()
