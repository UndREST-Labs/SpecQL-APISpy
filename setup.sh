#!/bin/bash

# SpeQL Setup Script
# This script automates the installation and configuration of SpeQL

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         SpeQL - Security Query Language Setup             ║${NC}"
echo -e "${GREEN}║              Azure API Security Analysis Tool             ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Step 1: Check and install JDK
echo -e "${YELLOW}Step 1: Checking Java Development Kit (JDK)...${NC}"
if command_exists java; then
    JAVA_VERSION=$(java -version 2>&1 | head -n 1)
    echo -e "${GREEN}✓ Java is already installed: ${JAVA_VERSION}${NC}"
else
    echo -e "${YELLOW}Java not found. Installing OpenJDK 11...${NC}"
    if command_exists apt-get; then
        sudo apt-get update
        sudo apt-get install -y openjdk-11-jdk
        echo -e "${GREEN}✓ OpenJDK 11 installed successfully${NC}"
    else
        echo -e "${RED}✗ apt-get not found. Please install JDK 11 or newer manually.${NC}"
        exit 1
    fi
fi
echo

# Step 2: Download and install CodeQL CLI 2.20.2
echo -e "${YELLOW}Step 2: Installing CodeQL CLI 2.20.2...${NC}"
if command_exists codeql; then
    CODEQL_VERSION=$(codeql version 2>&1 | head -n 1)
    echo -e "${GREEN}✓ CodeQL is already installed: ${CODEQL_VERSION}${NC}"
else
    echo -e "${YELLOW}Downloading CodeQL CLI 2.20.2...${NC}"
    
    # Create a temporary directory for download
    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"
    
    # Download CodeQL
    wget -q https://github.com/github/codeql-cli-binaries/releases/download/v2.20.2/codeql-linux64.zip
    
    # Extract to user's home directory
    unzip -q codeql-linux64.zip
    
    # Move to a permanent location
    if [ -d "$HOME/codeql" ]; then
        echo -e "${YELLOW}Removing existing ~/codeql directory...${NC}"
        rm -rf "$HOME/codeql"
    fi
    
    mv codeql "$HOME/"
    
    # Add to PATH in current session
    export PATH="$PATH:$HOME/codeql"
    
    # Add to user's shell profile
    SHELL_PROFILE=""
    if [ -f "$HOME/.bashrc" ]; then
        SHELL_PROFILE="$HOME/.bashrc"
    elif [ -f "$HOME/.bash_profile" ]; then
        SHELL_PROFILE="$HOME/.bash_profile"
    elif [ -f "$HOME/.zshrc" ]; then
        SHELL_PROFILE="$HOME/.zshrc"
    fi
    
    if [ -n "$SHELL_PROFILE" ]; then
        # Check if PATH already contains codeql
        if ! grep -q "export PATH.*codeql" "$SHELL_PROFILE"; then
            echo 'export PATH="$PATH:$HOME/codeql"' >> "$SHELL_PROFILE"
            echo -e "${GREEN}✓ Added CodeQL to PATH in ${SHELL_PROFILE}${NC}"
        fi
    fi
    
    # Clean up
    cd - > /dev/null
    rm -rf "$TEMP_DIR"
    
    echo -e "${GREEN}✓ CodeQL CLI 2.20.2 installed successfully${NC}"
    echo -e "${YELLOW}  Note: You may need to restart your shell or run: source ${SHELL_PROFILE}${NC}"
fi
echo

# Step 3: Install query pack dependencies
echo -e "${YELLOW}Step 3: Installing CodeQL query pack dependencies...${NC}"
if [ -d "queries/azure-security" ]; then
    cd queries/azure-security
    
    echo -e "${YELLOW}Running: codeql pack install .${NC}"
    if codeql pack install . 2>&1 | tee /tmp/pack_install.log; then
        cd ../..
        echo -e "${GREEN}✓ Query pack dependencies installed successfully${NC}"
        echo -e "${GREEN}  Dependencies installed to: ~/.codeql/packages/${NC}"
    else
        # Check if the error is due to SSL certificate issues
        if grep -q "SunCertPathBuilderException\|SSL\|certificate" /tmp/pack_install.log; then
            echo -e "${YELLOW}⚠ SSL certificate error detected during pack installation${NC}"
            echo -e "${YELLOW}  This is a known issue with certain network configurations.${NC}"
            echo
            echo -e "${YELLOW}Attempting alternative installation method...${NC}"
            
            # Create a temporary directory for manual download
            TEMP_DIR=$(mktemp -d)
            cd "$TEMP_DIR"
            
            echo -e "${YELLOW}Downloading CodeQL libraries manually...${NC}"
            if wget -q https://github.com/github/codeql/archive/refs/heads/main.zip 2>/dev/null; then
                unzip -q main.zip
                
                # Create package directories
                mkdir -p ~/.codeql/packages/codeql/javascript-all/2.6.18
                mkdir -p ~/.codeql/packages/codeql/{concepts,dataflow,controlflow,mad,regex,ssa,threat-models,tutorial,typetracking,util,xml,yaml}
                
                # Copy JavaScript libraries
                cp -r codeql-main/javascript/ql/lib/* ~/.codeql/packages/codeql/javascript-all/2.6.18/
                
                # Copy shared libraries
                for pack in concepts dataflow controlflow mad regex ssa threat-models tutorial typetracking util xml yaml; do
                    if [ -d "codeql-main/shared/$pack" ]; then
                        VERSION=$(grep "^version:" "codeql-main/shared/$pack/qlpack.yml" | awk '{print $2}' | sed 's/-dev$//')
                        mkdir -p ~/.codeql/packages/codeql/$pack/$VERSION
                        cp -r codeql-main/shared/$pack/* ~/.codeql/packages/codeql/$pack/$VERSION/
                    fi
                done
                
                cd -
                rm -rf "$TEMP_DIR"
                
                echo -e "${GREEN}✓ CodeQL libraries installed manually${NC}"
                echo -e "${GREEN}  Alternative installation completed successfully${NC}"
            else
                echo -e "${RED}✗ Failed to download CodeQL libraries${NC}"
                echo -e "${YELLOW}  Please check your internet connection and try again${NC}"
                echo -e "${YELLOW}  Or manually download from: https://github.com/github/codeql${NC}"
                cd ../..
                exit 1
            fi
            cd ../..
        else
            echo -e "${RED}✗ Pack installation failed with unexpected error${NC}"
            cat /tmp/pack_install.log
            cd ../..
            exit 1
        fi
    fi
else
    echo -e "${RED}✗ queries/azure-security directory not found${NC}"
    echo -e "${RED}  Please run this script from the SpeQL repository root${NC}"
    exit 1
fi
echo

# Step 4: Verify installation
echo -e "${YELLOW}Step 4: Verifying installation...${NC}"

# Check CodeQL version
echo -e "${YELLOW}CodeQL version:${NC}"
codeql version

# Check if JavaScript libraries are installed
echo
echo -e "${YELLOW}Checking installed CodeQL packages:${NC}"
if [ -d "$HOME/.codeql/packages/codeql/javascript-all" ]; then
    INSTALLED_VERSION=$(ls "$HOME/.codeql/packages/codeql/javascript-all" | head -n 1)
    echo -e "${GREEN}✓ codeql/javascript-all installed: version ${INSTALLED_VERSION}${NC}"
else
    echo -e "${RED}✗ codeql/javascript-all not found${NC}"
fi

# Check for qlpack.lock.yml
if [ -f "queries/azure-security/qlpack.lock.yml" ]; then
    echo -e "${GREEN}✓ Pack dependencies resolved (qlpack.lock.yml created)${NC}"
else
    echo -e "${YELLOW}⚠ qlpack.lock.yml not found${NC}"
fi

echo
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Setup Complete!                              ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo
echo -e "${GREEN}You can now run SpeQL with:${NC}"
echo -e "  ${YELLOW}./run-queries.sh${NC}          # Run CodeQL security queries"
echo -e "  ${YELLOW}python3 analyze.py${NC}        # Run Python analyzer (no dependencies!)"
echo
echo -e "${GREEN}To analyze different Azure services:${NC}"
echo -e "  ${YELLOW}./refresh-database.sh --path specification/keyvault${NC}"
echo -e "  ${YELLOW}./refresh-database.sh --path specification/compute${NC}"
echo
