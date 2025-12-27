# SpeQL - Security Query Language for Azure APIs

SpeQL is a security analysis tool that uses CodeQL to detect vulnerabilities and misconfigurations in Azure REST API specifications. It is specifically designed to identify issues similar to those described in the Azure Silent Reaper and Azure Vault Recon vulnerabilities.

## Overview

This tool analyzes Azure REST API specification files (Swagger/OpenAPI) to detect:

- **Azure Silent Reaper**: Insecure Logic App trigger configurations that allow unauthorized workflow execution
- **Azure Vault Recon**: Key Vault misconfigurations enabling unauthorized secret enumeration or access
- **Missing Access Control**: API endpoints lacking proper authentication/authorization
- **Insecure Credentials**: Hardcoded secrets and connection strings that should use Key Vault

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
│       └── InsecureCredentials.ql
└── results/                    # Analysis results (generated)
```

## Installation

### Prerequisites

1. **CodeQL CLI**: Download from [GitHub CodeQL releases](https://github.com/github/codeql-cli-binaries/releases)
   ```bash
   # Example installation
   wget https://github.com/github/codeql-cli-binaries/releases/latest/download/codeql-linux64.zip
   unzip codeql-linux64.zip
   export PATH="$PATH:/path/to/codeql"
   ```

2. **Azure REST API Specifications**: The database should contain Azure API specs from the [azure-rest-api-specs](https://github.com/Azure/azure-rest-api-specs) repository.

### Docker Installation (ARM64 Support)

SpeQL provides a Docker image optimized for ARM64 architecture, making it easy to run on devices like Raspberry Pi, Apple Silicon Macs, and other ARM-based systems.

**For detailed Docker instructions, see [DOCKER.md](./DOCKER.md)**

#### Building the Docker Image

**On ARM64 systems (Raspberry Pi, Apple Silicon, etc.):**
```bash
# Build the ARM64 Docker image
docker build -f Dockerfile.arm64 -t speql:arm64 .
```

**On x86_64 systems with Docker Buildx (cross-platform build):**
```bash
# Enable buildx for multi-platform builds
docker buildx create --use

# Build for ARM64 platform
docker buildx build --platform linux/arm64 -f Dockerfile.arm64 -t speql:arm64 --load .
```

**Note**: Cross-platform builds on x86_64 systems may take significantly longer due to emulation.

**Using Docker Compose:**
```bash
# Build and run with docker-compose
docker-compose up

# Run in detached mode
docker-compose up -d

# View logs
docker-compose logs -f

# Stop and remove containers
docker-compose down
```

#### Running SpeQL in Docker

**Quick Start - Run the Python Analyzer:**
```bash
# Run the analyzer with results saved to a local directory
docker run --rm -v $(pwd)/results:/speql/results speql:arm64 python3 analyze.py
```

**Refresh the Database:**
```bash
# Update and rebuild the database inside the container
docker run --rm -v $(pwd)/results:/speql/results speql:arm64 ./refresh-database.sh
```

**Run CodeQL Queries:**
```bash
# Execute all CodeQL security queries
docker run --rm -v $(pwd)/results:/speql/results speql:arm64 ./run-queries.sh
```

**Interactive Shell:**
```bash
# Open a shell in the container for manual operations
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

### Advanced: Using CodeQL Queries

For more advanced analysis with CodeQL (requires CodeQL CLI):

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