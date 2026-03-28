#!/usr/bin/env bash
# Mock script that simulates azure_resource_enum.py terminal output for VHS recording.
# Echoes a realistic run across 3 subscriptions with plausible timing delays.
# This is NOT a real enumeration — it produces no actual network traffic or CSV output.

BOLD=$'\e[1m'
DIM=$'\e[2m'
GREEN=$'\e[32m'
YELLOW=$'\e[33m'
CYAN=$'\e[36m'
RESET=$'\e[0m'

header() { printf '%s\n' "${BOLD}${1}${RESET}"; }
ok()     { printf '%s\n' "${GREEN}✓${RESET} ${1}"; }
info()   { printf '%s\n' "  ${DIM}${1}${RESET}"; }

# ── Authentication ────────────────────────────────────────────────────────────

printf 'Requesting device code for Azure authentication…\n'
sleep 1
printf 'To sign in, use a web browser to open the page https://login.microsoft.com/device\n'
printf 'and enter the code %s to authenticate.\n' "A7HK9MNQR"
sleep 3
ok "Authenticated (token expires at $(date -d '+60 minutes' '+%H:%M:%S' 2>/dev/null \
    || date -v+60M '+%H:%M:%S' 2>/dev/null \
    || echo '23:59:00'))"
echo ""

# ── Subscription listing ──────────────────────────────────────────────────────

ok "Found 3 subscription(s)."
echo ""

# ── Resource enumeration ──────────────────────────────────────────────────────

# Subscription 1 — production
printf '  Enumerating resources in: Contoso Production (%s)…\n' \
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
sleep 1

resources_sub1=(
  "Microsoft.Compute/virtualMachines         vm-prod-web-01          eastus"
  "Microsoft.Compute/virtualMachines         vm-prod-web-02          eastus"
  "Microsoft.Compute/virtualMachines         vm-prod-db-01           eastus"
  "Microsoft.Storage/storageAccounts         stproddata01            eastus"
  "Microsoft.Storage/storageAccounts         stprodbackup01          eastus"
  "Microsoft.Network/virtualNetworks         vnet-prod               eastus"
  "Microsoft.Network/networkSecurityGroups   nsg-prod-web            eastus"
  "Microsoft.KeyVault/vaults                 kv-prod-secrets         eastus"
  "Microsoft.Sql/servers                     sql-prod-db             eastus"
  "Microsoft.Web/sites                       app-prod-api            eastus"
  "Microsoft.ContainerService/managedClusters aks-prod               eastus"
  "Microsoft.Monitor/accounts                mon-prod                eastus"
)

for entry in "${resources_sub1[@]}"; do
  printf "    ${CYAN}%-45s${RESET} %-30s %s\n" $entry
  sleep 0.05
done
ok "    → ${#resources_sub1[@]} resource(s) found."
echo ""

# Subscription 2 — staging
printf '  Enumerating resources in: Contoso Staging (%s)…\n' \
    "b2c3d4e5-f6a7-8901-bcde-f12345678901"
sleep 0.8

resources_sub2=(
  "Microsoft.Compute/virtualMachines         vm-stg-web-01           westus2"
  "Microsoft.Storage/storageAccounts         ststgdata01             westus2"
  "Microsoft.Network/virtualNetworks         vnet-stg                westus2"
  "Microsoft.KeyVault/vaults                 kv-stg-secrets          westus2"
  "Microsoft.Web/sites                       app-stg-api             westus2"
  "Microsoft.Cache/Redis                     redis-stg               westus2"
  "Microsoft.ServiceBus/namespaces           sb-stg-events           westus2"
)

for entry in "${resources_sub2[@]}"; do
  printf "    ${CYAN}%-45s${RESET} %-30s %s\n" $entry
  sleep 0.05
done
ok "    → ${#resources_sub2[@]} resource(s) found."
echo ""

# Subscription 3 — dev
printf '  Enumerating resources in: Contoso Development (%s)…\n' \
    "c3d4e5f6-a7b8-9012-cdef-012345678902"
sleep 0.6

resources_sub3=(
  "Microsoft.Compute/virtualMachines         vm-dev-01               northeurope"
  "Microsoft.Storage/storageAccounts         stdevdata01             northeurope"
  "Microsoft.Network/virtualNetworks         vnet-dev                northeurope"
  "Microsoft.Web/sites                       app-dev-api             northeurope"
  "Microsoft.Logic/workflows                 logic-dev-workflow      northeurope"
)

for entry in "${resources_sub3[@]}"; do
  printf "    ${CYAN}%-45s${RESET} %-30s %s\n" $entry
  sleep 0.05
done
ok "    → ${#resources_sub3[@]} resource(s) found."
echo ""

# ── Summary ───────────────────────────────────────────────────────────────────

total=$(( ${#resources_sub1[@]} + ${#resources_sub2[@]} + ${#resources_sub3[@]} ))
ok "Total resources enumerated: ${total}."
echo ""

# ── CSV output ────────────────────────────────────────────────────────────────

CSV_PATH="azure_resources.csv"
ok "CSV written to: ${CSV_PATH}"
echo ""
printf '%sPreview of %s%s\n' "${BOLD}" "${CSV_PATH}" "${RESET}"
printf '%s' "${DIM}"
printf 'id,name,type,location,resourceGroup,subscriptionId,...\n'
printf '/subscriptions/a1b2.../resourceGroups/rg-prod-compute/providers/Microsoft.Compute/virtualMachines/vm-prod-web-01,vm-prod-web-01,Microsoft.Compute/virtualMachines,eastus,rg-prod-compute,a1b2c3d4-...\n'
printf '/subscriptions/a1b2.../resourceGroups/rg-prod-data/providers/Microsoft.Storage/storageAccounts/stproddata01,stproddata01,Microsoft.Storage/storageAccounts,eastus,rg-prod-data,a1b2c3d4-...\n'
printf '... (%d rows total)\n' "$total"
printf '%s' "${RESET}"
