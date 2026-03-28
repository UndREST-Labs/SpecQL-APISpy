# VHS tape: demonstrate azure_resource_enum.py terminal output
# Produces demos/09-azure-resource-enum.gif
#
# This tape shows the script's --help output and simulates a complete tenant
# enumeration using a mock helper script (no real Azure auth or network calls).
# For an actual run against a real tenant use: python3 scripts/azure_resource_enum.py

Output demos/09-azure-resource-enum.gif

Set Shell bash
Set FontSize 16
Set Width 1000
Set Height 720
Set Theme "TokyoNight"
Set TypingSpeed 80ms
Set WindowBar ColorfulRight

Hide
Type "cd /home/runner/work/SpecRecon/SpecRecon"
Enter 1
Show

# Show help output
Type "python3 scripts/azure_resource_enum.py --help"
Enter 1
Sleep 3s

# Blank line before the demo run
Type ""
Enter 1
Sleep 500ms

# Simulate a full tenant enumeration using the mock helper
Type "bash tests/vhs/helpers/mock_azure_resource_enum.sh"
Enter 1
Sleep 30s
