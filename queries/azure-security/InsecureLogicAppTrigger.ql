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
predicate isWorkflowTrigger(JsonObject obj) {
  exists(TriggerType triggerType, JsonValue typeValue |
    typeValue = obj.getPropValue("type") and
    typeValue.(JsonString).getValue() = triggerType
  ) or
  exists(JsonValue triggers, JsonValue parent |
    parent = obj.getParent+() and
    triggers = parent.(JsonObject).getPropValue("triggers") and
    obj.getParent() = triggers
  )
}

/**
 * Holds if a trigger has no authentication configuration
 */
predicate hasNoAuthentication(JsonObject trigger) {
  isWorkflowTrigger(trigger) and
  not exists(JsonObject inputs, JsonValue authValue |
    inputs = trigger.getPropValue("inputs") and
    authValue = inputs.getPropValue("authentication") and
    authValue.(JsonString).getValue() != ""
  ) and
  not exists(JsonObject operationOptions |
    operationOptions = trigger.getPropValue("operationOptions")
  )
}

/**
 * Holds if authentication is set to "None" or uses anonymous access
 */
predicate hasWeakAuthentication(JsonObject trigger) {
  isWorkflowTrigger(trigger) and
  exists(JsonObject inputs, JsonValue authValue |
    inputs = trigger.getPropValue("inputs") and
    authValue = inputs.getPropValue("authentication") and
    (
      authValue.(JsonString).getValue() = "None" or
      (
        authValue instanceof JsonObject and
        (
          authValue.(JsonObject).getPropValue("type").(JsonString).getValue() = "None" or
          authValue.(JsonObject).getPropValue("type").(JsonString).getValue() = "Anonymous"
        )
      )
    )
  )
}

/**
 * Holds if the trigger allows public/anonymous access
 */
predicate allowsAnonymousAccess(JsonObject trigger) {
  isWorkflowTrigger(trigger) and
  exists(JsonObject inputs |
    inputs = trigger.getPropValue("inputs") and
    (
      inputs.getPropValue("method").(JsonString).getValue().toLowerCase() = "get" or
      inputs.getPropValue("method").(JsonString).getValue().toLowerCase() = "post"
    ) and
    not exists(JsonValue auth | auth = inputs.getPropValue("authentication"))
  )
}

from JsonObject trigger, string message
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
