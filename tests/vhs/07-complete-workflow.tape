# VHS tape for demonstrating complete workflow from setup to results
# This demo shows the end-to-end workflow

Output demos/07-complete-workflow.gif

Set Shell bash
Set FontSize 16
Set Width 1000
Set Height 600
Set Theme "Catppuccin Mocha"
Set TypingSpeed 80ms
Set WindowBar Colorful

Type "# Step 1: Refresh database with Logic Apps specs"
Enter
Type "python3 refresh_database.py --path specification/logic"
Enter
Sleep 1s
Type "# ✓ Database ready (309 JSON files indexed)"
Enter
Sleep 1s
Enter

Type "# Step 2: Run Python security analyzer"
Enter
Type "python3 analyze.py"
Enter
Sleep 1s
Type "# ✓ Analysis complete - vulnerabilities detected"
Enter
Sleep 1s
Enter

Type "# Step 3: Run CodeQL queries"
Enter
Type "./run-queries.sh"
Enter
Sleep 1s
Type "# ✓ CodeQL scan complete - SARIF results generated"
Enter
Sleep 1s
Enter

Type "# Step 4: Analyze results with SARIF tools"
Enter
Type "./scripts/sarif-analysis/prioritize-threats.sh \\"
Enter
Type "    --threshold high results/SasUriInResponse-results.sarif"
Enter
Sleep 1s
Type "# ✓ Threat prioritization complete"
Enter
Sleep 2s
Enter

Type "# 🎉 Workflow complete! Security analysis results ready."
Enter
Type "# Found SilentReaper and other Azure API vulnerabilities"
Enter
Sleep 3s
