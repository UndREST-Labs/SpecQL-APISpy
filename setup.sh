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
    codeql pack install .
    
    cd ../..
    echo -e "${GREEN}✓ Query pack dependencies installed successfully${NC}"
    echo -e "${GREEN}  Dependencies installed to: ~/.codeql/packages/${NC}"
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
