import type { ProvisioningSourceOptions } from "../types.js";
import type { RenderingContext } from "./context.js";

interface WorkflowImport {
  functionName: string;
  importPath: string;
}

interface ProvisioningPreludeOptions {
  options: ProvisioningSourceOptions;
  owner?: string;
  workflowPlans: readonly WorkflowImport[];
  parameters: readonly string[];
}

export function renderProvisioningPrelude({
  options,
  owner,
  workflowPlans,
  parameters,
}: ProvisioningPreludeOptions): string {
  const workflowImports = workflowPlans
    .map(
      (plan) =>
        `import { ${plan.functionName} } from ${JSON.stringify(plan.importPath)};`,
    )
    .join("\n");
  return `import { bicepRef, createBicepParameterFile, renderBicepFiles, renderBicepParameterFile } from "../../runtime/provisioning.js";
import { Resource, Stack } from "@azure/provisioning-core";
import { fn } from "../../runtime/provisioning.js";
import { serialize } from "../../runtime/provisioning.js";
import { Account, Deployment as ModelDeployment, Project } from "@azure/provisioning-cognitiveservices";
import {
  Container as CosmosContainer,
  DatabaseAccount,
  SqlDatabase,
  SqlRoleAssignment,
} from "@azure/provisioning-cosmosdb";
import {
  BlobService,
  Container as StorageContainer,
  StorageAccount,
} from "@azure/provisioning-storage";
import { ConfigurationStore, KeyValue } from "../../runtime/provisioning.js";
import { Workspace } from "@azure/provisioning-operationalinsights";
import { Component as ApplicationInsightsComponent } from "@azure/provisioning-appinsights";
import { UserAssignedIdentity } from "../../runtime/provisioning.js";
import { Registry } from "@azure/provisioning-containerregistry";
import { ApiConnection, AppServicePlan, Site, SiteConfigAuthsettingsV2 } from "../../runtime/provisioning.js";
import { Bot, Channel } from "../../runtime/provisioning.js";
import { RoleAssignment } from "../../runtime/provisioning.js";
import { Workflow } from "../../runtime/provisioning.js";
import { renderGraphStack } from ${JSON.stringify(owner && owner !== "shared" ? "../shared/graph-provisioning.js" : "./graph-provisioning.js")};
${workflowImports}

export const solutionName = ${JSON.stringify(options.requirements.solution.name)};

const stack = new Stack("main", { targetScope: "resourceGroup" });
const location = stack.parameters.add("location", "string");
${parameters.join("\n")}
const suffix = stack.variables.add(
  "suffix",
  fn.substring(fn.uniqueString(fn.resourceGroup().id), 0, 6),
);
`;
}

export function renderProvisioningDocument(context: RenderingContext): string {
  const body = [...context.sections];
  context.sections.length = 0;
  context.addSection(
    renderProvisioningPrelude({
      options: context.options,
      owner: context.owner,
      workflowPlans: context.workflowPlans,
      parameters: context.parameters,
    }),
  );
  context.sections.push(...body);
  renderOutputs(context);
  renderFooter(context);
  return context.sections.join("\n");
}

function renderOutputs(context: RenderingContext): void {
  for (const [name, expression] of context.outputs) {
    context.addSection(
      `stack.outputs.add(${JSON.stringify(name)}, "string", ${expression});`,
    );
  }
}

function renderFooter(context: RenderingContext): void {
  const bindings = [
    `    location: fn.readEnvironmentVariable("AZURE_LOCATION", "westus2"),`,
    ...context.parameterBindings.map((binding) => `    ${binding},`),
    ...context.workflowPlans.flatMap((plan) =>
      plan.parameterBindings.map((binding) => `    ${binding},`),
    ),
  ].join("\n");
  const graphRendering =
    context.graphResources.length > 0
      ? `const rendered = renderGraphStack(stack, [\n${context.graphResources.join("\n")}\n]);\nexport const outputJson = rendered.outputJson;\nconst renderedStack = rendered.main;`
      : `export const outputJson = serialize([stack]);\nconst [renderedStack] = renderBicepFiles([stack]);`;
  context.addSection(`const parameterFile = createBicepParameterFile(stack, "main.bicepparam", {
  using: "./main.bicep",
  parameters: {
${bindings}
  },
});

${graphRendering}
if (renderedStack === undefined) {
  throw new Error("Generated provisioning produced no Bicep entry file.");
}
export const outputBicep = [
  { ...renderedStack, path: "main.bicep" },
  renderBicepParameterFile(parameterFile),
];
`);
}