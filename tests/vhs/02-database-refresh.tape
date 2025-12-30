# VHS tape for demonstrating database refresh with specification/logic
# This demo shows how to refresh the database using Logic Apps specifications

Output demos/02-database-refresh.gif

Set Shell bash
Set FontSize 13
Set Width 1000
Set Height 600
Set Theme "Catppuccin Mocha"
Set TypingSpeed 100ms

Type "# ╔═══════════════════════════════════════════════════════╗"
Enter
Type "# ║  Database Refresh Demo - specification/logic         ║"
Enter
Type "# ╚═══════════════════════════════════════════════════════╝"
Enter
Sleep 1s
Enter

Type "# Refresh database with Logic Apps specifications"
Enter
Type "python3 refresh_database.py --path specification/logic"
Enter
Sleep 1s
Type "# Cloning Azure REST API specs..."
Enter
Sleep 1s
Type "# [SUCCESS] Repository cloned successfully"
Enter
Type "# [INFO] Found 309 JSON files in specification/logic"
Enter
Sleep 1s
Enter

Type "# Building CodeQL database..."
Enter
Sleep 1s
Type "# [INFO] Creating database at: database/azure-api-db"
Enter
Type "# [SUCCESS] Database built successfully"
Enter
Sleep 2s
Enter

Type "# ✓ Database ready for analysis!"
Enter
Type "# Location: database/azure-api-db/"
Enter
Type "# Files indexed: 309 JSON files"
Enter
Sleep 3s
