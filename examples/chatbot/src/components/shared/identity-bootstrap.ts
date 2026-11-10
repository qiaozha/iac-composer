import { createGraphResource, defineProvisioning } from "iac-composer";
import { Stack } from "@azure/provisioning-core";
import { fn } from "../../runtime/provisioning.js";

const stack = new Stack("main", { targetScope: "subscription" });
const environmentName = stack.parameters.add("environmentName", "string");
const applicationUniqueName = stack.parameters.add(
  "applicationUniqueName",
  "string",
  { defaultValue: "" },
);
const serviceManagementReference = stack.parameters.add(
  "serviceManagementReference",
  "string",
  { defaultValue: "" },
);
const applicationName = stack.variables.add(
  "applicationName",
  fn.concat("azuresdkqabot-server-", environmentName),
);
const effectiveApplicationUniqueName = stack.variables.add(
  "effectiveApplicationUniqueName",
  fn.cond(
    fn.not(fn.empty(applicationUniqueName)),
    applicationUniqueName,
    applicationName,
  ),
);

const serverApplication = createGraphResource(stack, {
  identifier: "serverApplication",
  type: "Microsoft.Graph/applications",
  body: {
    uniqueName: effectiveApplicationUniqueName,
    displayName: applicationName,
    signInAudience: "AzureADMyOrg",
    serviceManagementReference: fn.cond<string | null>(
      fn.not(fn.empty(serviceManagementReference)),
      serviceManagementReference,
      null,
    ),
  },
});
const serverServicePrincipal = createGraphResource(stack, {
  identifier: "serverServicePrincipal",
  type: "Microsoft.Graph/servicePrincipals",
  body: { appId: serverApplication.appId },
});

stack.outputs.add("SERVER_AUDIENCE", "string", serverApplication.appId);
stack.outputs.add(
  "SERVER_APPLICATION_UNIQUE_NAME",
  "string",
  effectiveApplicationUniqueName,
);
stack.outputs.add(
  "SERVER_APPLICATION_OBJECT_ID",
  "string",
  serverApplication.id,
);
stack.outputs.add(
  "SERVER_SERVICE_PRINCIPAL_ID",
  "string",
  serverServicePrincipal.id,
);
stack.outputs.add(
  "RAG_SERVICE_SCOPE",
  "string",
  fn.concat("api://", serverApplication.appId, "/.default"),
);

export default defineProvisioning({
  stack,
  parameters: {
    environmentName: fn.readEnvironmentVariable("AZURE_ENV_NAME"),
    applicationUniqueName: fn.readEnvironmentVariable(
      "SERVER_APPLICATION_UNIQUE_NAME",
      "",
    ),
    serviceManagementReference: fn.readEnvironmentVariable(
      "SERVICE_MANAGEMENT_REFERENCE",
      "",
    ),
  },
});
