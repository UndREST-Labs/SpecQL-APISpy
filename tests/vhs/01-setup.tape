# VHS tape for demonstrating the SpeQL setup process
# This demo shows how to set up SpeQL including installing dependencies

Output demos/01-setup.gif

Set Shell bash
Set FontSize 16
Set Width 1000
Set Height 600
Set Theme "Catppuccin Mocha"
Set TypingSpeed 80ms
Set WindowBar Colorful

Type "# Clone the SpeQL repository"
Enter
Type "git clone https://github.com/SpeQLSec/SpeQL.git"
Enter
Sleep 500ms
Type "cd SpeQL"
Enter
Sleep 1s
Enter

Type "# Step 1: Install Python dependencies"
Enter
Type "pip3 install -r requirements.txt"
Enter
Sleep 1s
Type "# Successfully installed: pyfiglet"
Enter
Sleep 1s
Enter

Type "# Step 2: Run automated setup"
Enter
Type "# Installs: Java, CodeQL CLI 2.20.2, and dependencies"
Enter
Type "./setup.sh"
Enter
Sleep 2s
Enter

Type "# ✓ Java installed"
Enter
Type "# ✓ CodeQL CLI 2.20.2 installed"
Enter
Type "# ✓ Query pack dependencies installed"
Enter
Sleep 2s
Enter

Type "# Setup complete! You can now run:"
Enter
Type "#   python3 SpeQL.py       - Interactive CLI menu"
Enter
Type "#   python3 analyze.py     - Python security analyzer"
Enter
Type "#   ./run-queries.sh       - CodeQL queries"
Enter
Sleep 3s
