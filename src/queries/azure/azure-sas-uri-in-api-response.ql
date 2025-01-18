import javascript
import semmle.code.json.Json

from JsonString value, JsonObject response
where
  response.getProperty("responses") != null and
  value.getStringValue().contains("&sig=")
select response, value.getStringValue()
