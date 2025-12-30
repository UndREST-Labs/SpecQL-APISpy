# VHS tape for demonstrating complete workflow from setup to results
# This demo shows the end-to-end workflow

Output demos/07-complete-workflow.gif

Set Shell bash
Set FontSize 16
Set Width 1000
Set Height 720
Set Theme "Ubuntu"
Set TypingSpeed 80ms
Set WindowBar ColorfulRight

Type "# Step 1: Refresh database with Logic Apps specs"
Enter
Type "python3 refresh_database.py --path specification/logic --skip-db-build"
Enter
Sleep 5s

Type "# Step 2: Run Python security analyzer"
Enter
Type "python3 analyze.py"
Enter
Sleep 5s

Type "# Step 3: Run CodeQL queries"
Enter
Type "./run-queries.sh"
Enter
Sleep 5s

Type "# Step 4: Analyze results with SARIF tools"
Enter
Type "./scripts/sarif-analysis/prioritize-threats.sh --threshold high results/SasUriInResponse-results.sarif"
Enter
Sleep 3s
