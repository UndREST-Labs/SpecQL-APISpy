# VHS tape for demonstrating CodeQL query execution
# This demo shows how to run CodeQL security queries

Output demos/04-codeql-queries.gif

Set Shell bash
Set FontSize 16
Set Width 1000
Set Height 600
Set Theme "Catppuccin Mocha"
Set TypingSpeed 80ms
Set WindowBar Colorful

Type "# Run all CodeQL security queries"
Enter
Type "./run-queries.sh"
Enter
Sleep 1s
Enter

Type "# Running query: SasUriInResponse.ql"
Enter
Type "# Detecting SAS URIs in API example responses..."
Enter
Sleep 2s
Enter

Type "# ✓ Query execution complete"
Enter
Type "# Results saved to: results/SasUriInResponse-results.sarif"
Enter
Sleep 1s
Enter

Type "# What was detected:"
Enter
Type "#   • SilentReaper vulnerabilities (APIs emitting SAS URIs)"
Enter
Type "#   • Exposed Azure Shared Access Signature tokens"
Enter
Type "#   • Control-plane APIs exposing data-plane credentials"
Enter
Sleep 3s
