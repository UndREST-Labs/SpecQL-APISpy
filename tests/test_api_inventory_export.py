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
        assert op["has_api_version_parameter"] is True
        assert "api-version" in op["required_query_parameters"]

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
        assert ops[0]["source_kind"] == "x-ms-paths"

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
        assert meta["schema_version"] == "2.0.0"


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
            "spec_file", "source_kind", "plane", "is_preview", "tags",
            "parameter_names", "required_query_parameters", "has_api_version_parameter",
        }
        assert required_fields.issubset(op.keys())
