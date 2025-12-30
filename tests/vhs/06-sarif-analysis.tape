# VHS tape for demonstrating SARIF analysis tools
# This demo shows how to analyze SARIF output files

Output demos/06-sarif-analysis.gif

Set Shell bash
Set FontSize 16
Set Width 1000
Set Height 720
Set Theme "TokyoNight"
Set TypingSpeed 80ms
Set WindowBar ColorfulRight

Hide
Type "cd /home/runner/work/SpeQL/SpeQL"
Enter
Show

Type "# Deduplicate findings by product and operation"
Enter
Type "./scripts/sarif-analysis/deduplicate-by-product-operation.sh results/SasUriInResponse-results.sarif"
Enter
Sleep 2s

Type "# Parse and extract endpoint data to CSV"
Enter
Type "./scripts/sarif-analysis/parse-sarif-endpoints.sh -f csv results/SasUriInResponse-results.sarif"
Enter
Sleep 2s

Type "# Prioritize threats by severity"
Enter
Type "./scripts/sarif-analysis/prioritize-threats.sh --threshold high results/SasUriInResponse-results.sarif"
Enter
Sleep 2s
