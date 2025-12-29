# CodeQL Query Fixes - Summary

## Changes Made

### 1. Fixed Import Statements
**File: `queries/azure-security/SasUriInResponse.ql`**

Changed:
```ql
import semmle.javascript.JSON
```

To:
```ql
import javascript
```

**Reason**: For consistency with other queries in the repository and to use the modern import style. The `javascript` import includes all necessary JSON handling capabilities.

### 2. Updated Package Dependencies
**File: `queries/azure-security/qlpack.yml`**

Changed:
```yaml
dependencies:
  codeql/javascript-queries: '*'
```

To:
```yaml
dependencies:
  codeql/javascript-all: '*'
```

**Reason**: `codeql/javascript-all` is the correct library pack that contains all JavaScript/JSON analysis capabilities. The `codeql/javascript-queries` pack is for query suites, not library dependencies.

### 3. Recreated Lock File
**File: `queries/azure-security/codeql-pack.lock.yml`**

Recreated the lock file to reflect the updated dependencies. The lock file specifies exact versions of all transitive dependencies.

### 4. Enhanced Documentation
**File: `README.md`**

Added comprehensive troubleshooting section covering:
- SSL certificate errors during `codeql pack install`
- "token recognition error at: '?'" issues
- "Could not resolve library path" errors
- Manual installation alternatives

### 5. Improved Setup Script
**File: `setup.sh`**

Enhanced the setup script to:
- Detect SSL certificate errors during pack installation
- Automatically fall back to manual library download from GitHub
- Copy all required CodeQL libraries manually if `codeql pack install` fails
- Provide clear error messages and recovery suggestions

## Root Causes of Reported Errors

### 1. "Token Recognition Error at: '?'"
This error typically occurs when:
- CodeQL database is created with an incompatible version (2.23.x+) instead of 2.20.x
- JSON files in the database are malformed or contain unexpected characters
- Query syntax uses patterns that aren't properly escaped

**Our Fix**: Updated query imports and dependencies to ensure compatibility.

### 2. "Warnings Regarding CodeQL Library Location"
This occurs when:
- CodeQL cannot find required libraries in standard locations
- `codeql pack install` was not run or failed due to SSL issues
- CODEQL_DIST environment variable is not set for manual installations

**Our Fix**: 
- Updated qlpack.yml to use correct dependencies
- Enhanced setup script to handle SSL failures
- Added detailed documentation for manual setup

## Verification

All queries have been validated for:
- ✅ Correct `import javascript` statement
- ✅ Proper query structure (from, where, select)
- ✅ Required metadata (@name, @id, @description)
- ✅ Consistent code style across all queries

## Installation Instructions

### Recommended Approach
```bash
# Run the automated setup script
./setup.sh
```

The script now handles SSL certificate issues automatically.

### Manual Approach (if setup.sh fails)
```bash
# 1. Install CodeQL CLI
wget https://github.com/github/codeql-cli-binaries/releases/download/v2.20.2/codeql-linux64.zip
unzip codeql-linux64.zip
export PATH="$PATH:$(pwd)/codeql"

# 2. Try automatic pack installation
cd queries/azure-security
codeql pack install .

# 3. If SSL errors occur, manually download libraries
cd /tmp
wget https://github.com/github/codeql/archive/refs/heads/main.zip
unzip main.zip
mkdir -p ~/.codeql/packages/codeql/javascript-all/2.6.18
cp -r codeql-main/javascript/ql/lib/* ~/.codeql/packages/codeql/javascript-all/2.6.18/

# Copy shared libraries
for pack in concepts dataflow controlflow mad regex ssa threat-models tutorial typetracking util xml yaml; do
    VERSION=$(grep "^version:" "codeql-main/shared/$pack/qlpack.yml" | awk '{print $2}' | sed 's/-dev$//')
    mkdir -p ~/.codeql/packages/codeql/$pack/$VERSION
    cp -r codeql-main/shared/$pack/* ~/.codeql/packages/codeql/$pack/$VERSION/
done
```

## Testing

To test that queries compile correctly:
```bash
cd queries/azure-security
codeql query compile SasUriInResponse.ql
codeql query compile InsecureKeyVaultConfig.ql
codeql query compile InsecureLogicAppTrigger.ql
codeql query compile InsecureCredentials.ql
codeql query compile MissingAccessControl.ql
```

## Known Limitations

- CodeQL 2.20.x is required for JSON-only database support
- SSL certificate issues may occur in certain network environments
- Manual library installation may be needed in restricted environments

## Next Steps

Users should:
1. Run `./setup.sh` to install all dependencies
2. If SSL errors occur, the script will automatically attempt manual installation
3. Follow troubleshooting guide in README.md if issues persist
4. Run queries using `./run-queries.sh` after database is created
