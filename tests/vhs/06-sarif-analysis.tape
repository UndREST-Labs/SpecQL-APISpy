# VHS tape for demonstrating SARIF analysis tools
# This demo shows how to analyze SARIF output files

Output demos/06-sarif-analysis.gif

Set Shell bash
Set FontSize 16
Set Width 1000
Set Height 720
Set Theme "Ubuntu"
Set TypingSpeed 80ms
Set WindowBar ColorfulRight

Type "# Deduplicate findings by product and operation"
Enter
Type "./scripts/sarif-analysis/deduplicate-by-product-operation.sh results/SasUriInResponse-results.sarif"
Enter
Sleep 3s

Type "# Parse and extract endpoint data to CSV"
Enter
Type "./scripts/sarif-analysis/parse-sarif-endpoints.sh -f csv results/SasUriInResponse-results.sarif"
Enter
Sleep 3s

Type "# Prioritize threats by severity"
Enter
Type "./scripts/sarif-analysis/prioritize-threats.sh --threshold high results/SasUriInResponse-results.sarif"
Enter
Sleep 3s
