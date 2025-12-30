# VHS tape for demonstrating the interactive CLI menu
# This demo shows how to navigate and use the SpeQL CLI

Output demos/05-cli-menu.gif

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

Type "# Launch the interactive CLI menu"
Enter
Type "python3 SpeQL.py"
Enter
Sleep 3s

# Navigate to Security Analysis
Type "1"
Sleep 100ms
Enter
Sleep 3s

# Return to main menu
Type "0"
Sleep 100ms
Enter
Sleep 2s

# Navigate to Database Management
Type "2"
Sleep 100ms
Enter
Sleep 3s

# Return to main menu
Type "0"
Sleep 100ms
Enter
Sleep 2s

# Navigate to Documentation
Type "6"
Sleep 100ms
Enter
Sleep 3s

# Return to main menu
Type "0"
Sleep 100ms
Enter
Sleep 2s

# Exit
Type "0"
Sleep 100ms
Enter
Sleep 1s
