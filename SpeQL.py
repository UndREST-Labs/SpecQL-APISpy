#!/usr/bin/env python3
"""
SpeQL - Interactive CLI Menu System
A command-line interface for navigating and executing SpeQL security analysis actions
"""

import os
import sys
import subprocess
from pathlib import Path

# Set CodeQL environment variable to suppress installation path warnings
if 'CODEQL_ALLOW_INSTALLATION_ANYWHERE' not in os.environ:
    os.environ['CODEQL_ALLOW_INSTALLATION_ANYWHERE'] = 'true'

# Try to import pyfiglet, fallback to simple ASCII if not available
try:
    import pyfiglet
    HAS_FIGLET = True
except ImportError:
    HAS_FIGLET = False

# ANSI color codes
RED = '\033[0;31m'
GREEN = '\033[0;32m'
YELLOW = '\033[1;33m'
BLUE = '\033[0;34m'
CYAN = '\033[0;36m'
MAGENTA = '\033[0;35m'
BOLD = '\033[1m'
NC = '\033[0m'  # No Color


def clear_screen():
    """Clear the terminal screen"""
    os.system('clear' if os.name != 'nt' else 'cls')


def print_logo():
    """Print the SpeQL logo"""
    if HAS_FIGLET:
        logo = pyfiglet.figlet_format("SpeQL", font="larry3d")
        print(f"{CYAN}{logo}{NC}")
    else:
        # Fallback ASCII art
        print(f"{CYAN}")
        print("   _____            ____    __    ")
        print("  / ___/____  ___  / __ \\  / /    ")
        print("  \\__ \\/ __ \\/ _ \\/ / / / / /     ")
        print(" ___/ / /_/ /  __/ /_/ / / /___   ")
        print("/____/ .___/\\___/\\___\\_\\/_____/   ")
        print("    /_/                            ")
        print(f"{NC}")
    
    print(f"{BOLD}Security Pattern Query Language for Azure APIs{NC}")
    print(f"{BLUE}═══════════════════════════════════════════════════════════{NC}\n")


def print_menu(title, options, back_option=True):
    """Print a menu with numbered options"""
    print(f"\n{BOLD}{YELLOW}{title}{NC}")
    print(f"{BLUE}{'─' * 60}{NC}")
    
    for i, option in enumerate(options, 1):
        print(f"{GREEN}{i}.{NC} {option}")
    
    if back_option:
        print(f"{GREEN}0.{NC} Back to Main Menu")
    else:
        print(f"{GREEN}0.{NC} Exit")
    
    print(f"{BLUE}{'─' * 60}{NC}")


def get_choice(max_option):
    """Get user choice with validation"""
    while True:
        try:
            choice = input(f"\n{CYAN}Enter your choice (0-{max_option}): {NC}").strip()
            choice_num = int(choice)
            if 0 <= choice_num <= max_option:
                return choice_num
            else:
                print(f"{RED}Invalid choice. Please enter a number between 0 and {max_option}.{NC}")
        except ValueError:
            print(f"{RED}Invalid input. Please enter a number.{NC}")
        except KeyboardInterrupt:
            print(f"\n{YELLOW}Operation cancelled.{NC}")
            return 0


def select_file_from_list(directory, pattern="*.sarif"):
    """
    Display files in a directory and allow selection with cursor navigation
    Returns the selected file path or None if cancelled
    """
    import glob
    
    files = sorted(glob.glob(str(Path(directory) / pattern)))
    
    if not files:
        print(f"{YELLOW}No files found matching pattern {pattern} in {directory}{NC}")
        return None
    
    # Display files as numbered list
    print(f"\n{BOLD}{YELLOW}Select a file:{NC}")
    print(f"{BLUE}{'─' * 60}{NC}")
    
    for i, file_path in enumerate(files, 1):
        file_name = Path(file_path).name
        file_size = Path(file_path).stat().st_size
        size_str = f"{file_size:,} bytes"
        print(f"{GREEN}{i}.{NC} {file_name:<40s} {size_str}")
    
    print(f"{GREEN}0.{NC} Cancel")
    print(f"{BLUE}{'─' * 60}{NC}")
    
    # Get user choice
    while True:
        try:
            choice = input(f"\n{CYAN}Enter file number (0-{len(files)}) or use arrow keys: {NC}").strip()
            choice_num = int(choice)
            if choice_num == 0:
                return None
            if 1 <= choice_num <= len(files):
                return files[choice_num - 1]
            else:
                print(f"{RED}Invalid choice. Please enter a number between 0 and {len(files)}.{NC}")
        except ValueError:
            print(f"{RED}Invalid input. Please enter a number.{NC}")
        except KeyboardInterrupt:
            print(f"\n{YELLOW}Selection cancelled.{NC}")
            return None


def run_command(cmd, description=""):
    """Run a shell command and display output"""
    if description:
        print(f"\n{YELLOW}> {description}{NC}")
        print(f"{BLUE}Command: {' '.join(cmd)}{NC}\n")
    
    try:
        result = subprocess.run(cmd, check=False)
        return result.returncode == 0
    except FileNotFoundError:
        print(f"{RED}Error: Command not found: {cmd[0]}{NC}")
        return False
    except Exception as e:
        print(f"{RED}Error executing command: {e}{NC}")
        return False


def pause():
    """Pause and wait for user to press Enter"""
    input(f"\n{CYAN}Press Enter to continue...{NC}")


def analyze_menu():
    """Security Analysis submenu"""
    while True:
        clear_screen()
        print_logo()
        
        options = [
            "Analyze from Database (default - fast)",
            "Analyze from Custom Source Directory",
            "Analyze Specific Azure Service",
            "Analyze All Azure Services (comprehensive)",
            "Verbose Analysis Mode",
            "Show Available Analysis Options"
        ]
        
        print_menu("Security Analysis Options", options)
        choice = get_choice(len(options))
        
        if choice == 0:
            break
        elif choice == 1:
            clear_screen()
            print_logo()
            print(f"{YELLOW}Running security analysis from database...{NC}\n")
            run_command(["python3", "analyze.py"], "Analyzing Azure API specifications from database")
            pause()
        elif choice == 2:
            clear_screen()
            print_logo()
            path = input(f"{CYAN}Enter source directory path: {NC}").strip()
            if path:
                clear_screen()
                print_logo()
                run_command(["python3", "analyze.py", "--source", path], 
                          f"Analyzing specifications from: {path}")
                pause()
        elif choice == 3:
            clear_screen()
            print_logo()
            print(f"{YELLOW}Common Azure Services:{NC}")
            print(f"  - specification/logic (Logic Apps)")
            print(f"  - specification/keyvault (Key Vault)")
            print(f"  - specification/compute (Compute)")
            print(f"  - specification/storage (Storage)")
            print(f"  - specification/network (Network)")
            service = input(f"\n{CYAN}Enter service path (e.g., specification/keyvault): {NC}").strip()
            if service:
                clear_screen()
                print_logo()
                run_command(["python3", "analyze.py", "--source", f"azure-rest-api-specs/{service}"],
                          f"Analyzing {service} specifications")
                pause()
        elif choice == 4:
            clear_screen()
            print_logo()
            print(f"{YELLOW}Warning: This will analyze all Azure specifications (~253,000 files).{NC}")
            print(f"{YELLOW}This may take significant time.{NC}")
            confirm = input(f"\n{CYAN}Continue? (y/N): {NC}").strip().lower()
            if confirm == 'y':
                clear_screen()
                print_logo()
                run_command(["python3", "analyze.py", "--source", "azure-rest-api-specs/specification"],
                          "Analyzing all Azure specifications")
                pause()
        elif choice == 5:
            clear_screen()
            print_logo()
            print(f"{YELLOW}Running analysis in verbose mode...{NC}\n")
            run_command(["python3", "analyze.py", "--verbose"], "Verbose analysis mode")
            pause()
        elif choice == 6:
            clear_screen()
            print_logo()
            run_command(["python3", "analyze.py", "--help"], "Analysis options help")
            pause()


def database_menu():
    """Database Management submenu"""
    while True:
        clear_screen()
        print_logo()
        
        options = [
            "Update Repository and Rebuild Database (default)",
            "Fresh Clone and Rebuild",
            "Build Database for Specific Service",
            "Build Database for All Services",
            "Update Repository Only (skip DB build)",
            "Show Database Management Options"
        ]
        
        print_menu("Database Management", options)
        choice = get_choice(len(options))
        
        if choice == 0:
            break
        elif choice == 1:
            clear_screen()
            print_logo()
            print(f"{YELLOW}Updating repository and rebuilding database...{NC}\n")
            run_command(["python3", "refresh_database.py"], "Standard database refresh")
            pause()
        elif choice == 2:
            clear_screen()
            print_logo()
            print(f"{YELLOW}Performing fresh clone and rebuild...{NC}\n")
            run_command(["python3", "refresh_database.py", "--fresh"], "Fresh clone and rebuild")
            pause()
        elif choice == 3:
            clear_screen()
            print_logo()
            print(f"{YELLOW}Common Azure Services:{NC}")
            print(f"  - specification/logic (Logic Apps) - default")
            print(f"  - specification/keyvault (Key Vault)")
            print(f"  - specification/compute (Compute)")
            print(f"  - specification/storage (Storage)")
            service = input(f"\n{CYAN}Enter service path (e.g., specification/keyvault): {NC}").strip()
            if service:
                clear_screen()
                print_logo()
                run_command(["python3", "refresh_database.py", "--path", service, "--fresh"],
                          f"Building database for {service}")
                pause()
        elif choice == 4:
            clear_screen()
            print_logo()
            print(f"{YELLOW}Warning: Building database for all services may take significant time and space.{NC}")
            confirm = input(f"\n{CYAN}Continue? (y/N): {NC}").strip().lower()
            if confirm == 'y':
                clear_screen()
                print_logo()
                run_command(["python3", "refresh_database.py", "--all", "--fresh"],
                          "Building database for all Azure services")
                pause()
        elif choice == 5:
            clear_screen()
            print_logo()
            print(f"{YELLOW}Updating repository without rebuilding database...{NC}\n")
            run_command(["python3", "refresh_database.py", "--skip-db-build"],
                      "Repository update only")
            pause()
        elif choice == 6:
            clear_screen()
            print_logo()
            run_command(["python3", "refresh_database.py", "--help"], "Database management help")
            pause()


def codeql_menu():
    """CodeQL Queries submenu"""
    while True:
        clear_screen()
        print_logo()
        
        options = [
            "Run All Security Queries",
            "Run Individual Query",
            "View Previous Results",
            "Show Query Documentation"
        ]
        
        print_menu("CodeQL Security Queries", options)
        choice = get_choice(len(options))
        
        if choice == 0:
            break
        elif choice == 1:
            clear_screen()
            print_logo()
            print(f"{YELLOW}Running all security queries...{NC}\n")
            run_command(["./run-queries.sh"], "Running CodeQL security analysis")
            pause()
        elif choice == 2:
            clear_screen()
            print_logo()
            
            # Dynamically discover all .ql files in queries/azure-security
            queries_dir = Path("queries/azure-security")
            if not queries_dir.exists():
                print(f"{RED}Error: Queries directory not found: {queries_dir}{NC}")
                pause()
                continue
            
            query_files = sorted(queries_dir.glob("*.ql"))
            
            if not query_files:
                print(f"{YELLOW}No query files found in {queries_dir}{NC}")
                pause()
                continue
            
            print(f"{YELLOW}Available Queries:{NC}")
            for i, query_file in enumerate(query_files, 1):
                print(f"  {i}. {query_file.name}")
            
            query_choice = input(f"\n{CYAN}Enter query number (1-{len(query_files)}): {NC}").strip()
            
            if query_choice.isdigit() and 1 <= int(query_choice) <= len(query_files):
                query_file = query_files[int(query_choice) - 1]
                clear_screen()
                print_logo()
                run_command([
                    "codeql", "database", "analyze", "database/azure-api-db",
                    str(query_file),
                    "--format=sarif-latest",
                    f"--output=results/{query_file.stem}-results.sarif"
                ], f"Running {query_file.name}")
                pause()
        elif choice == 3:
            clear_screen()
            print_logo()
            results_dir = Path("results")
            if results_dir.exists():
                sarif_files = list(results_dir.glob("*.sarif"))
                if sarif_files:
                    print(f"{GREEN}Found {len(sarif_files)} result file(s):{NC}\n")
                    for sarif_file in sarif_files:
                        print(f"  - {sarif_file.name}")
                else:
                    print(f"{YELLOW}No SARIF result files found.{NC}")
            else:
                print(f"{YELLOW}Results directory not found. Run queries first.{NC}")
            pause()
        elif choice == 4:
            clear_screen()
            print_logo()
            
            # Dynamically discover all .ql files and show their documentation
            queries_dir = Path("queries/azure-security")
            query_files = sorted(queries_dir.glob("*.ql")) if queries_dir.exists() else []
            
            print(f"{BOLD}Available Security Queries:{NC}\n")
            
            for i, query_file in enumerate(query_files, 1):
                query_name = query_file.stem
                print(f"{GREEN}{i}. {query_file.name}{NC}")
                
                # Show description based on query name
                if "InsecureLogicAppTrigger" in query_name:
                    print("   Detects Logic App triggers vulnerable to Azure Silent Reaper attack")
                    print("   - HTTP/Request triggers missing authentication")
                    print("   - Triggers using 'None' or 'Anonymous' authentication")
                elif "InsecureKeyVaultConfig" in query_name:
                    print("   Detects Key Vault misconfigurations (Azure Vault Recon)")
                    print("   - Key Vaults without network restrictions")
                    print("   - Public network access enabled")
                elif "MissingAccessControl" in query_name:
                    print("   Finds API endpoints lacking proper access control")
                    print("   - Sensitive operations without authentication")
                    print("   - API endpoints with empty security arrays")
                elif "InsecureCredentials" in query_name:
                    print("   Locates hardcoded credentials and secrets")
                    print("   - Hardcoded passwords, API keys, secrets")
                    print("   - Connection strings with embedded credentials")
                elif "SasUriInResponse" in query_name:
                    print("   Detects SAS URIs exposed in API responses")
                    print("   - SAS tokens in response bodies")
                    print("   - Potential data exfiltration risks")
                else:
                    print(f"   Security query for Azure API specifications")
                print()
            
            pause()


def sarif_menu():
    """SARIF Analysis submenu"""
    while True:
        clear_screen()
        print_logo()
        
        options = [
            "Deduplicate SARIF Results",
            "Parse SARIF Endpoints",
            "Prioritize Threats",
            "Show SARIF Tools Documentation"
        ]
        
        print_menu("SARIF Analysis Tools", options)
        choice = get_choice(len(options))
        
        if choice == 0:
            break
        elif choice == 1:
            clear_screen()
            print_logo()
            sarif_file = select_file_from_list("results", "*.sarif")
            if sarif_file:
                # Ask for format
                print(f"\n{YELLOW}Output format options:{NC}")
                print(f"  1. unique - Unique product+operation combinations (default)")
                print(f"  2. grouped - Grouped results by product")
                print(f"  3. summary - Summary statistics")
                format_choice = input(f"\n{CYAN}Select format (1-3) [1]: {NC}").strip()
                
                format_map = {"1": "unique", "2": "grouped", "3": "summary", "": "unique"}
                output_format = format_map.get(format_choice, "unique")
                
                # Ask for output destination
                print(f"\n{YELLOW}Output destination:{NC}")
                print(f"  1. Screen (default)")
                print(f"  2. File")
                output_choice = input(f"\n{CYAN}Select output (1-2) [1]: {NC}").strip()
                
                cmd = ["./scripts/sarif-analysis/deduplicate-by-product-operation.sh", "-f", output_format]
                
                if output_choice == "2":
                    output_file = input(f"{CYAN}Enter output filename: {NC}").strip()
                    if output_file:
                        cmd.extend(["-o", output_file])
                
                cmd.append(sarif_file)
                
                clear_screen()
                print_logo()
                run_command(cmd, f"Deduplicating SARIF results (format: {output_format})")
                pause()
                
        elif choice == 2:
            clear_screen()
            print_logo()
            sarif_file = select_file_from_list("results", "*.sarif")
            if sarif_file:
                # Ask for format
                print(f"\n{YELLOW}Output format options:{NC}")
                print(f"  1. table - Human-readable table format (default)")
                print(f"  2. json - Structured JSON output")
                print(f"  3. csv - Comma-separated values")
                format_choice = input(f"\n{CYAN}Select format (1-3) [1]: {NC}").strip()
                
                format_map = {"1": "table", "2": "json", "3": "csv", "": "table"}
                output_format = format_map.get(format_choice, "table")
                
                # Ask for output destination
                print(f"\n{YELLOW}Output destination:{NC}")
                print(f"  1. Screen (default)")
                print(f"  2. File")
                output_choice = input(f"\n{CYAN}Select output (1-2) [1]: {NC}").strip()
                
                cmd = ["./scripts/sarif-analysis/parse-sarif-endpoints.sh", "-f", output_format]
                
                if output_choice == "2":
                    output_file = input(f"{CYAN}Enter output filename: {NC}").strip()
                    if output_file:
                        cmd.extend(["-o", output_file])
                
                cmd.append(sarif_file)
                
                clear_screen()
                print_logo()
                run_command(cmd, f"Parsing SARIF endpoints (format: {output_format})")
                pause()
                
        elif choice == 3:
            clear_screen()
            print_logo()
            sarif_file = select_file_from_list("results", "*.sarif")
            if sarif_file:
                # Ask for threshold
                print(f"\n{YELLOW}Priority threshold options:{NC}")
                print(f"  1. all - Show all priorities (default)")
                print(f"  2. critical - Critical issues only")
                print(f"  3. high - High and above")
                print(f"  4. medium - Medium and above")
                print(f"  5. low - Low and above")
                threshold_choice = input(f"\n{CYAN}Select threshold (1-5) [1]: {NC}").strip()
                
                threshold_map = {"1": "", "2": "critical", "3": "high", "4": "medium", "5": "low", "": ""}
                threshold = threshold_map.get(threshold_choice, "")
                
                # Ask for format
                print(f"\n{YELLOW}Output format options:{NC}")
                print(f"  1. table - Human-readable table format (default)")
                print(f"  2. markdown - Markdown format")
                print(f"  3. json - Structured JSON output")
                format_choice = input(f"\n{CYAN}Select format (1-3) [1]: {NC}").strip()
                
                format_map = {"1": "table", "2": "markdown", "3": "json", "": "table"}
                output_format = format_map.get(format_choice, "table")
                
                # Ask for output destination
                print(f"\n{YELLOW}Output destination:{NC}")
                print(f"  1. Screen (default)")
                print(f"  2. File")
                output_choice = input(f"\n{CYAN}Select output (1-2) [1]: {NC}").strip()
                
                cmd = ["./scripts/sarif-analysis/prioritize-threats.sh", "-f", output_format]
                
                if threshold:
                    cmd.extend(["--threshold", threshold])
                
                if output_choice == "2":
                    output_file = input(f"{CYAN}Enter output filename: {NC}").strip()
                    if output_file:
                        cmd.extend(["-o", output_file])
                
                cmd.append(sarif_file)
                
                clear_screen()
                print_logo()
                run_command(cmd, f"Prioritizing threats (threshold: {threshold or 'all'}, format: {output_format})")
                pause()
                
        elif choice == 4:
            clear_screen()
            print_logo()
            readme_path = Path("scripts/sarif-analysis/README.md")
            if readme_path.exists():
                run_command(["cat", str(readme_path)], "SARIF Analysis Documentation")
            else:
                print(f"{RED}Documentation not found.{NC}")
            pause()


def setup_menu():
    """Setup and Installation submenu"""
    while True:
        clear_screen()
        print_logo()
        
        options = [
            "Run Automated Setup",
            "Install CodeQL CLI",
            "Install Python Dependencies",
            "Check Prerequisites",
            "Show Setup Documentation"
        ]
        
        print_menu("Setup and Installation", options)
        choice = get_choice(len(options))
        
        if choice == 0:
            break
        elif choice == 1:
            clear_screen()
            print_logo()
            print(f"{YELLOW}Running automated setup...{NC}\n")
            run_command(["./setup.sh"], "Automated SpeQL setup")
            pause()
        elif choice == 2:
            clear_screen()
            print_logo()
            print(f"{YELLOW}Installing CodeQL CLI 2.20.2...{NC}\n")
            print("Manual installation required:")
            print("1. Download: https://github.com/github/codeql-cli-binaries/releases/tag/v2.20.2")
            print("2. Extract: unzip codeql-linux64.zip")
            print("3. Add to PATH: export PATH=\"$PATH:$(pwd)/codeql\"")
            pause()
        elif choice == 3:
            clear_screen()
            print_logo()
            print(f"{YELLOW}Installing Python dependencies...{NC}\n")
            req_file = Path("requirements.txt")
            if req_file.exists():
                run_command(["pip3", "install", "-r", "requirements.txt"], "Installing Python packages")
            else:
                print(f"{YELLOW}requirements.txt not found. Creating it...{NC}")
                run_command(["pip3", "install", "pyfiglet"], "Installing pyfiglet")
            pause()
        elif choice == 4:
            clear_screen()
            print_logo()
            print(f"{BOLD}Checking Prerequisites:{NC}\n")
            
            # Check Python
            python_ok = run_command(["python3", "--version"], "Checking Python 3")
            
            # Check git
            git_ok = run_command(["git", "--version"], "Checking Git")
            
            # Check CodeQL
            codeql_ok = run_command(["codeql", "version"], "Checking CodeQL CLI")
            
            # Check Java
            java_ok = run_command(["java", "-version"], "Checking Java")
            
            print(f"\n{BOLD}Summary:{NC}")
            print(f"  Python 3: {GREEN + 'OK' if python_ok else RED + 'FAIL'}{NC}")
            print(f"  Git: {GREEN + 'OK' if git_ok else RED + 'FAIL'}{NC}")
            print(f"  CodeQL: {GREEN + 'OK' if codeql_ok else RED + 'FAIL'}{NC}")
            print(f"  Java: {GREEN + 'OK' if java_ok else RED + 'FAIL'}{NC}")
            pause()
        elif choice == 5:
            clear_screen()
            print_logo()
            print(f"{BOLD}Setup Documentation:{NC}\n")
            print("For detailed setup instructions, see README.md")
            print("\nQuick Setup:")
            print("  1. Run: ./setup.sh")
            print("  2. Update database: python3 refresh_database.py")
            print("  3. Run analysis: python3 analyze.py")
            pause()


def documentation_menu():
    """Documentation and Help submenu"""
    while True:
        clear_screen()
        print_logo()
        
        options = [
            "View README",
            "View Quick Start Guide",
            "View Contributing Guidelines",
            "View Repository Structure",
            "List All Available Scripts",
            "Show Example Workflows"
        ]
        
        print_menu("Documentation and Help", options)
        choice = get_choice(len(options))
        
        if choice == 0:
            break
        elif choice == 1:
            clear_screen()
            print_logo()
            run_command(["cat", "README.md"], "README")
            pause()
        elif choice == 2:
            clear_screen()
            print_logo()
            quickstart_path = Path("docs/QUICKSTART.md")
            if quickstart_path.exists():
                run_command(["cat", str(quickstart_path)], "Quick Start Guide")
            else:
                print(f"{YELLOW}Quick Start guide not found in docs/.{NC}")
            pause()
        elif choice == 3:
            clear_screen()
            print_logo()
            run_command(["cat", "CONTRIBUTING.md"], "Contributing Guidelines")
            pause()
        elif choice == 4:
            clear_screen()
            print_logo()
            repo_struct_path = Path("docs/REPOSITORY_STRUCTURE.md")
            if repo_struct_path.exists():
                run_command(["cat", str(repo_struct_path)], "Repository Structure")
            else:
                print(f"{YELLOW}Repository structure guide not found.{NC}")
            pause()
        elif choice == 5:
            clear_screen()
            print_logo()
            print(f"{BOLD}Available Scripts:{NC}\n")
            print(f"{GREEN}Main Scripts:{NC}")
            print("  - analyze.py - Security analyzer (no dependencies)")
            print("  - refresh_database.py - Database refresh utility")
            print("  - run-queries.sh - CodeQL query runner")
            print("  - setup.sh - Automated setup script")
            print(f"\n{GREEN}SARIF Analysis Scripts:{NC}")
            print("  - scripts/sarif-analysis/deduplicate-by-product-operation.sh")
            print("  - scripts/sarif-analysis/parse-sarif-endpoints.sh")
            print("  - scripts/sarif-analysis/prioritize-threats.sh")
            print(f"\n{GREEN}Configuration:{NC}")
            print("  - config/SpeQL.yml - CodeQL database configuration")
            pause()
        elif choice == 6:
            clear_screen()
            print_logo()
            print(f"{BOLD}Example Workflows:{NC}\n")
            print(f"{CYAN}1. Initial Setup and Analysis:{NC}")
            print("   ./setup.sh")
            print("   python3 refresh_database.py")
            print("   python3 analyze.py")
            
            print(f"\n{CYAN}2. Analyze Specific Azure Service:{NC}")
            print("   python3 refresh_database.py --path specification/keyvault --fresh")
            print("   python3 analyze.py")
            
            print(f"\n{CYAN}3. Run CodeQL Queries:{NC}")
            print("   python3 refresh_database.py")
            print("   ./run-queries.sh")
            
            print(f"\n{CYAN}4. SARIF Threat Hunting:{NC}")
            print("   ./run-queries.sh")
            print("   ./scripts/sarif-analysis/deduplicate-by-product-operation.sh results/SasUriInResponse-results.sarif")
            print("   ./scripts/sarif-analysis/prioritize-threats.sh --threshold high results/SasUriInResponse-results.sarif")
            pause()


def main_menu():
    """Main menu"""
    while True:
        clear_screen()
        print_logo()
        
        options = [
            "Security Analysis",
            "Database Management",
            "CodeQL Security Queries",
            "SARIF Analysis Tools",
            "Setup and Installation",
            "Documentation and Help",
            "About SpeQL"
        ]
        
        print_menu("Main Menu", options, back_option=False)
        choice = get_choice(len(options))
        
        if choice == 0:
            clear_screen()
            print(f"{CYAN}Thank you for using SpeQL!{NC}")
            print(f"{YELLOW}Security Pattern Query Language for Azure APIs{NC}\n")
            sys.exit(0)
        elif choice == 1:
            analyze_menu()
        elif choice == 2:
            database_menu()
        elif choice == 3:
            codeql_menu()
        elif choice == 4:
            sarif_menu()
        elif choice == 5:
            setup_menu()
        elif choice == 6:
            documentation_menu()
        elif choice == 7:
            clear_screen()
            print_logo()
            print(f"{BOLD}About SpeQL{NC}\n")
            print("SpeQL is a security analysis tool that uses CodeQL to detect")
            print("vulnerabilities and misconfigurations in Azure REST API specifications.")
            print("\nIt specifically targets:")
            print("  - Azure Silent Reaper - Insecure Logic App triggers")
            print("  - Azure Vault Recon - Key Vault misconfigurations")
            print("  - Missing Access Control - API endpoints without authentication")
            print("  - Insecure Credentials - Hardcoded secrets and connection strings")
            print("  - SAS URI Exposure - Azure SAS tokens in API responses")
            print("\n" + "─" * 60)
            print("Repository: https://github.com/SpeQLSec/SpeQL")
            print("License: See LICENSE file")
            print("─" * 60)
            pause()


def main():
    """Main entry point"""
    try:
        # Check if we're in the right directory
        if not Path("analyze.py").exists():
            print(f"{RED}Error: Must be run from the SpeQL repository root directory.{NC}")
            sys.exit(1)
        
        # Check if pyfiglet is available
        if not HAS_FIGLET:
            print(f"{YELLOW}Note: pyfiglet not installed. Using simple ASCII logo.{NC}")
            print(f"{YELLOW}Install with: pip3 install pyfiglet{NC}")
            print(f"{YELLOW}Or run: pip3 install -r requirements.txt{NC}\n")
            input("Press Enter to continue...")
        
        main_menu()
    except KeyboardInterrupt:
        print(f"\n\n{YELLOW}Interrupted by user. Exiting...{NC}")
        sys.exit(0)
    except Exception as e:
        print(f"\n{RED}Unexpected error: {e}{NC}")
        sys.exit(1)


if __name__ == "__main__":
    main()
