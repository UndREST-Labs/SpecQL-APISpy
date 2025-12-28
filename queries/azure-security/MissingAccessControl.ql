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
predicate hasNoSecurity(JSONObject operation) {
  exists(JSONObject pathDef |
    pathDef = pathDef.getParentContainer().getPropValue("paths").(JSONObject).getPropValue(_) and
    operation = pathDef.getPropValue(_) and
    operation instanceof JSONObject and
    not exists(JSONValue security | security = operation.getPropValue("security")) and
    not exists(JSONValue security | 
      security = operation.getParentContainer*().getPropValue("security") and
      security.getParentContainer() != operation
    )
  )
}

/**
 * Holds if security is explicitly set to an empty array (no authentication)
 */
predicate hasEmptySecurity(JSONObject operation) {
  exists(JSONArray security |
    security = operation.getPropValue("security") and
    security.getNumElement() = 0
  )
}

/**
 * Holds if the endpoint performs sensitive operations without authentication
 */
predicate isSensitiveOperation(JSONObject operation) {
  exists(string opType |
    opType = operation.getPropStringValue("operationId") and
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
predicate hasUnrestrictedAccessEndpoint(JSONObject obj) {
  exists(JSONString endpoint |
    endpoint = obj.getPropValue("accessEndpoint") and
    exists(endpoint.getValue()) and
    not exists(JSONObject accessControl |
      accessControl = obj.getPropValue("accessControl")
    )
  )
}

/**
 * Holds if workflow has public access without authentication
 */
predicate hasPublicWorkflowAccess(JSONObject workflow) {
  exists(JSONString state |
    state = workflow.getPropValue("state") and
    state.getValue() = "Enabled"
  ) and
  (
    workflow.getPropValue("accessControl").(JSONObject).getNumProperty() = 0 or
    not exists(JSONValue ac | ac = workflow.getPropValue("accessControl"))
  ) and
  exists(JSONString endpoint | endpoint = workflow.getPropValue("accessEndpoint"))
}

from JSONObject endpoint, string message
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
