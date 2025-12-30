#!/usr/bin/env bash

# Set CodeQL environment variable to suppress installation path warnings
if [ -z "${CODEQL_ALLOW_INSTALLATION_ANYWHERE:-}" ]; then
    export CODEQL_ALLOW_INSTALLATION_ANYWHERE=true
fi

# SpeQL - Security Query Runner for Azure APIs
# This script runs CodeQL security queries against Azure REST API specifications

set -euo pipefail

# Configuration
DATABASE_PATH="database/azure-api-db"
QUERIES_PATH="queries/azure-security"
RESULTS_PATH="results"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load memory management utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/utils/memory_utils.sh" ]; then
    source "$SCRIPT_DIR/utils/memory_utils.sh"
fi

# Print banner
echo "═══════════════════════════════════════════════════════════"
echo "  SpeQL - Azure Security Query Analyzer"
echo "  Detecting Azure Silent Reaper & Vault Recon vulnerabilities"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check if CodeQL is installed
if ! command -v codeql &> /dev/null; then
    echo -e "${RED}Error: CodeQL is not installed or not in PATH${NC}"
    echo "Please install CodeQL from: https://github.com/github/codeql-cli-binaries"
    exit 1
fi

# Determine CodeQL search path for library resolution
# NOTE: If you used 'codeql pack install' in queries/azure-security/, 
# CodeQL will automatically find dependencies in ~/.codeql/packages/
# This search path detection is for backward compatibility with manual installations
SEARCH_PATH=""

# Priority 1: CODEQL_DIST environment variable (user override)
if [ -n "${CODEQL_DIST:-}" ] && [ -d "$CODEQL_DIST" ]; then
    SEARCH_PATH="--search-path=$CODEQL_DIST"
    echo -e "${GREEN}Using CodeQL libraries from CODEQL_DIST: $CODEQL_DIST${NC}"
# Priority 2: Check for downloaded pack location (from codeql pack download)
# The structure is: codeql/javascript/codeql/javascript-queries/VERSION/.codeql/libraries/
elif [ -d "codeql/javascript/codeql/javascript-queries" ]; then
    # Find the downloaded javascript-queries pack version directory and use its .codeql/libraries subdirectory
    PACK_VERSION=$(find codeql/javascript/codeql/javascript-queries -maxdepth 1 -type d -name "*.*.*" 2>/dev/null | head -n 1)
    if [ -n "$PACK_VERSION" ] && [ -d "$PACK_VERSION/.codeql/libraries" ]; then
        # Use the libraries directory within the downloaded pack
        SEARCH_PATH="--search-path=$(pwd)/$PACK_VERSION/.codeql/libraries"
        echo -e "${GREEN}Using CodeQL libraries from downloaded pack: $(pwd)/$PACK_VERSION/.codeql/libraries${NC}"
    else
        # Fallback to the codeql directory itself
        SEARCH_PATH="--search-path=$(pwd)/codeql/javascript/codeql"
        echo -e "${YELLOW}Using CodeQL pack directory (libraries may not be found): $(pwd)/codeql/javascript/codeql${NC}"
    fi
# Priority 3: CodeQL binary installation location
elif command -v codeql &> /dev/null; then
    CODEQL_PATH=$(dirname "$(dirname "$(which codeql)")")
    if [ -d "$CODEQL_PATH" ] && [ -d "$CODEQL_PATH/javascript" ]; then
        SEARCH_PATH="--search-path=$CODEQL_PATH"
        echo -e "${GREEN}Using CodeQL libraries from: $CODEQL_PATH${NC}"
    fi
# Priority 4: Local codeql directory
elif [ -d "codeql" ] && [ -d "codeql/javascript" ]; then
    SEARCH_PATH="--search-path=$(pwd)/codeql"
    echo -e "${GREEN}Using CodeQL libraries from local directory: $(pwd)/codeql${NC}"
fi

# If still no search path found, warn user
if [ -z "$SEARCH_PATH" ]; then
    echo -e "${YELLOW}Warning: Could not detect CodeQL library location.${NC}"
    echo -e "${YELLOW}Please set CODEQL_DIST environment variable or ensure libraries are installed.${NC}"
    echo -e "${YELLOW}See README.md for installation instructions.${NC}"
fi

# Check if database exists
if [ ! -d "$DATABASE_PATH" ]; then
    echo -e "${RED}Error: Database not found at $DATABASE_PATH${NC}"
    exit 1
fi

# Dynamic Memory Management
# Calculate memory limit based on database size (>50K JSON files)
# Memory limit is set to 90% of total system memory when threshold is met
# Can be overridden with CODEQL_MEMORY_LIMIT environment variable
MEMORY_OPTION=""

# Check for user-specified memory limit first
if [ -n "${CODEQL_MEMORY_LIMIT:-}" ]; then
    MEMORY_OPTION="--mem=$CODEQL_MEMORY_LIMIT"
    echo -e "${GREEN}Using custom memory limit: ${CODEQL_MEMORY_LIMIT} MB (from CODEQL_MEMORY_LIMIT)${NC}"
elif type get_memory_setting &>/dev/null; then
    MEMORY_LIMIT=$(get_memory_setting "$DATABASE_PATH" 50000)
    
    if [ -n "$MEMORY_LIMIT" ] && [ "$MEMORY_LIMIT" -gt 0 ]; then
        MEMORY_OPTION="--mem=$MEMORY_LIMIT"
        echo -e "${GREEN}Applying dynamic memory limit: ${MEMORY_LIMIT} MB${NC}"
        
        # Show memory configuration info
        if type print_memory_info &>/dev/null; then
            print_memory_info "$DATABASE_PATH" "$NC" "$BLUE" "$YELLOW" "$GREEN"
            echo ""
        fi
    else
        echo -e "${BLUE}Using default memory settings (database < 50K JSON files)${NC}"
    fi
else
    echo -e "${YELLOW}Memory utilities not available, using default settings${NC}"
fi

# Create results directory
mkdir -p "$RESULTS_PATH"

# List of queries to run
QUERIES=(
#    "InsecureLogicAppTrigger.ql"
#    "InsecureKeyVaultConfig.ql"
#    "MissingAccessControl.ql"
#    "InsecureCredentials.ql"
    "SasUriInResponse.ql"
)

echo -e "${GREEN}Running security queries...${NC}\n"

# Run each query
total_issues=0
for query in "${QUERIES[@]}"; do
    query_name=$(basename "$query" .ql)
    echo -e "${YELLOW}► Running: $query_name${NC}"
    
    output_file="$RESULTS_PATH/${query_name}-results.sarif"
    
    # Run the query
    # Apply memory limit option if available (for databases with >50K JSON files)
    error_log="$RESULTS_PATH/${query_name}-errors.log"
    if codeql database analyze "$DATABASE_PATH" \
        "$QUERIES_PATH/$query" \
        --format=sarif-latest \
        --output="$output_file" \
        $SEARCH_PATH \
        $MEMORY_OPTION \
        --rerun 2>"$error_log"; then
        
        # Count issues found
        if [ -f "$output_file" ]; then
            issues=$(grep -o '"ruleId":' "$output_file" | wc -l 2>/dev/null || echo "0")
            total_issues=$((total_issues + issues))
            
            if [ "$issues" -gt 0 ]; then
                echo -e "  ${RED}✗ Found $issues issue(s)${NC}"
            else
                echo -e "  ${GREEN}✓ No issues found${NC}"
            fi
        fi
    else
        echo -e "  ${YELLOW}⚠ Query completed with warnings/errors${NC}"
        if [ -f "$error_log" ] && [ -s "$error_log" ]; then
            echo -e "  ${YELLOW}Error details:${NC}"
            cat "$error_log" | head -20
        fi
    fi
    
    echo ""
done

# Summary
echo "═══════════════════════════════════════════════════════════"
echo -e "${GREEN}Analysis complete!${NC}"
echo "Total security issues found: $total_issues"
echo "Results saved to: $RESULTS_PATH/"
echo "═══════════════════════════════════════════════════════════"

# Exit with error code if issues found
if [ "$total_issues" -gt 0 ]; then
    exit 1
fi

exit 0
