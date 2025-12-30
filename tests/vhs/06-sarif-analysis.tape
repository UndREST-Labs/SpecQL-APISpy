# VHS tape for demonstrating SARIF analysis tools
# This demo shows how to analyze SARIF output files

Output demos/06-sarif-analysis.gif

Set Shell bash
Set FontSize 13
Set Width 1000
Set Height 600
Set Theme "Catppuccin Mocha"
Set TypingSpeed 100ms

Type "# ╔═══════════════════════════════════════════════════════╗"
Enter
Type "# ║  SARIF Analysis Tools Demo                           ║"
Enter
Type "# ╚═══════════════════════════════════════════════════════╝"
Enter
Sleep 1s
Enter

Type "# Tool 1: Deduplicate findings by product and operation"
Enter
Type "./scripts/sarif-analysis/deduplicate-by-product-operation.sh \\"
Enter
Type "    results/SasUriInResponse-results.sarif"
Enter
Sleep 1s
Type "# ✓ Removed duplicate findings across API versions"
Enter
Sleep 1s
Enter

Type "# Tool 2: Parse and extract endpoint data to CSV"
Enter
Type "./scripts/sarif-analysis/parse-sarif-endpoints.sh \\"
Enter
Type "    -f csv results/SasUriInResponse-results.sarif"
Enter
Sleep 1s
Type "# ✓ Exported endpoint data to CSV format"
Enter
Sleep 1s
Enter

Type "# Tool 3: Prioritize threats by severity"
Enter
Type "./scripts/sarif-analysis/prioritize-threats.sh \\"
Enter
Type "    --threshold high results/SasUriInResponse-results.sarif"
Enter
Sleep 1s
Type "# ✓ Prioritized high and critical severity findings"
Enter
Sleep 1s
Enter

Type "# These tools help identify control plane/data plane"
Enter
Type "# isolation issues and SilentReaper vulnerabilities"
Enter
Sleep 3s
