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
predicate isKeyVaultReference(JSONObject obj) {
  exists(JSONString str, string value |
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
predicate hasNoNetworkRestrictions(JSONObject config) {
  exists(JSONString uri |
    uri = config.getPropValue(_) and
    uri.getValue().matches("%vault.azure.net%") and
    not exists(JSONObject networkAcls |
      networkAcls = config.getParentContainer*().getPropValue("networkAcls") or
      networkAcls = config.getParentContainer*().getPropValue("networkRuleSet")
    )
  )
}

/**
 * Holds if Key Vault allows public network access
 */
predicate allowsPublicNetworkAccess(JSONObject config) {
  exists(JSONValue publicAccess |
    publicAccess = config.getParentContainer*().getPropValue("publicNetworkAccess") and
    publicAccess.(JSONString).getValue() = "Enabled"
  ) or
  exists(JSONValue defaultAction |
    defaultAction = config.getParentContainer*().getPropValue("networkAcls").(JSONObject).getPropValue("defaultAction") and
    defaultAction.(JSONString).getValue() = "Allow"
  )
}

/**
 * Holds if Key Vault secret is embedded or exposed in configuration
 */
predicate hasEmbeddedSecret(JSONObject config) {
  exists(JSONString secret |
    secret = config.getPropValue(_) and
    (
      config.getPropStringValue(_).matches("%password%") or
      config.getPropStringValue(_).matches("%secret%") or
      config.getPropStringValue(_).matches("%key=%") or
      config.getPropStringValue(_).matches("%connectionString%")
    ) and
    not secret.getValue().matches("%@Microsoft.KeyVault%") and
    secret.getValue().length() > 20
  )
}

/**
 * Holds if Key Vault access policy allows overly permissive operations
 */
predicate hasOverlyPermissiveAccess(JSONObject policy) {
  exists(JSONArray permissions |
    permissions = policy.getParentContainer*().getPropValue("permissions").(JSONObject).getPropValue("secrets") and
    (
      permissions.getElementValue(_).(JSONString).getValue() = "all" or
      (
        permissions.getElementValue(_).(JSONString).getValue() = "get" and
        permissions.getElementValue(_).(JSONString).getValue() = "list" and
        permissions.getElementValue(_).(JSONString).getValue() = "delete"
      )
    )
  )
}

from JSONObject config, string message
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
