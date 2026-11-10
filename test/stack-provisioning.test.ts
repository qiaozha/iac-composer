import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compileProvisioning, createDeployment, IacComposerError } from "../src/index.js";
import { importTypeScript } from "../src/typescript-loader.js";

const execFileAsync = promisify(execFile);

async function fixture(t: TestContext, source: string) {
  const root = await mkdtemp(join(tmpdir(), "iac-stack-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await mkdir(join(root, "node_modules/@azure"), { recursive: true });
  await symlink(resolve("node_modules/@azure/provisioning-core"), join(root, "node_modules/@azure/provisioning-core"), "dir");
  await symlink(resolve("."), join(root, "node_modules/iac-composer"), "dir");
  const entrypoint = join(root, "infra.ts");
  await writeFile(entrypoint, `
import { Resource, ResourceGroup, Stack, fn } from "@azure/provisioning-core";
import { wrapExpression } from "@azure/provisioning-core/internal";
import { createGraphResource, createParameterVariables, defineProvisioning, loopResource } from "iac-composer";
const stack = new Stack("main", { targetScope: "resourceGroup" });
${source}
`);
  return { root, entrypoint, output: join(root, ".generated/core") };
}

test("stack entrypoints render internally and generate parameter bindings without exposing override values", async (t) => {
  const { root, entrypoint, output } = await fixture(t, `
const location = stack.parameters.add("location", "string");
const enabled = stack.parameters.add("enabled", "bool");
const capacity = stack.parameters.add("capacity", "int");
stack.parameters.add("optional", "string", { defaultValue: "retained" });
const account = new Resource(stack, {
  type: "Microsoft.Storage/storageAccounts", apiVersion: "2025-01-01",
  name: "teststorage", location, properties: { capacity },
}, { condition: enabled });
stack.outputs.add("ACCOUNT_ID", "string", account.id);
export default defineProvisioning({ stack });
`);
  const deployment = createDeployment({ projectDirectory: root, dryRun: true, log: () => {} });
  assert.deepEqual(await deployment.provision("core", {
    entrypoint, outputDirectory: output, parameters: { location: "unit-region", enabled: false, capacity: 0 },
  }), {});
  const main = await readFile(join(output, "main.bicep"), "utf8");
  const parameters = await readFile(join(output, "main.bicepparam"), "utf8");
  assert.match(main, /Microsoft\.Storage\/storageAccounts@2025-01-01/);
  assert.match(main, /= if \(enabled\)/);
  for (const [name, conversion] of [["location", ""], ["enabled", "bool"], ["capacity", "int"]]) {
    assert.match(parameters, new RegExp(`param ${name} = ${conversion ? `${conversion}\\(` : ""}readEnvironmentVariable\\('IAC_COMPOSER_PARAM_${name}'\\)${conversion ? "\\)" : ""}`));
  }
  assert.doesNotMatch(parameters, /param optional|unit-region/);
  assert.doesNotMatch(main, /iacValue/);
});

test("explicit parameter variables and environment expressions remain authored data", async (t) => {
  const { entrypoint, output } = await fixture(t, `
const location = stack.parameters.add("location", "string");
stack.outputs.add("LOCATION", "string", location);
export default defineProvisioning({
  stack,
  parameterVariables: { env: "dev" },
  parameters: { location: fn.concat("region-", wrapExpression({ kind: "symbolic-value", path: "env" })) },
});
`);
  await compileProvisioning(entrypoint, output);
  const parameters = await readFile(join(output, "main.bicepparam"), "utf8");
  assert.match(parameters, /var env = 'dev'/);
  assert.match(parameters, /param location = 'region-\$\{env\}'/);
  assert.doesNotMatch(parameters, /iacValue/);
});

test("registered parameter variables return typed expressions and are emitted without raw reference maps", async (t) => {
  const { entrypoint, output } = await fixture(t, `
const location = stack.parameters.add("location", "string");
const { env } = createParameterVariables(stack, { env: "dev" });
const { region } = createParameterVariables(stack, { region: fn.concat("region-", env) });
stack.outputs.add("LOCATION", "string", location);
export default defineProvisioning({ stack, parameters: { location: region } });
`);
  await compileProvisioning(entrypoint, output);
  const parameters = await readFile(join(output, "main.bicepparam"), "utf8");
  assert.match(parameters, /var env = 'dev'/);
  assert.match(parameters, /var region = 'region-\$\{env\}'/);
  assert.match(parameters, /param location = region/);
  assert.doesNotMatch(await readFile(join(output, "main.bicep"), "utf8"), /var env|var region|iacValue/);
  await compileProvisioning(entrypoint, output);
  assert.equal(await readFile(join(output, "main.bicepparam"), "utf8"), parameters);
});

test("registered Graph resources expose property and dependency handles without string paths", async (t) => {
  const { entrypoint, output } = await fixture(t, `
const application = createGraphResource(stack, {
  identifier: "application", type: "Microsoft.Graph/applications",
  body: { uniqueName: "test" },
});
const principal = createGraphResource(stack, {
  identifier: "principal", type: "Microsoft.Graph/servicePrincipals",
  body: { appId: application.appId }, dependsOn: [application],
});
createGraphResource(stack, {
  identifier: "grant", type: "Microsoft.Graph/appRoleAssignedTo", condition: true,
  body: { appRoleId: "role", principalId: "caller", resourceId: principal.id },
});
stack.outputs.add("APP_ID", "string", application.appId);
stack.outputs.add("PRINCIPAL_ID", "string", principal.id);
export default defineProvisioning({ stack });
`);
  await compileProvisioning(entrypoint, output);
  const main = await readFile(join(output, "main.bicep"), "utf8");
  assert.match(main, /output APP_ID string = application\.appId/);
  assert.match(main, /output PRINCIPAL_ID string = principal\.id/);
  assert.match(main, /appId: application\.appId/);
  assert.match(main, /dependsOn: \[\s+application\s+\]/);
  assert.match(main, /resource grant .* = if \(true\)/);
  assert.match(main, /resourceId: principal\.id/);
  assert.doesNotMatch(main, /var application|var principal|iacValue/);
});

test("typed loop factories infer item fields and preserve sequential update declarations", async (t) => {
  const { entrypoint, output } = await fixture(t, `
const models = stack.variables.add("models", [{ name: "model", capacity: 1 }] as const);
const updates = loopResource(stack, models, {
  itemVariable: "model", batchSize: 1,
  create: (model) => new Resource(stack, {
    type: "Microsoft.CognitiveServices/accounts/deployments", apiVersion: "2025-06-01",
    name: model.name, properties: { capacity: model.capacity },
  }),
});
new Resource(stack, {
  type: "Microsoft.Storage/storageAccounts", apiVersion: "2025-01-01", name: "storage",
}, { dependsOn: [updates] });
export default defineProvisioning({ stack });
`);
  await compileProvisioning(entrypoint, output);
  const main = await readFile(join(output, "main.bicep"), "utf8");
  assert.match(main, /@batchSize\(1\)/);
  assert.match(main, /= \[for model in models: \{/);
  assert.match(main, /name: model\.name/);
  assert.match(main, /capacity: model\.capacity/);
  assert.match(main, /dependsOn: \[/);
  assert.doesNotMatch(main, /var model =|iacValue/);
});

test("typed handles reject unknown fields and mismatched property types at compile time", async (t) => {
  const { root, entrypoint } = await fixture(t, `
const variables = createParameterVariables(stack, { env: "dev", settings: { capacity: 1 } });
const environment: import("@azure/provisioning-core").Expression<string> = variables.env;
// @ts-expect-error Parameter variables only expose declared names.
variables.environment;
// @ts-expect-error Parameter-variable handles are deferred expressions, not local strings.
const concreteEnvironment: string = variables.env;
// @ts-expect-error Nested variable fields retain their inferred shape.
variables.settings.capcity;
const application = createGraphResource(stack, {
  identifier: "app", type: "Microsoft.Graph/applications", body: { uniqueName: "test" },
});
const appId: import("@azure/provisioning-core").Expression<string> = application.appId;
// @ts-expect-error Unknown Graph resource properties are not exposed.
application.applicationId;
const grant = createGraphResource(stack, {
  identifier: "grant", type: "Microsoft.Graph/appRoleAssignedTo",
  body: { appRoleId: "role", principalId: "caller", resourceId: application.id },
});
// @ts-expect-error Role-assignment handles do not expose application identities.
grant.appId;
const updates = loopResource(stack, [{ name: "model", capacity: 1 }], {
  itemVariable: "model",
  create(model) {
    const capacity: import("@azure/provisioning-core").Expression<number> = model.capacity;
    // @ts-expect-error Loop item properties come from the collection's item type.
    model.capcity;
    return new Resource(stack, {
      type: "Microsoft.Test/items", apiVersion: "2025-01-01", name: model.name,
    });
  },
});
// @ts-expect-error A loop dependency handle is not a scalar resource instance.
updates.id;
export default defineProvisioning({ stack });
`);
  await execFileAsync(process.execPath, [
    resolve("node_modules/typescript/bin/tsc"),
    "--noEmit", "--strict", "--skipLibCheck", "--module", "NodeNext", "--target", "ES2022",
    entrypoint,
  ], { cwd: root });
});

test("runtime-managed environment bindings preserve boolean, integer, object, and array values", async (t) => {
  try {
    await execFileAsync("bicep", ["--version"]);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      t.skip("Local Bicep compiler is unavailable; runtime bindings are still covered by generation tests.");
      return;
    }
    throw error;
  }
  const { entrypoint, output } = await fixture(t, `
stack.parameters.add("enabled", "bool");
stack.parameters.add("capacity", "int");
stack.parameters.add("settings", "object");
stack.parameters.add("labels", "array");
export default defineProvisioning({ stack });
`);
  await compileProvisioning(entrypoint, output);
  const { stdout } = await execFileAsync("bicep", [
    "build-params", join(output, "main.bicepparam"), "--stdout",
  ], {
    env: {
      ...process.env,
      IAC_COMPOSER_PARAM_enabled: "false",
      IAC_COMPOSER_PARAM_capacity: "0",
      IAC_COMPOSER_PARAM_settings: '{"value":0.25}',
      IAC_COMPOSER_PARAM_labels: '["one","two"]',
    },
  });
  const result = JSON.parse(stdout);
  const document = JSON.parse(result.parametersJson);
  assert.deepEqual(document.parameters, {
    enabled: { value: false }, capacity: { value: 0 },
    settings: { value: { value: 0.25 } }, labels: { value: ["one", "two"] },
  });
});

test("unused authored parameters remain valid and repeated compilation does not mutate stacks", async (t) => {
  const { entrypoint, output } = await fixture(t, `
stack.parameters.add("reserved", "string");
export { stack };
export default defineProvisioning({ stack });
`);
  await compileProvisioning(entrypoint, output);
  const main = await readFile(join(output, "main.bicep"), "utf8");
  assert.match(main, /param reserved string/);
  assert.doesNotMatch(main, /iacValue/);
  await compileProvisioning(entrypoint, output);
  assert.equal(await readFile(join(output, "main.bicep"), "utf8"), main);
  const module = await importTypeScript(pathToFileURL(entrypoint).href);
  assert.ok(typeof module === "object" && module !== null && "stack" in module);
  const stack = module.stack;
  assert.ok(typeof stack === "object" && stack !== null && "outputs" in stack && "variables" in stack);
  for (const collection of [stack.outputs, stack.variables]) {
    assert.ok(typeof collection === "object" && collection !== null && "size" in collection);
    assert.equal(collection.size, 0);
  }
});

test("Graph declarations preserve Graph-only inputs and conditions", async (t) => {
  const { entrypoint, output } = await fixture(t, `
const displayName = stack.parameters.add("displayName", "string");
const enabled = stack.parameters.add("enabled", "bool");
export default defineProvisioning({
  stack,
  graphResources: [{
    identifier: "application", type: "Microsoft.Graph/applications",
    condition: enabled, body: { uniqueName: "test", displayName },
  }],
});
`);
  await compileProvisioning(entrypoint, output);
  const main = await readFile(join(output, "main.bicep"), "utf8");
  assert.match(main, /param displayName string/);
  assert.match(main, /param enabled bool/);
  assert.match(main, /extension 'br:mcr\.microsoft\.com/);
  assert.match(main, /resource application 'Microsoft\.Graph\/applications@v1\.0' = if \(enabled\) \{/);
  assert.match(main, /displayName: displayName/);
  assert.doesNotMatch(main, /iacValue/);
});

test("selected nested entry templates preserve every core-produced module and relative reference", async (t) => {
  const { root, entrypoint, output } = await fixture(t, `
const scoped = new Stack("root", { targetScope: "subscription" });
const group = new ResourceGroup(scoped, { name: "test-rg", location: "eastus" });
const storage = new Resource(group, {
  type: "Microsoft.Storage/storageAccounts", apiVersion: "2025-01-01",
  name: "unitstorage", location: "eastus",
});
scoped.outputs.add("STORAGE_ID", "string", storage.id);
export default defineProvisioning({ stack: scoped });
`);
  const deployment = createDeployment({ projectDirectory: root, dryRun: true, log: () => {} });
  await deployment.provision("nested", {
    entrypoint, outputDirectory: output,
    templateFile: "templates/main.bicep", parametersFile: "parameters/main.bicepparam",
  });
  const main = await readFile(join(output, "templates/main.bicep"), "utf8");
  assert.match(main, /module \w+ '\.\/root\/storageAccount\.bicep'/);
  assert.match(await readFile(join(output, "templates/root/storageAccount.bicep"), "utf8"), /Microsoft\.Storage\/storageAccounts/);
  assert.match(await readFile(join(output, "parameters/main.bicepparam"), "utf8"), /using '\.\.\/templates\/main\.bicep'/);
  const manifest = JSON.parse(await readFile(join(root, ".generated/azure.yaml"), "utf8"));
  assert.equal(manifest.infra.layers[0].module, "templates/main");
});

test("runtime-managed resource loops retain order, conditions, and unrelated same-type resources", async (t) => {
  const { entrypoint, output } = await fixture(t, `
const configurations = stack.variables.add("configurations", [{ name: "model" }]);
const enabled = stack.parameters.add("enabled", "bool");
const model = loopResource(stack, new Resource(stack, {
  type: "Microsoft.CognitiveServices/accounts/deployments", apiVersion: "2025-06-01",
  name: wrapExpression({ kind: "symbolic-value", path: "item.name" }),
}), configurations, "item");
new Resource(stack, {
  type: "Microsoft.CognitiveServices/accounts/deployments", apiVersion: "2025-06-01", name: "other",
}, { dependsOn: [model], condition: enabled });
export default defineProvisioning({ stack });
`);
  await compileProvisioning(entrypoint, output);
  const main = await readFile(join(output, "main.bicep"), "utf8");
  assert.match(main, /var configurations = \[/);
  assert.equal((main.match(/@batchSize\(1\)/g) ?? []).length, 1);
  assert.match(main, /= \[for item in configurations: \{/);
  assert.match(main, /name: 'other'/);
  assert.match(main, /dependsOn: \[/);
  assert.doesNotMatch(main, /iacValue/);
});

for (const [label, source, code] of [
  ["unknown parameters", `export default defineProvisioning({ stack, parameters: { missing: "value" } });`, "PROVISIONING_PARAMETER_UNKNOWN"],
  ["duplicate Graph identifiers", `export default defineProvisioning({ stack, graphResources: [
    { identifier: "app", type: "Microsoft.Graph/applications", body: {} },
    { identifier: "App", type: "Microsoft.Graph/applications", body: {} },
  ] });`, "PROVISIONING_GRAPH_INVALID"],
  ["invalid parameter identifiers", `export default defineProvisioning({ stack, parameters: { "bad-name": "value" } });`, "PROVISIONING_IDENTIFIER_INVALID"],
  ["ambiguous source contracts", `export default defineProvisioning({ stack }); export const outputBicep = [{ path: "main.bicep", contents: "old" }];`, "PROVISIONING_SOURCE_CONFLICT"],
  ["duplicate typed parameter variables", `createParameterVariables(stack, { env: "dev", Env: "other" }); export default defineProvisioning({ stack });`, "PROVISIONING_REFERENCE_CONFLICT"],
  ["mixed parameter-variable declarations", `createParameterVariables(stack, { env: "dev" }); export default defineProvisioning({ stack, parameterVariables: { env: "other" } });`, "PROVISIONING_REFERENCE_CONFLICT"],
  ["duplicate typed Graph identifiers", `createGraphResource(stack, { identifier: "app", type: "Microsoft.Graph/applications", body: { uniqueName: "one" } }); createGraphResource(stack, { identifier: "App", type: "Microsoft.Graph/applications", body: { uniqueName: "two" } }); export default defineProvisioning({ stack });`, "PROVISIONING_REFERENCE_CONFLICT"],
  ["foreign Graph dependencies", `const foreign = new Stack("foreign"); const application = createGraphResource(foreign, { identifier: "app", type: "Microsoft.Graph/applications", body: { uniqueName: "test" } }); createGraphResource(stack, { identifier: "principal", type: "Microsoft.Graph/servicePrincipals", body: { appId: application.appId }, dependsOn: [application] }); export default defineProvisioning({ stack });`, "PROVISIONING_REFERENCE_SCOPE"],
  ["invalid loop factories", `loopResource(stack, [{ name: "model" }], { itemVariable: "model", create: () => ({}) }); export default defineProvisioning({ stack });`, "PROVISIONING_LOOP_INVALID"],
  ["invalid loop collections", `loopResource(stack, "not-an-array", { itemVariable: "model", create: () => new Resource(stack, { type: "Microsoft.Test/items", apiVersion: "2025-01-01", name: "item" }) }); export default defineProvisioning({ stack });`, "PROVISIONING_LOOP_INVALID"],
] as const) {
  test(`invalid stack definitions reject ${label} without erasing prior artifacts`, async (t) => {
    const { entrypoint, output } = await fixture(t, source);
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "main.bicep"), "previous");
    await assert.rejects(compileProvisioning(entrypoint, output),
      (error: unknown) => error instanceof IacComposerError && error.diagnostic.code === code);
    assert.equal(await readFile(join(output, "main.bicep"), "utf8"), "previous");
  });
}
