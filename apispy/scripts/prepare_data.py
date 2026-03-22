#!/usr/bin/env python3
"""
prepare_data.py — Populate apispy/extension/data/ from the SpecRecon inventory zip.

Usage
─────
  python3 apispy/scripts/prepare_data.py [--zip PATH] [--out DIR] [--size-limit KB]

Options
  --zip PATH        Path to the sharded inventory zip
                    (default: auto-detected from inventory/)
  --out DIR         Output directory for data/shards/
                    (default: apispy/extension/data/)
  --size-limit KB   Only bundle shards up to this size in KB
                    (default: no limit — all shards are included)

This script is intended to be run from the repository root.
It does NOT modify any existing SpecRecon export code.
"""

import argparse
import glob
import json
import os
import sys
import zipfile
from typing import List, Optional, Tuple

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_OUT = os.path.join(REPO_ROOT, "apispy", "extension", "data")


def find_sharded_zip(inventory_dir: str) -> str:
    """Auto-detect the most recent sharded zip in inventory/."""
    pattern = os.path.join(inventory_dir, "api-index-sharded-*.zip")
    candidates = sorted(glob.glob(pattern), reverse=True)
    if not candidates:
        raise FileNotFoundError(
            "No api-index-sharded-*.zip found in " + inventory_dir
            + ". Run scripts/export/export_api_inventory.py --sharded first."
        )
    return candidates[0]


def extract_shards(zip_path: str, out_dir: str, size_limit: Optional[int]) -> Tuple[List, List]:
    """
    Extract .min.json shards from the zip into out_dir/shards/.

    Returns (bundled, skipped) — lists of dicts describing each shard.
    """
    shards_dir = os.path.join(out_dir, "shards")
    os.makedirs(shards_dir, exist_ok=True)

    bundled = []
    skipped = []

    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            name = info.filename
            if not (name.startswith("shards/") and name.endswith(".min.json")):
                continue

            basename = os.path.basename(name)

            if size_limit is not None and info.file_size > size_limit:
                skipped.append({"filename": basename, "size_bytes": info.file_size})
                continue

            # Read + parse
            raw = zf.read(name)
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError as exc:
                print(f"  ⚠️  Skipping {basename}: JSON parse error: {exc}", file=sys.stderr)
                skipped.append({"filename": basename, "size_bytes": info.file_size, "error": str(exc)})
                continue

            provider_ns = parsed.get("provider_namespace", "")
            hosts = list(parsed.get("hosts", {}).keys())
            route_count = sum(
                len(h.get("routes", {})) for h in parsed.get("hosts", {}).values()
            )

            out_path = os.path.join(shards_dir, basename)
            with open(out_path, "wb") as fout:
                fout.write(raw)

            bundled.append(
                {
                    "filename": basename,
                    "provider_namespace": provider_ns,
                    "hosts": hosts,
                    "route_count": route_count,
                    "size_bytes": info.file_size,
                }
            )

    return bundled, skipped


def write_manifest(out_dir: str, bundled: list, skipped: list, zip_path: str) -> None:
    """Write data/manifest.json describing all bundled shards."""
    # Try to read source metadata from any bundled shard
    source_meta: dict = {}
    if bundled:
        sample_path = os.path.join(out_dir, "shards", bundled[0]["filename"])
        try:
            with open(sample_path) as f:
                sample = json.load(f)
            source_meta = sample.get("metadata", {})
        except Exception:
            pass

    manifest = {
        "schema_version": "1.0.0",
        "description": "APISpy bundled shard manifest — generated from SpecRecon export",
        "source_zip": os.path.basename(zip_path),
        "source_metadata": {
            "generated_at":    source_meta.get("generated_at", ""),
            "source_repo":     source_meta.get("source_repo", ""),
            "source_branch":   source_meta.get("source_branch", ""),
            "source_commit":   source_meta.get("source_commit", ""),
            "tool_name":       source_meta.get("tool_name", ""),
            "schema_version":  source_meta.get("schema_version", ""),
        },
        "total_bundled_shards": len(bundled),
        "total_skipped_shards": len(skipped),
        "note_skipped": (
            "Shards that could not be parsed were omitted."
        ),
        "shards": sorted(bundled, key=lambda s: s["provider_namespace"].lower()),
        "skipped_shards": sorted(s["filename"] for s in skipped),
    }

    manifest_path = os.path.join(out_dir, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"  📄 Manifest written: {manifest_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--size-limit", metavar="KB", type=int, default=None,
                        help="Only bundle shards up to this size in KB (default: no limit)")
    parser.add_argument("--zip", metavar="PATH", help="Path to sharded inventory zip")
    parser.add_argument("--out", metavar="DIR", default=DEFAULT_OUT, help="Output data directory")
    args = parser.parse_args()

    inventory_dir = os.path.join(REPO_ROOT, "inventory")
    zip_path = args.zip or find_sharded_zip(inventory_dir)
    print(f"Source zip:  {zip_path}")
    print(f"Output dir:  {args.out}")

    size_limit = args.size_limit * 1024 if args.size_limit else None
    if size_limit:
        print(f"Size limit:  {args.size_limit} KB per shard")
    else:
        print("Size limit:  none (all shards included)")

    bundled, skipped = extract_shards(zip_path, args.out, size_limit)
    print(f"\n  ✅ Bundled {len(bundled)} shards")
    if skipped:
        print(f"  ⏭️  Skipped {len(skipped)} shards (too large or errored)")

    write_manifest(args.out, bundled, skipped, zip_path)
    print("\nDone. Reload the unpacked extension in Chrome to pick up the new data.")


if __name__ == "__main__":
    main()
