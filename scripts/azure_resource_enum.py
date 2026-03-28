#!/usr/bin/env python3
"""Enumerate every Azure resource in the tenant and export them to a CSV file.

This script mirrors the authentication flow used by portal_sweep.py (Azure CLI
first-party app, device-code flow) and then calls the Azure Resource Manager
REST API — the same data surface as the PowerShell Get-AzResource cmdlet:
https://learn.microsoft.com/en-us/powershell/module/az.resources/get-azresource

Workflow
--------
1. Authenticate to Azure via device code flow (Azure CLI first-party app).
2. List every subscription visible to the authenticated principal.
3. For each subscription, page through
       GET /subscriptions/{id}/resources?api-version=2021-04-01
   requesting createdTime, changedTime and provisioningState expansions.
4. Write all resources and their properties to a CSV file.

Prerequisites
-------------
    pip install azure-identity

Usage
-----
    # From the repository root:
    python scripts/azure_resource_enum.py

    # With options:
    python scripts/azure_resource_enum.py \\
        --output ./results/azure_resources.csv \\
        --api-version 2021-04-01
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# ── Constants ─────────────────────────────────────────────────────────────────

AZURE_CLI_CLIENT_ID = "04b07795-8ddb-461a-bbee-02f9e1bf7b46"
MANAGEMENT_SCOPE    = "https://management.azure.com/.default"
MANAGEMENT_BASE_URL = "https://management.azure.com"

SUBSCRIPTIONS_API_VERSION = "2022-12-01"
RESOURCES_API_VERSION     = "2021-04-01"

# Properties to request via $expand (comma-separated ARM expansion parameter).
RESOURCES_EXPAND = "createdTime,changedTime,provisioningState"

# Top-level scalar fields written as dedicated CSV columns (in this order).
# Any remaining top-level fields are serialised as JSON in an "extra" column.
CSV_SCALAR_COLUMNS = [
    "id",
    "name",
    "type",
    "location",
    "resourceGroup",
    "subscriptionId",
    "managedBy",
    "kind",
    "etag",
    "createdTime",
    "changedTime",
    "provisioningState",
]

# Top-level complex fields serialised as JSON strings in dedicated columns.
CSV_JSON_COLUMNS = [
    "tags",
    "sku",
    "plan",
    "identity",
    "zones",
    "extendedLocation",
    "properties",
]

CSV_COLUMNS = CSV_SCALAR_COLUMNS + CSV_JSON_COLUMNS


# ── Authentication ────────────────────────────────────────────────────────────


def authenticate_device_code() -> object:
    """Run the Azure device code flow and return a valid DeviceCodeCredential.

    Prints the device code URL and user code to stderr so the operator can
    authenticate while the script waits.  Returns the credential object after
    the token has been acquired (i.e., *blocks* until the user completes auth).
    """
    try:
        from azure.identity import DeviceCodeCredential
    except ImportError:
        print(
            "ERROR: azure-identity is not installed.\n"
            "       Run: pip install azure-identity",
            file=sys.stderr,
        )
        sys.exit(1)

    print("Requesting device code for Azure authentication…", file=sys.stderr)

    credential = DeviceCodeCredential(
        client_id=AZURE_CLI_CLIENT_ID,
        timeout=900,
    )

    # Acquiring the token triggers the device-code prompt on stderr.
    token = credential.get_token(MANAGEMENT_SCOPE)
    print(
        f"✓ Authenticated (token expires at "
        f"{time.strftime('%H:%M:%S', time.localtime(token.expires_on))})",
        file=sys.stderr,
    )
    return credential



# ── ARM REST API helpers ──────────────────────────────────────────────────────


def _get_bearer_token(credential) -> str:
    """Return a fresh bearer token string from the credential."""
    return credential.get_token(MANAGEMENT_SCOPE).token


def _arm_get(url: str, credential) -> dict:
    """Perform a GET request against the ARM REST API and return parsed JSON.

    Automatically refreshes the token via *credential* for each call so long-
    running enumerations are not affected by token expiry.
    """
    token = _get_bearer_token(credential)
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(
            f"ERROR: ARM API returned HTTP {exc.code} for {url}\n{body}",
            file=sys.stderr,
        )
        raise


def _arm_list_all(url: str, credential) -> list[dict]:
    """Page through an ARM list endpoint and return every item.

    Follows ``nextLink`` values until all pages have been consumed.
    """
    items: list[dict] = []
    next_url: str | None = url

    while next_url:
        data = _arm_get(next_url, credential)
        items.extend(data.get("value", []))
        next_url = data.get("nextLink")

    return items


# ── Subscription enumeration ──────────────────────────────────────────────────


def list_subscriptions(credential) -> list[dict]:
    """Return all subscriptions visible to the authenticated principal."""
    url = (
        f"{MANAGEMENT_BASE_URL}/subscriptions"
        f"?api-version={SUBSCRIPTIONS_API_VERSION}"
    )
    subscriptions = _arm_list_all(url, credential)
    print(
        f"✓ Found {len(subscriptions)} subscription(s).",
        file=sys.stderr,
    )
    return subscriptions


# ── Resource enumeration ──────────────────────────────────────────────────────


def list_resources_for_subscription(
    subscription_id: str,
    credential,
    api_version: str = RESOURCES_API_VERSION,
) -> list[dict]:
    """Return all resources in *subscription_id* with expanded properties."""
    params = urllib.parse.urlencode(
        {
            "api-version": api_version,
            "$expand": RESOURCES_EXPAND,
        }
    )
    url = (
        f"{MANAGEMENT_BASE_URL}/subscriptions/{subscription_id}"
        f"/resources?{params}"
    )
    return _arm_list_all(url, credential)


def enumerate_all_resources(
    credential,
    api_version: str = RESOURCES_API_VERSION,
) -> list[dict]:
    """Enumerate every resource across all accessible subscriptions."""
    subscriptions = list_subscriptions(credential)
    all_resources: list[dict] = []

    for sub in subscriptions:
        sub_id = sub.get("subscriptionId", "")
        sub_name = sub.get("displayName", sub_id)
        print(
            f"  Enumerating resources in: {sub_name} ({sub_id})…",
            file=sys.stderr,
        )
        try:
            resources = list_resources_for_subscription(sub_id, credential, api_version)
        except urllib.error.HTTPError as exc:
            print(
                f"  WARNING: Skipping subscription {sub_id} — HTTP {exc.code}",
                file=sys.stderr,
            )
            resources = []

        # Annotate each resource with its subscription ID so the CSV always
        # has the field populated even if the ARM response omits it.
        for resource in resources:
            resource.setdefault("subscriptionId", sub_id)

        all_resources.extend(resources)
        print(
            f"    → {len(resources)} resource(s) found.",
            file=sys.stderr,
        )

    print(
        f"✓ Total resources enumerated: {len(all_resources)}.",
        file=sys.stderr,
    )
    return all_resources


# ── Resource-group extraction ─────────────────────────────────────────────────


def _extract_resource_group(resource_id: str) -> str:
    """Extract the resource-group name from an ARM resource ID.

    ARM IDs have the form:
        /subscriptions/{sub}/resourceGroups/{rg}/providers/{ns}/...

    Returns an empty string if the ID does not contain a resourceGroups segment.
    """
    parts = resource_id.split("/")
    for i, part in enumerate(parts):
        if part.lower() == "resourcegroups" and i + 1 < len(parts):
            return parts[i + 1]
    return ""


# ── CSV export ────────────────────────────────────────────────────────────────


def _resource_to_row(resource: dict) -> dict:
    """Convert a raw ARM resource dict to a flat CSV row dict."""
    row: dict = {}

    # --- scalar columns ---
    for col in CSV_SCALAR_COLUMNS:
        row[col] = resource.get(col, "")

    # Derive resourceGroup from the resource ID when not present at top level.
    if not row["resourceGroup"]:
        row["resourceGroup"] = _extract_resource_group(row["id"])

    # --- JSON-serialised complex columns ---
    for col in CSV_JSON_COLUMNS:
        value = resource.get(col)
        if value is None:
            row[col] = ""
        elif isinstance(value, (dict, list)):
            row[col] = json.dumps(value, separators=(",", ":"))
        else:
            row[col] = str(value)

    return row


def write_csv(resources: list[dict], output_path: Path) -> None:
    """Write *resources* to a CSV file at *output_path*."""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for resource in resources:
            writer.writerow(_resource_to_row(resource))

    print(f"✓ CSV written to: {output_path}", file=sys.stderr)


# ── CLI entry point ───────────────────────────────────────────────────────────


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Enumerate every Azure resource in the tenant via the ARM REST API "
            "(equivalent to Get-AzResource) and export results to a CSV file."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("azure_resources.csv"),
        help="Path for the output CSV file.",
    )
    parser.add_argument(
        "--api-version",
        default=RESOURCES_API_VERSION,
        help="ARM resources API version to use.",
    )
    return parser


def main() -> None:
    args = _build_arg_parser().parse_args()

    credential = authenticate_device_code()
    resources = enumerate_all_resources(credential, api_version=args.api_version)

    if not resources:
        print(
            "WARNING: No resources were returned.  "
            "The authenticated principal may not have read access to any subscription.",
            file=sys.stderr,
        )

    write_csv(resources, args.output)


if __name__ == "__main__":
    main()
