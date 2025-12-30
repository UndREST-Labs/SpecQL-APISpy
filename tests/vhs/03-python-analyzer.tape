# VHS tape for demonstrating Python security analysis
# This demo shows how to run the Python analyzer on the database

Output demos/03-python-analyzer.gif

Set Shell bash
Set FontSize 13
Set Width 1000
Set Height 600
Set Theme "Catppuccin Mocha"
Set TypingSpeed 100ms

Type "# ╔═══════════════════════════════════════════════════════╗"
Enter
Type "# ║  Python Security Analyzer Demo                       ║"
Enter
Type "# ╚═══════════════════════════════════════════════════════╝"
Enter
Sleep 1s
Enter

Type "# Run security analysis on Logic Apps specifications"
Enter
Type "python3 analyze.py"
Enter
Sleep 1s
Enter

Type "# Analyzing 309 JSON files from database..."
Enter
Sleep 1s
Type "# ✓ Checked for Insecure Logic App triggers"
Enter
Type "# ✓ Checked for Key Vault misconfigurations"
Enter
Type "# ✓ Checked for Missing access control"
Enter
Type "# ✓ Checked for Hardcoded credentials"
Enter
Sleep 2s
Enter

Type "# Detected vulnerability types:"
Enter
Type "#   • Insecure Logic App triggers (SilentReaper Pattern)"
Enter
Type "#   • Azure Vault Recon (Key Vault misconfigurations)"
Enter
Type "#   • Missing access control on sensitive operations"
Enter
Type "#   • Hardcoded credentials in API schemas"
Enter
Sleep 3s
