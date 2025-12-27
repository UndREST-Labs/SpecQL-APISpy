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
├── config/
│   └── SpeQL.yml               # CodeQL database configuration
├── database/
│   └── azure-api-db/           # CodeQL database of Azure API specs
├── queries/
│   └── azure-security/         # Security query suite
│       ├── InsecureLogicAppTrigger.ql
│       ├── InsecureKeyVaultConfig.ql
│       ├── MissingAccessControl.ql
│       └── InsecureCredentials.ql
├── run-queries.sh              # Query execution script
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

## Usage

### Running All Security Queries

```bash
./run-queries.sh
```

This will:
1. Run all security queries against the Azure API database
2. Generate SARIF format results in the `results/` directory
3. Display a summary of issues found

### Running Individual Queries

```bash
codeql database analyze database/azure-api-db \
    queries/azure-security/InsecureLogicAppTrigger.ql \
    --format=sarif-latest \
    --output=results/InsecureLogicAppTrigger.sarif
```

### Viewing Results

Results are saved in SARIF format (Static Analysis Results Interchange Format) and can be:
- Viewed in VS Code with the SARIF Viewer extension
- Uploaded to GitHub Advanced Security
- Processed with SARIF tools

## Query Details

### InsecureLogicAppTrigger.ql
Identifies Logic App triggers vulnerable to the Azure Silent Reaper attack pattern where workflows can be triggered without proper authentication.

### InsecureKeyVaultConfig.ql
Detects Key Vault configurations susceptible to the Azure Vault Recon attack pattern where secrets can be enumerated or accessed due to misconfigurations.

### MissingAccessControl.ql
Finds Azure API endpoints that lack proper access control mechanisms, allowing unauthorized access to sensitive operations.

### InsecureCredentials.ql
Locates hardcoded credentials, connection strings, and API keys that should be stored securely in Azure Key Vault.

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