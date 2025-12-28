# SpeQL - Security Query Language for Azure APIs

SpeQL is a security analysis tool that uses CodeQL to detect vulnerabilities and misconfigurations in Azure REST API specifications. It is specifically designed to identify issues similar to those described in the Azure Silent Reaper and Azure Vault Recon vulnerabilities.

## Overview

This tool analyzes Azure REST API specification files (Swagger/OpenAPI) to detect:

- **Azure Silent Reaper**: Insecure Logic App trigger configurations that allow unauthorized workflow execution
- **Azure Vault Recon**: Key Vault misconfigurations enabling unauthorized secret enumeration or access
- **Missing Access Control**: API endpoints lacking proper authentication/authorization
- **Insecure Credentials**: Hardcoded secrets and connection strings that should use Key Vault
- **SAS URI Exposure**: Azure Shared Access Signature tokens exposed in API responses

## Vulnerabilities Detected

### 1. Insecure Logic App Trigger (Azure Silent Reaper)

Detects Logic App HTTP triggers that can be invoked without authentication:
- Missing authentication configuration
- Weak authentication (None/Anonymous)
- Public HTTP endpoints without access control

**CWE References**: CWE-306 (Missing Authentication), CWE-862 (Missing Authorization)

### 2. Insecure Key Vault Configuration (Azure Vault Recon)

Identifies Key Vault misconfigurations that expose secrets:
- Missing network restrictions
- Public network access enabled
- Overly permissive access policies
- Embedded secrets instead of Key Vault references

**CWE References**: CWE-284 (Improper Access Control), CWE-522 (Insufficiently Protected Credentials)

### 3. Missing Access Control

Finds API endpoints without proper security:
- Sensitive operations (DELETE, CREATE, UPDATE) without authentication
- Endpoints with empty security arrays
- Public workflow access without restrictions

**CWE References**: CWE-284, CWE-862

### 4. Insecure Credentials

Locates hardcoded credentials and secrets:
- Connection strings with embedded passwords
- Hardcoded API keys and secrets
- Basic authentication with visible passwords
- Secure strings with default values

**CWE References**: CWE-798 (Hardcoded Credentials), CWE-259 (Hard-coded Password)

### 5. SAS URI Exposure in API Responses

Detects Azure Shared Access Signature (SAS) URIs exposed in API responses:
- SAS tokens in response bodies (inputsLink, outputsLink, etc.)
- URIs containing signature parameters (sig, se, sp, sv)
- Control-plane APIs exposing data-plane access credentials
- Data exfiltration risks through exposed SAS tokens

**Security Impact**: SAS URIs grant time-limited access to Azure resources. When exposed in control-plane API responses, they can enable unauthorized data-plane access and data exfiltration.

**CWE References**: CWE-200 (Exposure of Sensitive Information), CWE-359 (Exposure of Private Personal Information)

## Repository Structure

```
SpeQL/
├── README.md                    # This file
├── analyze.py                   # Python-based security analyzer (no dependencies!)
├── run-queries.sh              # CodeQL query execution script
├── config/
│   └── SpeQL.yml               # CodeQL database configuration
├── database/
│   └── azure-api-db/           # CodeQL database of Azure API specs
├── queries/
│   └── azure-security/         # Security query suite (CodeQL)
│       ├── InsecureLogicAppTrigger.ql
│       ├── InsecureKeyVaultConfig.ql
│       ├── MissingAccessControl.ql
│       ├── InsecureCredentials.ql
│       └── SasUriInResponse.ql
└── results/                    # Analysis results (generated)
```

## Installation

### Prerequisites

1. **Java Development Kit (JDK)**: CodeQL requires a Java Runtime Environment (JRE) or Java Development Kit (JDK) to run.
   
   ```bash
   # Install OpenJDK (Ubuntu/Debian)
   sudo apt-get update
   sudo apt-get install openjdk-11-jdk
   
   # Or use a newer version
   sudo apt-get install openjdk-17-jdk
   
   # Verify installation
   java -version
   ```
   
   **Note**: CodeQL 2.20.x works with JDK 11 or newer. Most systems will work with OpenJDK 11, 17, or 21.

2. **CodeQL CLI with JavaScript Libraries** (Version 2.20.x required): Install CodeQL and download the JavaScript query pack.
   
   **Important**: 
   - CodeQL version 2.23.x and newer have compatibility issues with JSON-only database creation. Use version 2.20.1 or 2.20.2.
   - You need the **CodeQL libraries**, which can be obtained using `codeql pack download`.
   
   **Installation Options:**
   
   **Option A: Using codeql pack download (Recommended for local setup)**
   ```bash
   # 1. Install CodeQL CLI 2.20.2
   wget https://github.com/github/codeql-cli-binaries/releases/download/v2.20.2/codeql-linux64.zip
   unzip codeql-linux64.zip
   export PATH="$PATH:$(pwd)/codeql"
   
   # 2. Download JavaScript query pack with all dependencies
   # This downloads the pack and all its library dependencies
   codeql pack download codeql/javascript-queries --dir codeql/javascript/
   
   # 3. Verify installation
   codeql version
   ls codeql/javascript/codeql/javascript-queries/*/
   
   # 4. The run-queries.sh script will automatically detect the libraries
   #    No additional configuration needed!
   ./run-queries.sh
   ```
   
   The `codeql pack download` command will download:
   - The JavaScript query pack with proper qlpack.yml configuration
   - All dependent libraries including `codeql/javascript-all` in a `.codeql/libraries/` subdirectory
   - Pre-compiled query suites
   
   **Option B: Use Docker (Easiest - No Manual Setup Required)**
   See [Docker Installation](#docker-installation) section below for a pre-configured environment with everything included.
   
   **Verification:**
   ```bash
   # Verify CodeQL version
   codeql version
   
   # Verify libraries are present
   ls codeql/javascript/codeql/javascript-queries/*/
   
   # Check that the downloaded library structure exists
   find codeql/javascript/codeql -name "*.qll" -path "*/.codeql/libraries/*" | head -5
   
   # Run the queries - the script auto-detects the library location
   ./run-queries.sh
   ```
   
   **Note**: The downloaded pack will be in a nested structure like:
   ```
   codeql/javascript/codeql/javascript-queries/<version>/.codeql/libraries/codeql/javascript-all/<version>/
   ```
   
   The `run-queries.sh` script **automatically detects this location** and configures the search path appropriately. You can also manually set `CODEQL_DIST` to point to the `.codeql/libraries` directory if needed:
   ```bash
   # Optional manual override (usually not needed)
   PACK_VERSION=$(ls codeql/javascript/codeql/javascript-queries/)
   export CODEQL_DIST=$(pwd)/codeql/javascript/codeql/javascript-queries/$PACK_VERSION/.codeql/libraries
   ```

2. **Azure REST API Specifications**: The database should contain Azure API specs from the [azure-rest-api-specs](https://github.com/Azure/azure-rest-api-specs) repository. This is automatically handled by the database refresh scripts.

### Docker Installation

SpeQL provides Docker images for both x86_64 (standard Intel/AMD) and ARM64 architectures, making it easy to run on various platforms including standard servers, Raspberry Pi, Apple Silicon Macs, and other ARM-based systems.

**For detailed Docker instructions, see [DOCKER.md](./DOCKER.md)**

#### Building the Docker Image

**Standard x86_64/amd64 (Intel/AMD processors):**
```bash
# Build the standard Docker image
docker build -t speql:latest .
```

**ARM64 (Raspberry Pi, Apple Silicon, etc.):**
```bash
# Build the ARM64 Docker image
docker build -f Dockerfile.arm64 -t speql:arm64 .
```

**Cross-platform build from x86_64 to ARM64:**
```bash
# Enable buildx for multi-platform builds
docker buildx create --use

# Build for ARM64 platform
docker buildx build --platform linux/arm64 -f Dockerfile.arm64 -t speql:arm64 --load .
```

**Note**: Cross-platform builds may take significantly longer due to emulation.

**Using Docker Compose:**
```bash
# Build and run the standard x86_64 service
docker-compose up speql

# Build and run the ARM64 service
docker-compose up speql-arm64

# Run in detached mode
docker-compose up -d speql

# View logs
docker-compose logs -f

# Stop and remove containers
docker-compose down
```

#### Running SpeQL in Docker

**Quick Start - Run the Python Analyzer:**
```bash
# x86_64 version
docker run --rm -v $(pwd)/results:/speql/results speql:latest python3 analyze.py

# ARM64 version
docker run --rm -v $(pwd)/results:/speql/results speql:arm64 python3 analyze.py
```

**Refresh the Database:**
```bash
# x86_64 version
docker run --rm -v $(pwd)/results:/speql/results speql:latest ./refresh-database.sh

# ARM64 version
docker run --rm -v $(pwd)/results:/speql/results speql:arm64 ./refresh-database.sh
```

**Run CodeQL Queries:**
```bash
# x86_64 version
docker run --rm -v $(pwd)/results:/speql/results speql:latest ./run-queries.sh

# ARM64 version
docker run --rm -v $(pwd)/results:/speql/results speql:arm64 ./run-queries.sh
```

**Interactive Shell:**
```bash
# x86_64 version
docker run --rm -it speql:latest /bin/bash

# ARM64 version
docker run --rm -it speql:arm64 /bin/bash
```

#### Docker Volume Mounts

- `/speql/results` - Mount this to save analysis results to your host system
- `/speql/azure-rest-api-specs` - Mount this if you want to use external Azure specs

**Example with external specs:**
```bash
docker run --rm \
  -v $(pwd)/results:/speql/results \
  -v $(pwd)/azure-rest-api-specs:/speql/azure-rest-api-specs \
  speql:arm64 python3 analyze.py
```

#### System Requirements

- **Docker** installed and running
- **Architecture**: ARM64/aarch64 (Raspberry Pi 3+, Apple Silicon, AWS Graviton, etc.)
- **Memory**: Minimum 2GB RAM recommended
- **Storage**: At least 2GB free disk space

### Refreshing the Database

The repository includes scripts to build and refresh the database directly from the Azure REST API specifications:

#### Using the Bash Script (Linux/Mac):
```bash
# Update repository and rebuild database (default: Logic Apps specs)
./refresh-database.sh

# Fresh clone and rebuild
./refresh-database.sh --fresh

# Build database for specific Azure service (e.g., Key Vault)
./refresh-database.sh --path specification/keyvault

# Build database for all Azure specifications
./refresh-database.sh --all

# Just update the repo without rebuilding
./refresh-database.sh --skip-db-build
```

#### Using the Python Script (Cross-platform):
```bash
# Update repository and rebuild database
python3 refresh_database.py

# Fresh clone and rebuild
python3 refresh_database.py --fresh

# Build for specific service
python3 refresh_database.py --path specification/compute

# Build for all specifications
python3 refresh_database.py --all
```

**Note**: Building the database requires CodeQL CLI to be installed. To only update the repository without rebuilding, use the `--skip-db-build` flag.

## Usage

### Quick Start with Python Analyzer

The easiest way to run the security analysis is using the Python-based analyzer:

```bash
python3 analyze.py
```

This will:
1. Automatically extract Azure API specifications from the database
2. Analyze all JSON files for security vulnerabilities
3. Display a detailed report of issues found
4. Exit with code 1 if issues are found (useful for CI/CD)

**No additional dependencies required!** The Python analyzer works out of the box.

### Analyzing Different Scopes

The analyzer supports multiple modes for different use cases:

#### Default Mode: Database Analysis
```bash
# Analyze from pre-built database (fastest, ~309 files for Logic Apps)
python3 analyze.py

# Verbose mode shows file counts and available alternatives
python3 analyze.py --verbose
```

#### Direct Repository Analysis
```bash
# Analyze from full azure-rest-api-specs repository (~253,543 files)
python3 analyze.py --source azure-rest-api-specs/specification

# Analyze specific Azure service
python3 analyze.py --source azure-rest-api-specs/specification/keyvault
python3 analyze.py --source azure-rest-api-specs/specification/compute

# Analyze custom directory
python3 analyze.py --source /path/to/custom/specs
```

**Note**: To analyze the full repository, first clone it:
```bash
python3 refresh_database.py --all --skip-db-build
```

#### When to Use Each Mode

- **Database Mode** (default): Fast analysis of specific service (Logic Apps by default)
- **Full Repository**: Comprehensive security audit of all Azure services
- **Specific Service**: Focused analysis of one Azure service (Key Vault, Compute, etc.)
- **Custom Directory**: Analyze your own API specifications

See `ANALYSIS_JSON_FILE_COUNT.md` for detailed information about file counts and performance considerations.

### Advanced: Using CodeQL Queries

For more advanced analysis with CodeQL (requires CodeQL CLI):

#### Building Database for CodeQL Analysis

**Important**: CodeQL queries run against the database. To analyze different Azure services with CodeQL, build the database with the desired path first:

```bash
# Build database with Key Vault specs
python3 refresh_database.py --path specification/keyvault --fresh

# Build database with all Azure specs (comprehensive analysis)
python3 refresh_database.py --all --fresh

# Build database with specific service (Compute, Storage, etc.)
python3 refresh_database.py --path specification/compute --fresh
```

After building the database, run CodeQL queries against it:

#### Run All Queries:
```bash
./run-queries.sh
```

This will:
1. Run all security queries against the Azure API database
2. Generate SARIF format results in the `results/` directory
3. Display a summary of issues found

#### Run Individual Queries:
```bash
codeql database analyze database/azure-api-db \
    queries/azure-security/InsecureLogicAppTrigger.ql \
    --format=sarif-latest \
    --output=results/InsecureLogicAppTrigger.sarif
```

#### Complete Workflow Example

```bash
# 1. Build database with Key Vault specifications
python3 refresh_database.py --path specification/keyvault --fresh

# 2. Run CodeQL queries against the database
./run-queries.sh

# 3. (Optional) Run Python analyzer on the same scope
python3 analyze.py
```

### Viewing Results

Results from the Python analyzer are displayed in the console with colored output.

Results from CodeQL are saved in SARIF format (Static Analysis Results Interchange Format) and can be:
- Viewed in VS Code with the SARIF Viewer extension
- Uploaded to GitHub Advanced Security
- Processed with SARIF tools

## Database Management

### Building and Refreshing the Database

The SpeQL database can be built directly from the [Azure/azure-rest-api-specs](https://github.com/Azure/azure-rest-api-specs) repository using either the bash or Python refresh scripts.

#### Refresh Script Options

Both `refresh-database.sh` and `refresh_database.py` support the following options:

- `--fresh` or `-f`: Perform a fresh clone of the Azure repository (removes existing)
- `--update` or `-u`: Update existing repository clone (default)
- `--path PATH` or `-p PATH`: Specify which Azure service specifications to include
  - Examples: `specification/logic`, `specification/keyvault`, `specification/compute`
  - Default: `specification/logic` (Logic Apps)
- `--all` or `-a`: Include all Azure service specifications
- `--branch BRANCH` or `-b BRANCH`: Specify which branch to use (default: main)
- `--skip-db-build`: Only clone/update the repository without rebuilding the database
- `--clean`: Clean existing database before rebuild
- `--help` or `-h`: Show help message

#### Common Workflows

**Initial Setup:**
```bash
# Clone Azure specs and build database for Logic Apps
./refresh-database.sh
```

**Regular Updates:**
```bash
# Update to latest specs and rebuild
./refresh-database.sh --update
```

**Analyze Different Azure Services:**
```bash
# Build database for Key Vault APIs
./refresh-database.sh --path specification/keyvault --fresh

# Build database for multiple services
./refresh-database.sh --path specification/compute --fresh
```

**Working with Limited Resources:**
```bash
# Just update the repository without rebuilding (no CodeQL needed)
./refresh-database.sh --skip-db-build

# Build database later when CodeQL is available
./refresh-database.sh
```

**Comprehensive Analysis:**
```bash
# Build database with all Azure specifications (may take significant time/space)
./refresh-database.sh --all --fresh
```

#### Database Structure

After running the refresh script, the database structure will be:

```
database/azure-api-db/
├── codeql-database.yml    # Database metadata
├── src.zip                # Zipped source files (for analyze.py)
├── src/                   # Extracted source files
├── db-javascript/         # CodeQL database files
├── log/                   # Build logs
└── diagnostic/            # Diagnostic information
```

#### Troubleshooting

**Issue: CodeQL not found**
- Install CodeQL CLI from [GitHub releases](https://github.com/github/codeql-cli-binaries/releases)
- Add to PATH: `export PATH="$PATH:/path/to/codeql"`
- Or use `--skip-db-build` to only update the repository

**Issue: Clone/build takes too long**
- Use `--path` to target specific services instead of `--all`
- The default Logic Apps specification is much smaller than all specifications

**Issue: Out of disk space**
- Use sparse checkout (automatic with `--path`)
- Clean up old database with `--clean` before rebuild
- Avoid using `--all` unless necessary

## Query Details

### InsecureLogicAppTrigger.ql
Identifies Logic App triggers vulnerable to the Azure Silent Reaper attack pattern where workflows can be triggered without proper authentication.

**What it detects:**
- HTTP/Request triggers missing authentication configuration
- Triggers using "None" or "Anonymous" authentication
- Enabled workflows with public endpoints but no access control

### InsecureKeyVaultConfig.ql
Detects Key Vault configurations susceptible to the Azure Vault Recon attack pattern where secrets can be enumerated or accessed due to misconfigurations.

**What it detects:**
- Key Vaults without network restrictions
- Public network access enabled on Key Vaults
- Network ACL default action set to "Allow"
- Overly permissive access policies

### MissingAccessControl.ql
Finds Azure API endpoints that lack proper access control mechanisms, allowing unauthorized access to sensitive operations.

**What it detects:**
- Sensitive operations (CREATE, UPDATE, DELETE) without authentication
- API endpoints with empty security arrays
- Workflows with public access but no access control

### InsecureCredentials.ql
Locates hardcoded credentials, connection strings, and API keys that should be stored securely in Azure Key Vault.

**What it detects:**
- Hardcoded passwords, API keys, and secrets
- Connection strings with embedded credentials
- Secure string parameters with visible default values
- Basic authentication with hardcoded passwords

### SasUriInResponse.ql
Detects Azure Shared Access Signature (SAS) URIs exposed in API responses, which can lead to data exfiltration or unauthorized data-plane access.

**What it detects:**
- SAS URIs in API response bodies containing signature tokens
- URIs with SAS parameters (sig, se, sp, sv) in response properties
- Control-plane APIs exposing data-plane access tokens
- Potential data exfiltration risks through exposed SAS tokens

**Security Impact:**
SAS tokens grant time-limited access to Azure resources. When control-plane APIs expose these tokens in responses, attackers can:
- Access storage accounts or other data-plane resources
- Exfiltrate sensitive data
- Bypass intended access controls

**References:**
- [Azure SAS Overview](https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview)
- [Azure Silent Reaper Disclosure](https://cirriustech.co.uk/blog/azure-silent-reaper/)

## References

- [Azure Silent Reaper Vulnerability](https://cirriustech.co.uk/blog/azure-silent-reaper/)
- [Azure Vault Recon Vulnerability](https://cirriustech.co.uk/blog/azure-vault-recon/)
- [CodeQL Documentation](https://codeql.github.com/docs/)
- [Azure REST API Specifications](https://github.com/Azure/azure-rest-api-specs)

## Contributing

Contributions are welcome! Please submit pull requests with:
- New security queries for Azure misconfigurations
- Improvements to existing queries
- Additional test cases
- Documentation enhancements

## License

See LICENSE file for details.