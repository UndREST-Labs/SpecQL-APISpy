/**
 * @name Azure SAS URI Exposed in API Response
 * @description Detects API specifications that emit Azure Shared Access Signature (SAS) URIs
 *              in API responses. SAS URIs contain sensitive tokens that grant time-limited
 *              access to Azure resources. Exposing these in control-plane API responses can
 *              lead to data exfiltration or unauthorized data-plane access.
 * @kind problem
 * @problem.severity error
 * @security-severity 8.5
 * @precision high
 * @id azure/sas-uri-in-response
 * @tags security
 *       external/cwe/cwe-200
 *       external/cwe/cwe-359
 */

import javascript

/**
 * Holds if a string value looks like a SAS URI
 * SAS URIs contain query parameters like:
 * - sig: signature (required)
 * - se: expiry time
 * - sp: permissions
 * - sv: storage version
 * - sr: resource (for storage)
 */
predicate isSasUri(JsonString str) {
  exists(string value |
    value = str.getValue() and
    // Must be a URI (http/https)
    value.regexpMatch("https?://.*") and
    // Must contain signature parameter (sig=)
    value.regexpMatch(".*[?&]sig=.*") and
    // Must contain at least one other SAS parameter
    (
      value.regexpMatch(".*[?&]se=.*") or  // expiry
      value.regexpMatch(".*[?&]sp=.*") or  // permissions
      value.regexpMatch(".*[?&]sv=.*") or  // storage version
      value.regexpMatch(".*[?&]sr=.*")     // resource
    )
  )
}

/**
 * Holds if a JSON string is within an API response context
 * Checks if the string has a "responses" ancestor in the JSON tree
 */
predicate isInApiResponse(JsonString str) {
  exists(JsonObject responsesObj |
    responsesObj.getParentContainer().getPropValue("responses") = responsesObj and
    str.getParentContainer*() = responsesObj
  )
}

/**
 * Holds if a property name suggests it contains a URI or link
 */
predicate isUriProperty(string propName) {
  propName.toLowerCase().matches("%uri%") or
  propName.toLowerCase().matches("%url%") or
  propName.toLowerCase().matches("%link%") or
  propName.toLowerCase().matches("%href%") or
  propName.toLowerCase().matches("%endpoint%")
}

from JsonString sasUri, string propName
where
  isSasUri(sasUri) and
  isInApiResponse(sasUri) and
  exists(JsonObject parent |
    parent.getPropValue(propName) = sasUri and
    isUriProperty(propName)
  )
select sasUri, "API response exposes Azure SAS URI in property '" + propName + "', which may lead to data exfiltration or unauthorized access"
