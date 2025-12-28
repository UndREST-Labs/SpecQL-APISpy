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
 * - sig: signature
 * - se: expiry time
 * - sp: permissions
 * - sv: storage version
 * - sr: resource (for storage)
 * - api-version: API version (for Logic Apps)
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
 * Holds if a JSON object is within an API response definition
 */
predicate isInApiResponse(JsonObject obj) {
  exists(JsonObject responses |
    responses = obj.getParentContainer*().getPropValue("responses") and
    obj.getParentContainer+() = responses
  ) or
  exists(JsonObject response |
    response = obj.getParentContainer*() and
    response.getPropStringValue("statusCode") != ""
  ) or
  exists(JsonValue examples |
    examples = obj.getParentContainer*().getPropValue("examples") and
    obj.getParentContainer+() = examples
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

/**
 * Holds if an object contains a SAS URI in a response
 */
predicate hasSasUriInResponse(JsonObject obj, string propName) {
  exists(JsonString uri |
    uri = obj.getPropValue(propName) and
    isSasUri(uri) and
    isInApiResponse(obj) and
    isUriProperty(propName)
  )
}

/**
 * Holds if an object in response body contains SAS URI (nested)
 */
predicate hasNestedSasUri(JsonObject obj, string propName) {
  exists(JsonString uri |
    uri = obj.getPropValue(_).(JsonObject).getPropValue(propName) and
    isSasUri(uri) and
    isInApiResponse(obj) and
    isUriProperty(propName)
  )
}

from JsonObject response, string message, string propName
where
  (
    hasSasUriInResponse(response, propName) and
    message = "API response exposes Azure SAS URI in property '" + propName + "', which may lead to data exfiltration or unauthorized access"
  ) or
  (
    hasNestedSasUri(response, propName) and
    message = "API response contains Azure SAS URI in nested object property '" + propName + "', which may lead to data exfiltration or unauthorized access"
  )
select response, message + " [" + propName + "]"
