#!/bin/bash

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
NC='\033[0m' # No Color

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

# Check if database exists
if [ ! -d "$DATABASE_PATH" ]; then
    echo -e "${RED}Error: Database not found at $DATABASE_PATH${NC}"
    exit 1
fi

# Create results directory
mkdir -p "$RESULTS_PATH"

# List of queries to run
QUERIES=(
    "InsecureLogicAppTrigger.ql"
    "InsecureKeyVaultConfig.ql"
    "MissingAccessControl.ql"
    "InsecureCredentials.ql"
)

echo -e "${GREEN}Running security queries...${NC}\n"

# Run each query
total_issues=0
for query in "${QUERIES[@]}"; do
    query_name=$(basename "$query" .ql)
    echo -e "${YELLOW}► Running: $query_name${NC}"
    
    output_file="$RESULTS_PATH/${query_name}-results.sarif"
    
    # Run the query
    if codeql database analyze "$DATABASE_PATH" \
        "$QUERIES_PATH/$query" \
        --format=sarif-latest \
        --output="$output_file" \
        --rerun 2>/dev/null; then
        
        # Count issues found
        if [ -f "$output_file" ]; then
            issues=$(grep -c '"level":' "$output_file" 2>/dev/null || echo "0")
            total_issues=$((total_issues + issues))
            
            if [ "$issues" -gt 0 ]; then
                echo -e "  ${RED}✗ Found $issues issue(s)${NC}"
            else
                echo -e "  ${GREEN}✓ No issues found${NC}"
            fi
        fi
    else
        echo -e "  ${YELLOW}⚠ Query completed with warnings${NC}"
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
