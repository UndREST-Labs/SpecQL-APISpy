# VHS tape for demonstrating the SpeQL setup process
# This demo shows how to set up SpeQL including installing dependencies

Output demos/01-setup.gif

Set Shell bash
Set FontSize 16
Set Width 1000
Set Height 720
Set Theme "TokyoNight"
Set TypingSpeed 80ms
Set WindowBar ColorfulRight

Hide
Type "cd /tmp"
Enter
Show

Type "git clone https://github.com/SpeQLSec/SpeQL.git"
Enter
Sleep 3s

Type "cd SpeQL"
Enter
Sleep 500ms

Type "pip3 install -r requirements.txt"
Enter
Sleep 5s

Type "./setup.sh"
Enter
Sleep 8s
