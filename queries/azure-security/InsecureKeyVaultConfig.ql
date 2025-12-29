/**
 * @name Insecure Azure Key Vault Configuration (Azure Vault Recon)
 * @description Detects Azure Key Vault configurations that may allow unauthorized enumeration
 *              or access to secrets. This is related to the Azure Vault Recon vulnerability
 *              where Key Vault secrets can be discovered or accessed due to misconfigurations
 *              in access policies, network rules, or authentication requirements.
 * @kind problem
 * @problem.severity error
 * @security-severity 9.0
 * @precision high
 * @id azure/insecure-key-vault-config
 * @tags security
 *       external/cwe/cwe-284
 *       external/cwe/cwe-522
 */

import javascript

/**
 * Holds if a JSON object represents a Key Vault reference or configuration
 */
predicate isKeyVaultReference(JsonObject obj) {
  exists(JsonString str, string value |
    str = obj.getPropValue(_) and
    value = str.getValue() and
    (
      value.regexpMatch("(?i).*keyvault.*") or
      value.matches("%vault.azure.net%") or
      value.matches("%@Microsoft.KeyVault%")
    )
  )
}

/**
 * Holds if Key Vault access is configured without network restrictions
 */
predicate hasNoNetworkRestrictions(JsonObject config) {
  exists(JsonString uri |
    uri = config.getPropValue(_) and
    uri.getValue().matches("%vault.azure.net%") and
    not exists(JsonObject networkAcls, JsonValue parent |
      parent = config.getParentContainer+() and
      (
        networkAcls = parent.(JsonObject).getPropValue("networkAcls") or
        networkAcls = parent.(JsonObject).getPropValue("networkRuleSet")
      )
    )
  )
}

/**
 * Holds if Key Vault allows public network access
 */
predicate allowsPublicNetworkAccess(JsonObject config) {
  exists(JsonValue publicAccess, JsonValue parent |
    parent = config.getParentContainer+() and
    publicAccess = parent.(JsonObject).getPropValue("publicNetworkAccess") and
    publicAccess.(JsonString).getValue() = "Enabled"
  ) or
  exists(JsonValue defaultAction, JsonValue parent |
    parent = config.getParentContainer+() and
    exists(JsonObject networkAcls |
      networkAcls = parent.(JsonObject).getPropValue("networkAcls") and
      defaultAction = networkAcls.getPropValue("defaultAction") and
      defaultAction.(JsonString).getValue() = "Allow"
    )
  )
}

/**
 * Holds if Key Vault secret is embedded or exposed in configuration
 */
predicate hasEmbeddedSecret(JsonObject config) {
  exists(JsonString secret, string propName |
    secret = config.getPropValue(propName) and
    (
      propName.toLowerCase().matches("%password%") or
      propName.toLowerCase().matches("%secret%") or
      propName.toLowerCase().matches("%key%") or
      propName.toLowerCase().matches("%connectionstring%")
    ) and
    not secret.getValue().matches("%@Microsoft.KeyVault%") and
    secret.getValue().length() > 20
  )
}

/**
 * Holds if Key Vault access policy allows overly permissive operations
 */
predicate hasOverlyPermissiveAccess(JsonObject policy) {
  exists(JsonArray permissions, JsonValue parent |
    parent = policy.getParentContainer+() and
    exists(JsonObject permsObj |
      permsObj = parent.(JsonObject).getPropValue("permissions") and
      permissions = permsObj.getPropValue("secrets")
    ) and
    (
      permissions.getElementValue(_).(JsonString).getValue() = "all" or
      (
        permissions.getElementValue(_).(JsonString).getValue() = "get" and
        permissions.getElementValue(_).(JsonString).getValue() = "list" and
        permissions.getElementValue(_).(JsonString).getValue() = "delete"
      )
    )
  )
}

from JsonObject config, string message
where
  (
    hasNoNetworkRestrictions(config) and
    message = "Key Vault configuration missing network restrictions, allowing access from any network"
  ) or
  (
    allowsPublicNetworkAccess(config) and
    message = "Key Vault allows public network access, potentially exposing secrets to unauthorized enumeration"
  ) or
  (
    hasEmbeddedSecret(config) and
    message = "Configuration contains embedded secrets instead of Key Vault reference, risking exposure"
  ) or
  (
    hasOverlyPermissiveAccess(config) and
    message = "Key Vault access policy grants overly permissive permissions (all/get+list+delete)"
  )
select config, message
