# VHS tape for demonstrating the SpeQL setup process
# This demo shows how to set up SpeQL including installing dependencies

Output demos/01-setup.gif

Set Shell bash
Set FontSize 16
Set Width 1000
Set Height 720
Set Theme "Ubuntu"
Set TypingSpeed 80ms
Set WindowBar ColorfulRight

Type "# Clone the SpeQL repository"
Enter
Type "git clone https://github.com/SpeQLSec/SpeQL.git"
Enter
Sleep 2s

Type "cd SpeQL"
Enter
Sleep 500ms

Type "# Install Python dependencies"
Enter
Type "pip3 install -r requirements.txt"
Enter
Sleep 3s

Type "# Run automated setup"
Enter
Type "./setup.sh"
Enter
Sleep 5s
