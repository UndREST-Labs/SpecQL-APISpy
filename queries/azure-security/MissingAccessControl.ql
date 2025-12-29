/**
 * @name Missing Access Control in Azure API Endpoints
 * @description Detects Azure REST API endpoints that lack proper access control or
 *              authentication requirements, potentially allowing unauthorized access.
 * @kind problem
 * @problem.severity error
 * @security-severity 8.0
 * @precision high
 * @id azure/missing-access-control
 * @tags security
 *       external/cwe/cwe-284
 *       external/cwe/cwe-862
 */

import javascript

/**
 * Holds if an operation (GET, POST, etc.) is missing security requirements
 */
predicate hasNoSecurity(JsonObject operation) {
  exists(JsonObject pathDef, JsonValue paths |
    paths = pathDef.getParentContainer().getPropValue("paths") and
    exists(JsonObject pathsObj |
      pathsObj = paths and
      pathDef = pathsObj.getPropValue(_) and
      operation = pathDef.getPropValue(_) and
      operation instanceof JsonObject and
      not exists(JsonValue security | security = operation.getPropValue("security")) and
      not exists(JsonValue security, JsonValue parent |
        parent = operation.getParentContainer+() and
        security = parent.(JsonObject).getPropValue("security") and
        security.getParentContainer() != operation
      )
    )
  )
}

/**
 * Holds if security is explicitly set to an empty array (no authentication)
 */
predicate hasEmptySecurity(JsonObject operation) {
  exists(JsonArray security |
    security = operation.getPropValue("security") and
    security.getNumChild() = 0
  )
}

/**
 * Holds if the endpoint performs sensitive operations without authentication
 */
predicate isSensitiveOperation(JsonObject operation) {
  exists(string opType, JsonValue opIdValue |
    opIdValue = operation.getPropValue("operationId") and
    opType = opIdValue.(JsonString).getValue() and
    (
      opType.toLowerCase().matches("%delete%") or
      opType.toLowerCase().matches("%create%") or
      opType.toLowerCase().matches("%update%") or
      opType.toLowerCase().matches("%write%") or
      opType.toLowerCase().matches("%admin%")
    )
  )
}

/**
 * Holds if access endpoint is exposed without restrictions
 */
predicate hasUnrestrictedAccessEndpoint(JsonObject obj) {
  exists(JsonString endpoint |
    endpoint = obj.getPropValue("accessEndpoint") and
    exists(endpoint.getValue()) and
    not exists(JsonObject accessControl |
      accessControl = obj.getPropValue("accessControl")
    )
  )
}

/**
 * Holds if workflow has public access without authentication
 */
predicate hasPublicWorkflowAccess(JsonObject workflow) {
  exists(JsonString state |
    state = workflow.getPropValue("state") and
    state.getValue() = "Enabled"
  ) and
  (
    exists(JsonObject accessControl |
      accessControl = workflow.getPropValue("accessControl") and
      not exists(accessControl.getPropValue(_))
    ) or
    not exists(JsonValue ac | ac = workflow.getPropValue("accessControl"))
  ) and
  exists(JsonString endpoint | endpoint = workflow.getPropValue("accessEndpoint"))
}

from JsonObject endpoint, string message
where
  (
    hasNoSecurity(endpoint) and
    isSensitiveOperation(endpoint) and
    message = "Sensitive API operation missing security requirements (authentication/authorization)"
  ) or
  (
    hasEmptySecurity(endpoint) and
    message = "API endpoint explicitly configured with no security (empty security array)"
  ) or
  (
    hasUnrestrictedAccessEndpoint(endpoint) and
    message = "Access endpoint exposed without access control restrictions"
  ) or
  (
    hasPublicWorkflowAccess(endpoint) and
    message = "Enabled workflow with public access endpoint but no access control configuration"
  )
select endpoint, message
