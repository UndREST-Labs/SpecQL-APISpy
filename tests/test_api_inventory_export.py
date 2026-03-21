"""
tests/test_api_inventory_export.py

Unit tests for scripts/export/export_api_inventory.py.
"""

import json
import sys
import tempfile
from pathlib import Path

# Make the export package importable when running from the repo root
_EXPORT_DIR = Path(__file__).parent.parent / "scripts" / "export"
sys.path.insert(0, str(_EXPORT_DIR))

import export_api_inventory as exp


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_spec(directory: Path, filename: str, spec_obj: dict) -> Path:
    """Write a spec dict as JSON into *directory* and return the Path."""
    p = directory / filename
    p.write_text(json.dumps(spec_obj), encoding="utf-8")
    return p


def _minimal_swagger(paths: dict = None, x_ms_paths: dict = None) -> dict:
    """Return a minimal valid Swagger 2.0 document."""
    doc = {
        "swagger": "2.0",
        "info": {"title": "Test API", "version": "2023-01-01"},
        "host": "management.azure.com",
        "paths": paths if paths is not None else {},
    }
    if x_ms_paths is not None:
        doc["x-ms-paths"] = x_ms_paths
    return doc


# ---------------------------------------------------------------------------
# Import test
# ---------------------------------------------------------------------------

class TestImport:
    def test_module_importable(self):
        assert exp is not None

    def test_run_export_callable(self):
        assert callable(exp.run_export)


# ---------------------------------------------------------------------------
# discover_spec_files
# ---------------------------------------------------------------------------

class TestDiscoverSpecFiles:
    def test_finds_json_in_root(self, tmp_path):
        (tmp_path / "spec.json").write_text("{}")
        files = exp.discover_spec_files(tmp_path)
        assert any(f.name == "spec.json" for f in files)

    def test_skips_examples_directory(self, tmp_path):
        examples = tmp_path / "examples"
        examples.mkdir()
        (examples / "example.json").write_text("{}")
        files = exp.discover_spec_files(tmp_path)
        assert not any("examples" in str(f) for f in files)

    def test_skips_non_json_files(self, tmp_path):
        (tmp_path / "readme.md").write_text("# hello")
        files = exp.discover_spec_files(tmp_path)
        assert not any(f.suffix != ".json" for f in files)


# ---------------------------------------------------------------------------
# _parse_spec_file
# ---------------------------------------------------------------------------

class TestParseSpecFile:
    def test_minimal_spec_no_paths(self, tmp_path):
        p = _write_spec(tmp_path, "empty.json", _minimal_swagger())
        ops, err = exp._parse_spec_file(p, tmp_path, verbose=False)
        assert err is None
        assert ops == []

    def test_single_get_operation(self, tmp_path):
        spec = _minimal_swagger(paths={
            "/providers/Microsoft.Storage/storageAccounts/{name}": {
                "get": {
                    "operationId": "StorageAccounts_Get",
                    "tags": ["StorageAccounts"],
                    "parameters": [
                        {"name": "api-version", "in": "query", "required": True},
                        {"name": "name", "in": "path", "required": True},
                    ],
                    "responses": {"200": {"description": "OK"}},
                }
            }
        })
        p = _write_spec(tmp_path, "storage.json", spec)
        ops, err = exp._parse_spec_file(p, tmp_path, verbose=False)
        assert err is None
        assert len(ops) == 1
        op = ops[0]
        assert op["method"] == "GET"
        assert op["operation_id"] == "StorageAccounts_Get"
        assert op["host"] == "management.azure.com"
        assert "lookup_key" in op

    def test_multiple_methods_on_same_path(self, tmp_path):
        path = "/providers/Microsoft.Compute/virtualMachines/{vmName}"
        spec = _minimal_swagger(paths={
            path: {
                "get": {"operationId": "VMs_Get", "responses": {}},
                "delete": {"operationId": "VMs_Delete", "responses": {}},
            }
        })
        p = _write_spec(tmp_path, "compute.json", spec)
        ops, err = exp._parse_spec_file(p, tmp_path, verbose=False)
        assert err is None
        assert len(ops) == 2
        methods = {op["method"] for op in ops}
        assert methods == {"GET", "DELETE"}

    def test_malformed_json_returns_error(self, tmp_path):
        p = tmp_path / "bad.json"
        p.write_text("{ not valid json !!!", encoding="utf-8")
        ops, err = exp._parse_spec_file(p, tmp_path, verbose=False)
        assert ops == []
        assert err is not None

    def test_non_spec_json_skipped_silently(self, tmp_path):
        p = _write_spec(tmp_path, "config.json", {"key": "value"})
        ops, err = exp._parse_spec_file(p, tmp_path, verbose=False)
        assert ops == []
        assert err is None

    def test_x_ms_paths_handled(self, tmp_path):
        spec = _minimal_swagger(
            paths={},
            x_ms_paths={
                "/providers/Microsoft.Network/virtualNetworks/{name}?api-version=2023": {
                    "get": {"operationId": "VNets_Get", "responses": {}}
                }
            },
        )
        p = _write_spec(tmp_path, "network.json", spec)
        ops, err = exp._parse_spec_file(p, tmp_path, verbose=False)
        assert err is None
        assert len(ops) == 1
        assert ops[0]["lookup_key"].startswith("management.azure.com|GET|")

    def test_openapi3_spec_parsed(self, tmp_path):
        spec = {
            "openapi": "3.0.0",
            "info": {"title": "Test", "version": "2023-01-01"},
            "servers": [{"url": "https://management.azure.com"}],
            "paths": {
                "/providers/Microsoft.Example/things/{name}": {
                    "get": {"operationId": "Things_Get", "responses": {}}
                }
            },
        }
        p = _write_spec(tmp_path, "openapi3.json", spec)
        ops, err = exp._parse_spec_file(p, tmp_path, verbose=False)
        assert err is None
        assert len(ops) == 1
        assert ops[0]["host"] == "management.azure.com"


# ---------------------------------------------------------------------------
# Metadata block
# ---------------------------------------------------------------------------

class TestMetadataBlock:
    def test_metadata_fields_present(self, tmp_path):
        source = tmp_path / "spec"
        source.mkdir()
        output = tmp_path / "out"

        # Write a minimal spec so there is something to process
        spec_dir = source / "Microsoft.Test" / "stable" / "2023-01-01"
        spec_dir.mkdir(parents=True)
        _write_spec(spec_dir, "test.json", _minimal_swagger(paths={
            "/providers/Microsoft.Test/things": {
                "get": {"operationId": "Things_List", "responses": {}}
            }
        }))

        rc = exp.run_export(source, output, minified=False, verbose=False)
        assert rc == 0

        index = json.loads((output / "api-index.json").read_text())
        meta = index["metadata"]

        required_keys = {
            "generated_at", "source_repo", "source_branch", "source_commit",
            "export_scope", "tool_name", "tool_component", "schema_version",
        }
        assert required_keys.issubset(meta.keys())
        assert meta["tool_name"] == "SpecRecon"
        assert meta["tool_component"] == "SpeQL"
        assert meta["schema_version"] == "2.1.0"


# ---------------------------------------------------------------------------
# run_export end-to-end
# ---------------------------------------------------------------------------

class TestRunExport:
    def test_missing_source_returns_error(self, tmp_path):
        rc = exp.run_export(tmp_path / "nonexistent", tmp_path / "out", False, False)
        assert rc != 0

    def test_creates_output_directory(self, tmp_path):
        source = tmp_path / "spec"
        source.mkdir()
        output = tmp_path / "inventory"

        exp.run_export(source, output, minified=False, verbose=False)
        assert output.is_dir()

    def test_produces_api_index_json(self, tmp_path):
        source = tmp_path / "spec"
        source.mkdir()
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False)
        assert (output / "api-index.json").exists()

    def test_minified_flag_produces_min_file(self, tmp_path):
        source = tmp_path / "spec"
        source.mkdir()
        output = tmp_path / "out"

        exp.run_export(source, output, minified=True, verbose=False)
        assert (output / "api-index.min.json").exists()

    def test_summary_fields_in_output(self, tmp_path):
        source = tmp_path / "spec"
        source.mkdir()
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False)
        index = json.loads((output / "api-index.json").read_text())

        assert "summary" in index
        summary = index["summary"]
        assert "total_operations" in summary
        assert "total_spec_files" in summary
        assert "errors" in summary

    def test_empty_source_produces_zero_operations(self, tmp_path):
        source = tmp_path / "spec"
        source.mkdir()
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False)
        index = json.loads((output / "api-index.json").read_text())
        assert index["summary"]["total_operations"] == 0

    def test_operation_fields_present(self, tmp_path):
        source = tmp_path / "spec"
        stable_dir = source / "Microsoft.Test" / "stable" / "2023-01-01"
        stable_dir.mkdir(parents=True)
        _write_spec(stable_dir, "test.json", _minimal_swagger(paths={
            "/providers/Microsoft.Test/resources/{name}": {
                "get": {
                    "operationId": "Resources_Get",
                    "tags": ["Resources"],
                    "parameters": [
                        {"name": "api-version", "in": "query", "required": True},
                    ],
                    "responses": {},
                }
            }
        }))
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False)
        index = json.loads((output / "api-index.json").read_text())
        assert index["summary"]["total_operations"] >= 1

        op = index["operations"][0]
        required_fields = {
            "host", "method", "path_template", "operation_id", "api_versions",
            "spec_file", "source_kind", "plane", "is_preview", "lookup_key",
        }
        assert required_fields.issubset(op.keys())


# ---------------------------------------------------------------------------
# Grouped export
# ---------------------------------------------------------------------------

class TestGroupedExport:
    """Tests for the --grouped / grouped=True export mode (schema 3.0.0)."""

    def test_grouped_flag_produces_grouped_file(self, tmp_path):
        source = tmp_path / "spec"
        v_dir = source / "Microsoft.Test" / "stable" / "2023-01-01"
        v_dir.mkdir(parents=True)
        _write_spec(v_dir, "test.json", _minimal_swagger(paths={
            "/providers/Microsoft.Test/things/{name}": {
                "get": {"operationId": "Things_Get", "responses": {}}
            }
        }))
        output = tmp_path / "out"

        rc = exp.run_export(source, output, minified=False, verbose=False, grouped=True)
        assert rc == 0
        assert (output / "api-index-grouped.json").exists()

    def test_grouped_top_level_structure(self, tmp_path):
        source = tmp_path / "spec"
        source.mkdir()
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False, grouped=True)
        index = json.loads((output / "api-index-grouped.json").read_text())

        assert "metadata" in index
        assert "providers" in index
        assert "summary" in index

    def test_grouped_metadata_schema_version(self, tmp_path):
        source = tmp_path / "spec"
        source.mkdir()
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False, grouped=True)
        index = json.loads((output / "api-index-grouped.json").read_text())

        assert index["metadata"]["schema_version"] == "3.0.0"
        assert index["metadata"]["export_format"] == "grouped"

    def test_flat_index_still_produced_with_grouped(self, tmp_path):
        source = tmp_path / "spec"
        source.mkdir()
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False, grouped=True)
        # Both flat and grouped files should exist
        assert (output / "api-index.json").exists()
        assert (output / "api-index-grouped.json").exists()

    def test_grouping_by_provider_host_route(self, tmp_path):
        """Same route in two different API versions → one route entry with two version keys."""
        source = tmp_path / "spec"
        for version in ("2022-01-01", "2023-01-01"):
            v_dir = source / "Microsoft.Storage" / "stable" / version
            v_dir.mkdir(parents=True)
            _write_spec(v_dir, "storage.json", _minimal_swagger(paths={
                "/providers/Microsoft.Storage/storageAccounts/{name}": {
                    "get": {"operationId": "StorageAccounts_Get", "responses": {}}
                }
            }))
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False, grouped=True)
        index = json.loads((output / "api-index-grouped.json").read_text())

        prov = index["providers"]["Microsoft.Storage"]
        host_entry = prov["hosts"]["management.azure.com"]
        route_key = "GET /providers/Microsoft.Storage/storageAccounts/{name}"
        assert route_key in host_entry["routes"]

        route = host_entry["routes"][route_key]
        assert len(route["versions"]) == 2
        assert "2022-01-01" in route["versions"]
        assert "2023-01-01" in route["versions"]

    def test_deduplication_same_route_same_version(self, tmp_path):
        """Parsing one spec file should yield exactly one version entry per route."""
        source = tmp_path / "spec"
        v_dir = source / "Microsoft.Storage" / "stable" / "2023-01-01"
        v_dir.mkdir(parents=True)
        _write_spec(v_dir, "storage.json", _minimal_swagger(paths={
            "/providers/Microsoft.Storage/storageAccounts/{name}": {
                "get": {"operationId": "StorageAccounts_Get", "responses": {}}
            }
        }))
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False, grouped=True)
        index = json.loads((output / "api-index-grouped.json").read_text())

        route = (
            index["providers"]["Microsoft.Storage"]
            ["hosts"]["management.azure.com"]
            ["routes"]["GET /providers/Microsoft.Storage/storageAccounts/{name}"]
        )
        assert len(route["versions"]) == 1

    def test_version_nesting_structure(self, tmp_path):
        """Each version entry must have is_preview, spec_files, operation_ids, source_kinds."""
        source = tmp_path / "spec"
        v_dir = source / "Microsoft.Test" / "stable" / "2023-01-01"
        v_dir.mkdir(parents=True)
        _write_spec(v_dir, "test.json", _minimal_swagger(paths={
            "/providers/Microsoft.Test/things/{name}": {
                "get": {"operationId": "Things_Get", "responses": {}}
            }
        }))
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False, grouped=True)
        index = json.loads((output / "api-index-grouped.json").read_text())

        ver = (
            index["providers"]["Microsoft.Test"]
            ["hosts"]["management.azure.com"]
            ["routes"]["GET /providers/Microsoft.Test/things/{name}"]
            ["versions"]["2023-01-01"]
        )
        assert "is_preview" in ver
        assert "spec_files" in ver
        assert "operation_ids" in ver
        assert "source_kinds" in ver

    def test_route_common_fields(self, tmp_path):
        """Each route entry must have method, path_template, provider_namespace, plane, lookup_key."""
        source = tmp_path / "spec"
        v_dir = source / "Microsoft.Test" / "stable" / "2023-01-01"
        v_dir.mkdir(parents=True)
        _write_spec(v_dir, "test.json", _minimal_swagger(paths={
            "/providers/Microsoft.Test/things/{name}": {
                "get": {"operationId": "Things_Get", "responses": {}}
            }
        }))
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False, grouped=True)
        index = json.loads((output / "api-index-grouped.json").read_text())

        route = (
            index["providers"]["Microsoft.Test"]
            ["hosts"]["management.azure.com"]
            ["routes"]["GET /providers/Microsoft.Test/things/{name}"]
        )
        required = {"method", "path_template", "provider_namespace", "plane", "lookup_key", "versions"}
        assert required.issubset(route.keys())
        assert route["method"] == "GET"
        assert route["provider_namespace"] == "Microsoft.Test"
        assert route["plane"] == "management"

    def test_exact_match_viability_via_lookup_key(self, tmp_path):
        """lookup_key on each route should support host|METHOD|path exact matching."""
        source = tmp_path / "spec"
        v_dir = source / "Microsoft.Test" / "stable" / "2023-01-01"
        v_dir.mkdir(parents=True)
        _write_spec(v_dir, "test.json", _minimal_swagger(paths={
            "/providers/Microsoft.Test/things/{name}": {
                "get": {"operationId": "Things_Get", "responses": {}}
            }
        }))
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False, grouped=True)
        index = json.loads((output / "api-index-grouped.json").read_text())

        route = (
            index["providers"]["Microsoft.Test"]
            ["hosts"]["management.azure.com"]
            ["routes"]["GET /providers/Microsoft.Test/things/{name}"]
        )
        expected_key = "management.azure.com|GET|/providers/Microsoft.Test/things/{name}"
        assert route["lookup_key"] == expected_key

    def test_preview_version_flagged(self, tmp_path):
        """is_preview in the version entry is True for a preview spec."""
        source = tmp_path / "spec"
        prev_dir = source / "Microsoft.Test" / "preview" / "2023-01-01-preview"
        prev_dir.mkdir(parents=True)
        _write_spec(prev_dir, "test.json", _minimal_swagger(paths={
            "/providers/Microsoft.Test/things/{name}": {
                "get": {"operationId": "Things_Get", "responses": {}}
            }
        }))
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False, grouped=True)
        index = json.loads((output / "api-index-grouped.json").read_text())

        ver = (
            index["providers"]["Microsoft.Test"]
            ["hosts"]["management.azure.com"]
            ["routes"]["GET /providers/Microsoft.Test/things/{name}"]
            ["versions"]["2023-01-01-preview"]
        )
        assert ver["is_preview"] is True

    def test_source_kind_captured_in_version(self, tmp_path):
        """source_kinds in the version entry reflects the paths block key."""
        source = tmp_path / "spec"
        v_dir = source / "Microsoft.Test" / "stable" / "2023-01-01"
        v_dir.mkdir(parents=True)
        _write_spec(v_dir, "test.json", _minimal_swagger(paths={
            "/providers/Microsoft.Test/things/{name}": {
                "get": {"operationId": "Things_Get", "responses": {}}
            }
        }))
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False, grouped=True)
        index = json.loads((output / "api-index-grouped.json").read_text())

        ver = (
            index["providers"]["Microsoft.Test"]
            ["hosts"]["management.azure.com"]
            ["routes"]["GET /providers/Microsoft.Test/things/{name}"]
            ["versions"]["2023-01-01"]
        )
        assert "paths" in ver["source_kinds"]

    def test_x_ms_paths_source_kind(self, tmp_path):
        """Routes from x-ms-paths are captured with source_kind 'x-ms-paths'."""
        source = tmp_path / "spec"
        v_dir = source / "Microsoft.Test" / "stable" / "2023-01-01"
        v_dir.mkdir(parents=True)
        _write_spec(v_dir, "test.json", _minimal_swagger(
            paths={},
            x_ms_paths={
                "/providers/Microsoft.Test/things/{name}?api-version=2023-01-01": {
                    "get": {"operationId": "Things_GetExt", "responses": {}}
                }
            },
        ))
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False, grouped=True)
        index = json.loads((output / "api-index-grouped.json").read_text())

        route_key = "GET /providers/Microsoft.Test/things/{name}?api-version=2023-01-01"
        ver = (
            index["providers"]["Microsoft.Test"]
            ["hosts"]["management.azure.com"]
            ["routes"][route_key]
            ["versions"]["2023-01-01"]
        )
        assert "x-ms-paths" in ver["source_kinds"]

    def test_unknown_provider_grouped_under_unknown(self, tmp_path):
        """Routes with no /providers/ segment go under 'unknown' provider namespace."""
        source = tmp_path / "spec"
        v_dir = source / "stable" / "2023-01-01"
        v_dir.mkdir(parents=True)
        spec = {
            "swagger": "2.0",
            "info": {"title": "Test", "version": "2023-01-01"},
            "host": "management.azure.com",
            "paths": {
                "/subscriptions/{sub}/resourceGroups": {
                    "get": {"operationId": "ResourceGroups_List", "responses": {}}
                }
            },
        }
        _write_spec(v_dir, "rg.json", spec)
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False, grouped=True)
        index = json.loads((output / "api-index-grouped.json").read_text())

        assert "unknown" in index["providers"]

    def test_grouped_summary_fields(self, tmp_path):
        """Grouped summary has total_routes, total_versions, providers, planes, errors."""
        source = tmp_path / "spec"
        v_dir = source / "Microsoft.Test" / "stable" / "2023-01-01"
        v_dir.mkdir(parents=True)
        _write_spec(v_dir, "test.json", _minimal_swagger(paths={
            "/providers/Microsoft.Test/things/{name}": {
                "get": {"operationId": "Things_Get", "responses": {}}
            }
        }))
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False, grouped=True)
        index = json.loads((output / "api-index-grouped.json").read_text())

        summary = index["summary"]
        assert "total_routes" in summary
        assert "total_versions" in summary
        assert "total_spec_files" in summary
        assert "providers" in summary
        assert "planes" in summary
        assert "errors" in summary
        assert summary["total_routes"] >= 1
        assert summary["total_versions"] >= 1

    def test_grouped_minified_file_produced(self, tmp_path):
        """--grouped + --minified writes api-index-grouped.min.json."""
        source = tmp_path / "spec"
        source.mkdir()
        output = tmp_path / "out"

        exp.run_export(source, output, minified=True, verbose=False, grouped=True)
        assert (output / "api-index-grouped.min.json").exists()

    def test_no_grouped_file_without_flag(self, tmp_path):
        """Without grouped=True, no grouped file is written."""
        source = tmp_path / "spec"
        source.mkdir()
        output = tmp_path / "out"

        exp.run_export(source, output, minified=False, verbose=False, grouped=False)
        assert not (output / "api-index-grouped.json").exists()
