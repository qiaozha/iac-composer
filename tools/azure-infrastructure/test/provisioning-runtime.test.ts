import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { Resource, Stack } from "@azure/provisioning-core";
import {
  bicepRef,
  createBicepParameterFile,
  fn,
  grantRole,
  loopResource,
  renderBicepFiles,
  renderBicepParameterFile,
  renderGraphStack,
  serialize,
  UserAssignedIdentity,
} from "../src/runtime/provisioning.js";

test("unpublished resource definitions retain ARM controls, scopes, and conditions", () => {
  const stack = new Stack("main", { targetScope: "resourceGroup" });
  const identity = new UserAssignedIdentity(stack, { name: "identity", location: "eastus" });
  grantRole(identity, {
    role: "role-id", principalId: identity.properties.principalId, principalType: "ServicePrincipal",
  });
  const [main] = renderBicepFiles([stack]);
  assert.ok(main);
  assert.match(main.contents, /Microsoft\.ManagedIdentity\/userAssignedIdentities@2025-05-31-preview/);
  assert.match(main.contents, /Microsoft\.Authorization\/roleAssignments@2022-04-01/);
  assert.match(main.contents, /scope: userAssignedIdentity/);
  assert.match(main.contents, /principalId: userAssignedIdentity\.properties\.principalId/);
  assert.match(main.contents, /principalType: 'ServicePrincipal'/);
});

test("Graph-only inputs survive dependency planning without temporary declarations", () => {
  const stack = new Stack("main", { targetScope: "subscription" });
  const displayName = stack.parameters.add("displayName", "string");
  const enabled = stack.parameters.add("enabled", "bool");
  const rendered = renderGraphStack(stack, [{
    identifier: "application",
    type: "Microsoft.Graph/applications",
    body: { uniqueName: "application", displayName },
    condition: enabled,
  }]);
  assert.match(rendered.main.contents, /param displayName string/);
  assert.match(rendered.main.contents, /param enabled bool/);
  assert.match(rendered.main.contents, /extension 'br:mcr\.microsoft\.com/);
  assert.match(rendered.main.contents, /= if \(enabled\) \{\n\s+uniqueName: 'application'\n\s+displayName: displayName\n\}/);
  assert.doesNotMatch(rendered.main.contents, /iacValue/);
  assert.equal(stack.variables.size, 0);
  assert.equal(stack.outputs.size, 0);
});

test("sequential model loops retain their collection, serialized body, and dependencies", () => {
  const stack = new Stack("main", { targetScope: "resourceGroup" });
  const configurations = stack.variables.add("modelConfigurations", [{ name: "model" }]);
  const model = loopResource(stack, new Resource(stack, {
    type: "Microsoft.CognitiveServices/accounts/deployments",
    apiVersion: "2025-06-01",
    name: bicepRef("deployment.name"),
    properties: { model: { format: "OpenAI", name: "model", version: "1" } },
  }), configurations, "deployment");
  new Resource(stack, {
    type: "Microsoft.Storage/storageAccounts", apiVersion: "2025-01-01", name: "storage",
  }, { dependsOn: [model] });
  const [main] = renderBicepFiles([stack]);
  assert.ok(main);
  assert.match(main.contents, /var modelConfigurations = \[/);
  assert.match(main.contents, /@batchSize\(1\)\nresource \w+ .* = \[for deployment in modelConfigurations:/);
  assert.match(main.contents, /dependsOn: \[/);
  assert.doesNotMatch(main.contents, /iacValue/);
  const declarations = Object.values(serialize([stack]).infras[0]!.resources ?? {});
  const loop = declarations.find((resource) => resource.type.endsWith("/deployments"));
  assert.equal(loop?.value.kind, "for-expression");
  assert.equal(loop?.decorators?.batchSize, 1);
});

test("parameter-file variables and expressions use core rendering and leave stacks unchanged", () => {
  const stack = new Stack("main", { targetScope: "resourceGroup" });
  const file = renderBicepParameterFile(createBicepParameterFile(stack, "main.bicepparam", {
    using: "./main.bicep",
    variables: { env: fn.readEnvironmentVariable("AZURE_ENV_NAME", "dev") },
    parameters: { name: fn.concat("app-", bicepRef("env")), enabled: true, settings: { value: "quoted'value" } },
  }));
  assert.match(file.contents, /^using '\.\/main\.bicep'/);
  assert.match(file.contents, /var env = readEnvironmentVariable\('AZURE_ENV_NAME', 'dev'\)/);
  assert.match(file.contents, /param name = 'app-\$\{env\}'/);
  assert.match(file.contents, /param enabled = true/);
  assert.match(file.contents, /param settings = \{\n\s+value: 'quoted\\'value'\n\}/);
  assert.doesNotMatch(file.contents, /iacValue/);
  assert.equal(stack.variables.size, 0);
  assert.equal(stack.outputs.size, 0);
});

test("multiple stacks reject conflicting artifact paths", () => {
  const first = new Stack("main", { targetScope: "resourceGroup" });
  const second = new Stack("main", { targetScope: "resourceGroup" });
  assert.throws(() => renderBicepFiles([first, second]), /Duplicate Bicep file path/);
});

test("examples carry the same provisioning helper as generated deployments", async () => {
  const source = await readFile(resolve("src/runtime/provisioning.ts"), "utf8");
  for (const file of [
    "../../examples/chatbot/src/runtime/provisioning.ts",
    "../../examples/contoso/runtime/provisioning.ts",
    "../../examples/foundry/runtime/provisioning.ts",
  ]) {
    assert.equal(await readFile(resolve(file), "utf8"), source, file);
  }
});
