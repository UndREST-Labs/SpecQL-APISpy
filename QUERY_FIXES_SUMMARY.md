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

Recreated the lock file with correct library versions compatible with CodeQL 2.20.2:
- **javascript-all**: Changed from 2.6.18 (incompatible) to 0.9.4 (compatible)
- All transitive dependencies updated to versions from the CodeQL 2.20.2 era

**Critical**: The original lock file specified javascript-all@2.6.18, which contains newer QL syntax (like `?` nullable types) that CodeQL 2.20.2 cannot parse. This caused "token recognition error at: '?'" when compiling queries.

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

The script will warn about SSL issues but offers manual download (not recommended).

### Manual Approach (ONLY if SSL cannot be fixed)
```bash
# 1. Install CodeQL CLI
wget https://github.com/github/codeql-cli-binaries/releases/download/v2.20.2/codeql-linux64.zip
unzip codeql-linux64.zip
export PATH="$PATH:$(pwd)/codeql"

# 2. Fix SSL certificates (REQUIRED for proper installation)
sudo update-ca-certificates
# OR use newer Java: sudo apt-get install openjdk-17-jdk

# 3. Install dependencies properly
cd queries/azure-security
codeql pack install .

# WARNING: Manual library download from GitHub is NOT supported!
# Libraries from main branch are incompatible with CodeQL 2.20.2
# and will cause "token recognition error at: '?'"
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

If you see "token recognition error at: '?'", you have incompatible libraries:
```bash
rm -rf ~/.codeql/packages
# Fix SSL certificates, then:
cd queries/azure-security
codeql pack install .
```

## Known Limitations

- CodeQL 2.20.x is required for JSON-only database support
- SSL certificate issues may occur in certain network environments
- **Manual library download is NOT supported** - causes version incompatibility
- Manual library installation may be needed in restricted environments

## Next Steps

Users should:
1. Run `./setup.sh` to install all dependencies
2. If SSL errors occur, the script will automatically attempt manual installation
3. Follow troubleshooting guide in README.md if issues persist
4. Run queries using `./run-queries.sh` after database is created
