/**
 * @name Insecure Logic App Trigger Configuration (Azure Silent Reaper)
 * @description Detects Azure Logic App triggers that may be vulnerable to unauthorized access
 *              due to missing or weak authentication requirements. This is related to the
 *              Azure Silent Reaper vulnerability where triggers can be invoked without proper
 *              authentication, leading to potential unauthorized workflow execution.
 * @kind problem
 * @problem.severity error
 * @security-severity 8.5
 * @precision high
 * @id azure/insecure-logic-app-trigger
 * @tags security
 *       external/cwe/cwe-306
 *       external/cwe/cwe-862
 */

import javascript

// Pre-compiled patterns for efficiency
class TriggerType extends string {
  TriggerType() {
    this = "Request" or this = "HttpTrigger" or this = "HTTP"
  }
}

/**
 * Holds if a JSON object represents a workflow trigger definition
 */
predicate isWorkflowTrigger(JSONObject obj) {
  exists(TriggerType triggerType |
    obj.getPropValue("type").(JSONString).getValue() = triggerType
  ) or
  exists(JSONValue triggers |
    triggers = obj.getParentContainer*().getPropValue("triggers") and
    obj.getParentContainer() = triggers
  )
}

/**
 * Holds if a trigger has no authentication configuration
 */
predicate hasNoAuthentication(JSONObject trigger) {
  isWorkflowTrigger(trigger) and
  not exists(JSONObject inputs |
    inputs = trigger.getPropValue("inputs") and
    inputs.getPropStringValue("authentication") != ""
  ) and
  not exists(JSONObject operationOptions |
    operationOptions = trigger.getPropValue("operationOptions")
  )
}

/**
 * Holds if authentication is set to "None" or uses anonymous access
 */
predicate hasWeakAuthentication(JSONObject trigger) {
  isWorkflowTrigger(trigger) and
  exists(JSONObject inputs |
    inputs = trigger.getPropValue("inputs") and
    (
      inputs.getPropStringValue("authentication") = "None" or
      inputs.getPropValue("authentication").(JSONObject).getPropStringValue("type") = "None" or
      inputs.getPropValue("authentication").(JSONObject).getPropStringValue("type") = "Anonymous"
    )
  )
}

/**
 * Holds if the trigger allows public/anonymous access
 */
predicate allowsAnonymousAccess(JSONObject trigger) {
  isWorkflowTrigger(trigger) and
  exists(JSONObject inputs |
    inputs = trigger.getPropValue("inputs") and
    (
      inputs.getPropValue("method").(JSONString).getValue().toLowerCase() = "get" or
      inputs.getPropValue("method").(JSONString).getValue().toLowerCase() = "post"
    ) and
    not exists(JSONValue auth | auth = inputs.getPropValue("authentication"))
  )
}

from JSONObject trigger, string message
where
  (
    hasNoAuthentication(trigger) and
    message = "Logic App trigger is missing authentication configuration, allowing unauthorized access"
  ) or
  (
    hasWeakAuthentication(trigger) and
    message = "Logic App trigger uses weak or no authentication (None/Anonymous), vulnerable to unauthorized access"
  ) or
  (
    allowsAnonymousAccess(trigger) and
    message = "HTTP trigger allows anonymous access without authentication requirements"
  )
select trigger, message
