/**
 * @name Insecure Connection Strings and Credentials
 * @description Detects hardcoded credentials, connection strings, or API keys in Azure
 *              configuration files that should be stored in Azure Key Vault instead.
 * @kind problem
 * @problem.severity error
 * @security-severity 7.5
 * @precision high
 * @id azure/insecure-credentials
 * @tags security
 *       external/cwe/cwe-798
 *       external/cwe/cwe-259
 */

import javascript

/**
 * Holds if a string value looks like a connection string
 */
predicate isConnectionString(JsonString str) {
  str.getValue().regexpMatch(".*[Ss]erver=.*") or
  str.getValue().regexpMatch(".*[Dd]atabase=.*") or
  str.getValue().regexpMatch(".*[Pp]assword=.*") or
  str.getValue().regexpMatch(".*[Aa]ccount[Kk]ey=.*") or
  str.getValue().regexpMatch(".*[Ss]hared[Aa]ccess[Kk]ey=.*") or
  str.getValue().regexpMatch(".*[Cc]onnection[Ss]tring.*")
}

/**
 * Holds if a property name suggests it contains sensitive information
 */
predicate isSensitiveProperty(string propName) {
  propName.toLowerCase().matches("%password%") or
  propName.toLowerCase().matches("%secret%") or
  propName.toLowerCase().matches("%apikey%") or
  propName.toLowerCase().matches("%api_key%") or
  propName.toLowerCase().matches("%connectionstring%") or
  propName.toLowerCase().matches("%accountkey%") or
  propName.toLowerCase().matches("%sharedkey%") or
  propName.toLowerCase().matches("%accesskey%")
}

/**
 * Holds if a value is a Key Vault reference (secure)
 */
predicate isKeyVaultReference(JsonString str) {
  str.getValue().matches("%@Microsoft.KeyVault%") or
  str.getValue().matches("%${keyvault:%")
}

/**
 * Holds if credential is hardcoded (not from Key Vault)
 */
predicate hasHardcodedCredential(JsonObject obj, string propName) {
  exists(JsonString value |
    value = obj.getPropValue(propName) and
    isSensitiveProperty(propName) and
    not isKeyVaultReference(value) and
    value.getValue().length() > 10 and
    not value.getValue() = ""
  )
}

/**
 * Holds if connection string is not secured
 */
predicate hasInsecureConnectionString(JsonObject obj, string propName) {
  exists(JsonString value |
    value = obj.getPropValue(propName) and
    isConnectionString(value) and
    not isKeyVaultReference(value) and
    (
      value.getValue().regexpMatch(".*[Pp]assword=.+;.*") or
      value.getValue().regexpMatch(".*[Aa]ccount[Kk]ey=.+;.*")
    )
  )
}

/**
 * Holds if securestring is used but value is still visible
 */
predicate hasVisibleSecureString(JsonObject obj) {
  exists(JsonObject param, JsonValue typeValue |
    param = obj.getPropValue(_) and
    typeValue = param.getPropValue("type") and
    typeValue.(JsonString).getValue() = "securestring" and
    exists(JsonString defaultValue |
      defaultValue = param.getPropValue("defaultValue") and
      defaultValue.getValue().length() > 0 and
      not isKeyVaultReference(defaultValue)
    )
  )
}

/**
 * Holds if authentication type uses basic auth without secure storage
 */
predicate usesInsecureBasicAuth(JsonObject auth) {
  exists(JsonValue typeValue |
    typeValue = auth.getPropValue("type") and
    typeValue.(JsonString).getValue() = "Basic"
  ) and
  exists(JsonString password |
    password = auth.getPropValue("password") and
    not isKeyVaultReference(password) and
    password.getValue().length() > 0
  )
}

from JsonObject config, string message, string location
where
  (
    hasHardcodedCredential(config, location) and
    message = "Hardcoded credential found in property '" + location + "'. Use Azure Key Vault instead."
  ) or
  (
    hasInsecureConnectionString(config, location) and
    message = "Connection string with embedded credentials in property '" + location + "'. Use Key Vault reference."
  ) or
  (
    hasVisibleSecureString(config) and
    location = "securestring parameter" and
    message = "Secure string parameter has visible default value. Should be retrieved from Key Vault."
  ) or
  (
    usesInsecureBasicAuth(config) and
    location = "authentication" and
    message = "Basic authentication with hardcoded password. Use Key Vault or managed identity."
  )
select config, message + " [" + location + "]"
