#!/usr/bin/env python3
"""
SpeQL - Security Pattern Query Language Analyzer for Azure APIs
Analyzes Azure REST API specifications for security vulnerabilities
"""

import json
import sys
import os
import re
from pathlib import Path
from typing import List, Dict, Any, Tuple
from zipfile import ZipFile

# ANSI color codes
RED = '\033[0;31m'
GREEN = '\033[0;32m'
YELLOW = '\033[1;33m'
BLUE = '\033[0;34m'
NC = '\033[0m'  # No Color

# Pre-compiled regex patterns for efficiency
CONNECTION_STRING_PATTERN = re.compile(
    r'(?:server|database|password|accountkey|sharedaccesskey|connectionstring)=',
    re.IGNORECASE
)
CREDENTIAL_PATTERN = re.compile(r'password=.+[;&]|accountkey=.+', re.IGNORECASE)

class SecurityIssue:
    """Represents a security issue found in the analysis"""
    def __init__(self, severity: str, title: str, message: str, file_path: str, location: str = ""):
        self.severity = severity
        self.title = title
        self.message = message
        self.file_path = file_path
        self.location = location

    def __str__(self):
        color = RED if self.severity == "error" else YELLOW
        return f"{color}[{self.severity.upper()}]{NC} {self.title}\n  File: {self.file_path}\n  {self.message}\n"


class AzureSecurityAnalyzer:
    """Analyzes Azure API specifications for security issues"""
    
    def __init__(self):
        self.issues: List[SecurityIssue] = []
        
    def analyze_file(self, file_path: str, content: Dict[str, Any]):
        """Analyze a single JSON file for security issues"""
        # Check for insecure Logic App triggers
        self._check_logic_app_triggers(file_path, content)
        
        # Check for Key Vault misconfigurations
        self._check_key_vault_config(file_path, content)
        
        # Check for missing access control
        self._check_access_control(file_path, content)
        
        # Check for insecure credentials
        self._check_insecure_credentials(file_path, content)
    
    def _check_logic_app_triggers(self, file_path: str, content: Dict[str, Any]):
        """Check for insecure Logic App trigger configurations (Azure Silent Reaper)"""
        # Check workflow definitions
        if "definition" in content:
            definition = content.get("definition", {})
            triggers = definition.get("triggers", {})
            
            for trigger_name, trigger_config in triggers.items():
                trigger_type = trigger_config.get("type", "")
                
                # Check for HTTP triggers without authentication
                if trigger_type in ["Request", "HttpTrigger", "HTTP"]:
                    inputs = trigger_config.get("inputs", {})
                    
                    # Check if authentication is missing or weak
                    if "authentication" not in inputs:
                        self.issues.append(SecurityIssue(
                            "error",
                            "Insecure Logic App Trigger (Azure Silent Reaper)",
                            f"HTTP trigger '{trigger_name}' is missing authentication configuration, allowing unauthorized access",
                            file_path,
                            f"triggers.{trigger_name}"
                        ))
                    else:
                        auth = inputs.get("authentication", {})
                        auth_type = auth.get("type", "") if isinstance(auth, dict) else str(auth)
                        
                        if auth_type in ["None", "Anonymous", ""]:
                            self.issues.append(SecurityIssue(
                                "error",
                                "Weak Logic App Trigger Authentication",
                                f"HTTP trigger '{trigger_name}' uses weak or no authentication ({auth_type})",
                                file_path,
                                f"triggers.{trigger_name}.inputs.authentication"
                            ))
        
        # Check for enabled workflows without access control
        if content.get("properties", {}).get("state") == "Enabled":
            if "accessEndpoint" in content.get("properties", {}):
                access_control = content.get("properties", {}).get("accessControl", {})
                
                if not access_control or len(access_control) == 0:
                    self.issues.append(SecurityIssue(
                        "error",
                        "Workflow Without Access Control",
                        "Enabled workflow has public access endpoint but no access control configuration",
                        file_path,
                        "properties.accessControl"
                    ))
    
    def _check_key_vault_config(self, file_path: str, content: Dict[str, Any]):
        """Check for Key Vault misconfigurations (Azure Vault Recon)"""
        
        # Helper to recursively check for Key Vault references
        def has_keyvault_reference(obj: Any) -> bool:
            """Check if object contains Key Vault references"""
            if isinstance(obj, str):
                return ("keyvault" in obj.lower() or 
                       "vault.azure.net" in obj.lower() or 
                       "@Microsoft.KeyVault" in obj)
            elif isinstance(obj, dict):
                return any(has_keyvault_reference(v) for v in obj.values())
            elif isinstance(obj, list):
                return any(has_keyvault_reference(item) for item in obj)
            return False
        
        # Only check files that reference Key Vault
        if not has_keyvault_reference(content):
            return
        
        properties = content.get("properties", {})
        
        # Check for missing network restrictions
        if "networkAcls" not in properties and "networkRuleSet" not in properties:
            if has_keyvault_reference(properties):
                self.issues.append(SecurityIssue(
                    "error",
                    "Key Vault Without Network Restrictions",
                    "Key Vault configuration missing network restrictions, allowing access from any network",
                    file_path,
                    "properties"
                ))
        
        # Check for public network access
        if properties.get("publicNetworkAccess") == "Enabled":
            self.issues.append(SecurityIssue(
                "error",
                "Key Vault Public Access Enabled",
                "Key Vault allows public network access, potentially exposing secrets to unauthorized enumeration",
                file_path,
                "properties.publicNetworkAccess"
            ))
        
        # Check network ACLs default action
        network_acls = properties.get("networkAcls", {})
        if network_acls.get("defaultAction") == "Allow":
            self.issues.append(SecurityIssue(
                "error",
                "Permissive Key Vault Network ACL",
                "Key Vault network ACL default action is 'Allow', should be 'Deny' with explicit allowlists",
                file_path,
                "properties.networkAcls.defaultAction"
            ))
    
    def _check_access_control(self, file_path: str, content: Dict[str, Any]):
        """Check for missing access control in API endpoints"""
        # Check Swagger/OpenAPI specs
        if content.get("swagger") == "2.0" or "openapi" in content:
            paths = content.get("paths", {})
            global_security = content.get("security", [])
            
            for path, operations in paths.items():
                if not isinstance(operations, dict):
                    continue
                    
                for method, operation in operations.items():
                    if method.upper() not in ["GET", "POST", "PUT", "DELETE", "PATCH"]:
                        continue
                    
                    if not isinstance(operation, dict):
                        continue
                    
                    operation_id = operation.get("operationId", f"{method.upper()} {path}")
                    operation_security = operation.get("security", None)
                    
                    # Check if sensitive operation lacks security
                    is_sensitive = any(keyword in operation_id.lower() 
                                     for keyword in ["delete", "create", "update", "write", "admin"])
                    
                    # Operation has no security and no global security
                    if operation_security is None and not global_security:
                        if is_sensitive:
                            self.issues.append(SecurityIssue(
                                "error",
                                "Sensitive Operation Without Authentication",
                                f"Sensitive operation '{operation_id}' missing security requirements",
                                file_path,
                                f"paths.{path}.{method}"
                            ))
                    
                    # Security explicitly set to empty array
                    elif operation_security is not None and len(operation_security) == 0:
                        self.issues.append(SecurityIssue(
                            "error",
                            "API Endpoint With No Security",
                            f"Operation '{operation_id}' explicitly configured with no security (empty array)",
                            file_path,
                            f"paths.{path}.{method}.security"
                        ))
    
    def _check_insecure_credentials(self, file_path: str, content: Dict[str, Any]):
        """Check for hardcoded credentials and connection strings"""
        
        def check_object(obj: Any, path: str = "", depth: int = 0):
            """Recursively check object for credentials with depth limit"""
            # Prevent stack overflow on deeply nested structures
            if depth > 50:
                return
                
            if isinstance(obj, dict):
                for key, value in obj.items():
                    current_path = f"{path}.{key}" if path else key
                    
                    # Check if key suggests sensitive data
                    if any(sensitive in key.lower() for sensitive in 
                          ["password", "secret", "apikey", "api_key", "connectionstring", 
                           "accountkey", "sharedkey", "accesskey"]):
                        
                        if isinstance(value, str) and value and len(value) > 10:
                            # Check if it's a Key Vault reference (secure)
                            if not ("@Microsoft.KeyVault" in value or "${keyvault:" in value):
                                self.issues.append(SecurityIssue(
                                    "error",
                                    "Hardcoded Credential",
                                    f"Hardcoded credential found in property '{key}'. Use Azure Key Vault instead.",
                                    file_path,
                                    current_path
                                ))
                    
                    # Check for connection strings
                    if isinstance(value, str):
                        if CONNECTION_STRING_PATTERN.search(value):
                            if CREDENTIAL_PATTERN.search(value):
                                if not ("@Microsoft.KeyVault" in value or "${keyvault:" in value):
                                    self.issues.append(SecurityIssue(
                                        "error",
                                        "Insecure Connection String",
                                        f"Connection string with embedded credentials in property '{key}'. Use Key Vault reference.",
                                        file_path,
                                        current_path
                                    ))
                    
                    # Check securestring with default values
                    if key == "type" and value == "securestring":
                        parent_obj = obj
                        if "defaultValue" in parent_obj:
                            default = parent_obj["defaultValue"]
                            if default and not ("@Microsoft.KeyVault" in str(default)):
                                self.issues.append(SecurityIssue(
                                    "error",
                                    "Visible Secure String",
                                    "Secure string parameter has visible default value. Should be retrieved from Key Vault.",
                                    file_path,
                                    current_path
                                ))
                    
                    # Recurse with incremented depth
                    check_object(value, current_path, depth + 1)
                    
            elif isinstance(obj, list):
                for i, item in enumerate(obj):
                    check_object(item, f"{path}[{i}]", depth + 1)
        
        check_object(content)
    
    def analyze_directory(self, directory: Path):
        """Analyze all JSON files in a directory"""
        json_files = list(directory.rglob("*.json"))
        
        print(f"Analyzing {len(json_files)} JSON files...")
        
        for json_file in json_files:
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    content = json.load(f)
                    relative_path = json_file.relative_to(directory)
                    self.analyze_file(str(relative_path), content)
            except Exception as e:
                print(f"{YELLOW}Warning: Could not analyze {json_file}: {e}{NC}")
    
    def print_results(self):
        """Print analysis results"""
        if not self.issues:
            print(f"\n{GREEN}✓ No security issues found!{NC}\n")
            return
        
        print(f"\n{RED}✗ Found {len(self.issues)} security issue(s):{NC}\n")
        
        # Group by severity
        errors = [i for i in self.issues if i.severity == "error"]
        warnings = [i for i in self.issues if i.severity == "warning"]
        
        if errors:
            print(f"{RED}Errors: {len(errors)}{NC}")
            for issue in errors:
                print(issue)
        
        if warnings:
            print(f"{YELLOW}Warnings: {len(warnings)}{NC}")
            for issue in warnings:
                print(issue)
        
        print(f"\n{'═' * 60}")
        print(f"Total issues: {len(self.issues)}")
        print(f"{'═' * 60}\n")


def validate_zip_file(zip_path: Path) -> bool:
    """Validate that the zip file is correct and contains expected content"""
    try:
        with ZipFile(zip_path, 'r') as zip_ref:
            # Check if zip is valid
            if zip_ref.testzip() is not None:
                print(f"{RED}Error: {zip_path} is corrupted{NC}")
                return False
            
            # Get list of files in zip
            file_list = zip_ref.namelist()
            
            # Check what top-level directories exist
            top_dirs = set()
            for f in file_list:
                if '/' in f:
                    first_dir = f.split('/')[0]
                    top_dirs.add(first_dir)
            
            # Validate that it contains the expected structure (mnt/... or src/... or specification/...)
            has_mnt = any(f.startswith('mnt/') for f in file_list)
            has_src = any(f.startswith('src/') for f in file_list)
            has_spec = any(f.startswith('specification/') for f in file_list)
            has_json = any(f.endswith('.json') for f in file_list)
            
            if not has_json:
                print(f"{YELLOW}Warning: {zip_path} contains no JSON files{NC}")
                return False
            
            # Accept mnt/, src/, or specification/ structure
            if not (has_mnt or has_src or has_spec):
                print(f"{YELLOW}Warning: {zip_path} doesn't match expected structure{NC}")
                print(f"{YELLOW}Expected: mnt/, src/, or specification/ directory{NC}")
                print(f"{YELLOW}Found top-level directories: {', '.join(sorted(top_dirs)[:5])}{NC}")
                print(f"{YELLOW}This may not be a database created by refresh_database.py{NC}")
                # Still allow extraction to proceed
            
            # Print diagnostic information
            json_count = sum(1 for f in file_list if f.endswith('.json'))
            print(f"{BLUE}Zip file validation:{NC}")
            print(f"  - Total files: {len(file_list)}")
            print(f"  - JSON files: {json_count}")
            if has_mnt:
                print(f"  - Structure: mnt/")
            elif has_src:
                print(f"  - Structure: src/")
            elif has_spec:
                print(f"  - Structure: specification/")
            else:
                print(f"  - Structure: {', '.join(sorted(top_dirs)[:3])}/")
            
            return True
            
    except Exception as e:
        print(f"{RED}Error: Cannot read {zip_path}: {e}{NC}")
        return False


def main():
    """Main entry point"""
    print("═" * 60)
    print("  SpeQL - Azure Security Analyzer")
    print("  Detecting Azure Silent Reaper & Vault Recon vulnerabilities")
    print("═" * 60)
    print()
    
    # Check if source is extracted
    db_path = Path("database/azure-api-db")
    src_zip = db_path / "src.zip"
    
    # Support mnt/, src/, and specification/ directory structures
    mnt_dir = db_path / "mnt"
    src_dir = db_path / "src"
    spec_dir = db_path / "specification"
    
    # Diagnostic information
    print(f"{BLUE}Diagnostics:{NC}")
    print(f"  - Database path: {db_path.absolute()}")
    print(f"  - Database exists: {db_path.exists()}")
    print(f"  - src.zip exists: {src_zip.exists()}")
    if src_zip.exists():
        print(f"  - src.zip size: {src_zip.stat().st_size:,} bytes")
    print(f"  - mnt directory exists: {mnt_dir.exists()}")
    if mnt_dir.exists():
        json_files = list(mnt_dir.rglob("*.json"))
        print(f"  - JSON files in mnt: {len(json_files)}")
    print(f"  - src directory exists: {src_dir.exists()}")
    if src_dir.exists():
        json_files = list(src_dir.rglob("*.json"))
        print(f"  - JSON files in src: {len(json_files)}")
    print(f"  - specification directory exists: {spec_dir.exists()}")
    if spec_dir.exists():
        json_files = list(spec_dir.rglob("*.json"))
        print(f"  - JSON files in specification: {len(json_files)}")
    print()
    
    # Determine which directory to use (prefer mnt, then src, then specification)
    extracted_dir = None
    if mnt_dir.exists() and any(mnt_dir.rglob("*.json")):
        extracted_dir = mnt_dir
    elif src_dir.exists() and any(src_dir.rglob("*.json")):
        extracted_dir = src_dir
    elif spec_dir.exists() and any(spec_dir.rglob("*.json")):
        extracted_dir = spec_dir
    
    # Check if extraction is needed (all directories missing or empty)
    needs_extraction = extracted_dir is None
    
    if needs_extraction:
        print(f"{YELLOW}Specification directory not found or empty, extraction needed{NC}")
        
        if not src_zip.exists():
            print(f"{RED}Error: Cannot extract - {src_zip} not found{NC}")
            print()
            print(f"{YELLOW}Please run 'python3 refresh_database.py' first to create the database.{NC}")
            sys.exit(1)
        
        # Validate the zip file before extraction
        print(f"{BLUE}Validating {src_zip}...{NC}")
        if not validate_zip_file(src_zip):
            print()
            print(f"{RED}Error: Invalid or corrupted zip file{NC}")
            print(f"{YELLOW}Please run 'python3 refresh_database.py' to recreate the database.{NC}")
            sys.exit(1)
        
        print()
        print(f"{BLUE}Extracting Azure API specifications...{NC}")
        try:
            with ZipFile(src_zip, 'r') as zip_ref:
                zip_ref.extractall(db_path)
            print(f"{GREEN}✓ Extraction complete{NC}\n")
            
            # Re-determine which directory to use after extraction
            if mnt_dir.exists() and any(mnt_dir.rglob("*.json")):
                extracted_dir = mnt_dir
            elif src_dir.exists() and any(src_dir.rglob("*.json")):
                extracted_dir = src_dir
            elif spec_dir.exists() and any(spec_dir.rglob("*.json")):
                extracted_dir = spec_dir
                
        except Exception as e:
            print(f"{RED}Error: Extraction failed: {e}{NC}")
            print(f"{YELLOW}Please check file permissions and disk space.{NC}")
            sys.exit(1)
    
    # Analyze the specifications
    analyzer = AzureSecurityAnalyzer()
    
    if extracted_dir and extracted_dir.exists():
        print(f"{BLUE}Analyzing specifications from: {extracted_dir.name}/{NC}")
        analyzer.analyze_directory(extracted_dir)
    else:
        print(f"{RED}Error: Azure API specifications not found{NC}")
        print(f"Expected at: {mnt_dir}, {src_dir}, or {spec_dir}")
        print()
        print(f"{YELLOW}This should not happen after extraction. Please check file permissions.{NC}")
        sys.exit(1)
        sys.exit(1)
    
    # Print results
    analyzer.print_results()
    
    # Exit with error code if issues found
    if analyzer.issues:
        sys.exit(1)
    
    sys.exit(0)


if __name__ == "__main__":
    main()
